// Civitai / Hugging Face / direct-URL LoRA download logic.
// Route handlers (server/routes/loras.ts, written elsewhere) create the `Lora` row and enqueue
// a `lora_download` job; this module provides the URL-parsing helper the route uses to decide
// `source`/default `family`/`kind`, and registers the job runner that actually streams the file.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { loras } from '../db';
import { emit } from '../events';
import { MODELS_DIR } from '../config';
import { resolveCivitaiToken, resolveHfToken } from '../settings';
import { registerRunner } from '../pipeline/queue';
import type { LoraFamily, LoraSource } from '../../shared/types';

// ───────────────────────────── URL parsing ─────────────────────────────

/** Infer the LoraSource from a URL's host. */
export function detectSourceFromUrl(url: string): LoraSource {
  let host = '';
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return 'url';
  }
  // civitai.com plus its other domains (e.g. civitai.red for mature content); model ids are shared.
  if (/(^|\.)civitai\.[a-z]+$/.test(host)) return 'civitai';
  if (host.includes('huggingface.co')) return 'huggingface';
  return 'url';
}

export interface ParsedImportUrl {
  source: LoraSource;
  /** For civitai: a model-version id when the URL identifies one directly. */
  civitaiModelVersionId?: string;
  /** For civitai: a bare model id when only the model (not version) is known. */
  civitaiModelId?: string;
}

/**
 * Pure-ish helper usable by the route before creating the Lora row: figures out the source and,
 * for Civitai, whether the URL already pins a model-version id or only a model id.
 */
export function parseImportUrl(url: string): ParsedImportUrl {
  const source = detectSourceFromUrl(url);
  if (source !== 'civitai') return { source };

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { source };
  }

  // .../api/download/models/67890  or  .../model-versions/67890
  const versionFromPath = u.pathname.match(/\/(?:model-versions|api\/download\/models)\/(\d+)/);
  if (versionFromPath) return { source, civitaiModelVersionId: versionFromPath[1] };

  // ?modelVersionId=67890
  const versionParam = u.searchParams.get('modelVersionId');
  if (versionParam) return { source, civitaiModelVersionId: versionParam };

  // .../models/12345
  const modelFromPath = u.pathname.match(/\/models\/(\d+)/);
  if (modelFromPath) return { source, civitaiModelId: modelFromPath[1] };

  return { source };
}

// ───────────────────────────── filename sanitizing ─────────────────────────────

/** Strip anything not [A-Za-z0-9._-], ensure a .safetensors extension. */
function sanitizeBaseName(name: string): string {
  const stripped = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'lora';
  return stripped.toLowerCase().endsWith('.safetensors') ? stripped : `${stripped}.safetensors`;
}

/** Pick a filename that doesn't collide with an existing file in the loras dir. */
function uniqueLoraFilename(loraDir: string, desiredName: string): string {
  const safe = sanitizeBaseName(desiredName);
  const ext = '.safetensors';
  const base = safe.slice(0, -ext.length);
  let candidate = safe;
  let n = 2;
  while (fs.existsSync(path.join(loraDir, candidate))) {
    candidate = `${base}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

export function loraFamilyFromBaseModel(baseModel: string | undefined, fallback: LoraFamily): LoraFamily {
  if (!baseModel) return fallback;
  const lower = baseModel.toLowerCase();
  // Civitai base model names: "MiniMax H3", "Wan Video 2.2 I2V-A14B", "ZImageTurbo", "Qwen Image Edit"…
  if (lower.includes('minimax') || /\bh3\b/.test(lower)) return 'minimax_h3';
  if (lower.includes('wan')) return 'wan22';
  if (lower.includes('z-image') || lower.includes('zimage') || lower.includes('z image')) return 'zimage';
  if (lower.includes('qwen')) return 'qwen_edit';
  return fallback;
}

// ───────────────────────────── streaming download ─────────────────────────────

async function streamToFile(
  res: Response,
  destPath: string,
  totalBytesHint: number | undefined,
  onProgress: (bytesWritten: number, totalBytes: number | undefined) => void,
): Promise<number> {
  if (!res.body) throw new Error('Response has no body to stream');
  const headerLen = res.headers.get('content-length');
  const totalBytes = headerLen ? Number(headerLen) : totalBytesHint;

  let bytesWritten = 0;
  let lastReportedPct = -1;
  const nodeReadable = Readable.fromWeb(res.body as any);
  nodeReadable.on('data', (chunk: Buffer) => {
    bytesWritten += chunk.length;
    if (totalBytes) {
      const pct = Math.floor((bytesWritten / totalBytes) * 100);
      if (pct !== lastReportedPct) {
        lastReportedPct = pct;
        onProgress(bytesWritten, totalBytes);
      }
    } else {
      onProgress(bytesWritten, totalBytes);
    }
  });

  const writeStream = fs.createWriteStream(destPath);
  await pipeline(nodeReadable, writeStream);
  return bytesWritten;
}

// ───────────────────────────── civitai ─────────────────────────────

interface CivitaiFile {
  primary?: boolean;
  name: string;
  sizeKB?: number;
  downloadUrl: string;
}
interface CivitaiModelVersion {
  id: number;
  baseModel?: string;
  trainedWords?: string[];
  files: CivitaiFile[];
}
interface CivitaiModel {
  modelVersions: CivitaiModelVersion[];
}

/** Civitai API GET, authenticated when a token is set (mature models are hidden from anonymous calls). */
function civitaiApi(pathname: string): Promise<Response> {
  const token = resolveCivitaiToken();
  return fetch(`https://civitai.com/api/v1${pathname}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
}

async function fetchCivitaiVersion(parsed: ParsedImportUrl): Promise<CivitaiModelVersion> {
  if (parsed.civitaiModelVersionId) {
    const res = await civitaiApi(`/model-versions/${parsed.civitaiModelVersionId}`);
    if (!res.ok) throw new Error(`Civitai model-version lookup failed: ${res.status}`);
    return (await res.json()) as CivitaiModelVersion;
  }
  if (parsed.civitaiModelId) {
    const res = await civitaiApi(`/models/${parsed.civitaiModelId}`);
    if (!res.ok) throw new Error(`Civitai model lookup failed: ${res.status}`);
    const model = (await res.json()) as CivitaiModel;
    const version = model.modelVersions?.[0];
    if (!version) throw new Error('Civitai model has no versions');
    return version;
  }
  throw new Error('Could not determine a Civitai model or model-version id from the URL');
}

function pickCivitaiFile(version: CivitaiModelVersion): CivitaiFile {
  const files = version.files ?? [];
  const primary = files.find((f) => f.primary);
  if (primary) return primary;
  const safetensor = files.find((f) => f.name?.toLowerCase().endsWith('.safetensors'));
  if (safetensor) return safetensor;
  throw new Error('No .safetensors file found on this Civitai model version');
}

async function downloadCivitai(
  url: string,
  loraDir: string,
  fallbackFamily: LoraFamily,
  onProgress: (frac: number, stage?: string) => void,
): Promise<{ safeName: string; bytesWritten: number; family: LoraFamily; triggerWord?: string }> {
  const parsed = parseImportUrl(url);
  const version = await fetchCivitaiVersion(parsed);
  const file = pickCivitaiFile(version);
  const family = loraFamilyFromBaseModel(version.baseModel, fallbackFamily);
  const triggerWord = version.trainedWords?.[0];

  let downloadUrl = file.downloadUrl;
  const civitaiToken = resolveCivitaiToken();
  if (civitaiToken) {
    const sep = downloadUrl.includes('?') ? '&' : '?';
    downloadUrl = `${downloadUrl}${sep}token=${encodeURIComponent(civitaiToken)}`;
  }

  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Civitai file download failed: ${res.status}`);

  const safeName = uniqueLoraFilename(loraDir, file.name);
  const destPath = path.join(loraDir, safeName);
  const totalBytesHint = file.sizeKB ? file.sizeKB * 1024 : undefined;
  const bytesWritten = await streamToFile(res, destPath, totalBytesHint, (written, total) => {
    onProgress(total ? written / total : 0, `Downloading ${file.name}`);
  });

  return { safeName, bytesWritten, family, triggerWord };
}

// ───────────────────────────── hugging face ─────────────────────────────

function normalizeHfUrl(url: string): { resolveUrl: string; filenameHint: string } {
  const u = new URL(url);
  // .../<repo...>/blob/<rev>/<path>  or  .../<repo...>/resolve/<rev>/<path>
  const m = u.pathname.match(/^\/(.+?)\/(blob|resolve)\/(.+)$/);
  if (!m) {
    // Not a recognizable HF file URL; fall back to using it as-is (direct download).
    const filenameHint = u.pathname.split('/').pop() || 'lora';
    return { resolveUrl: url, filenameHint };
  }
  const [, repo, , rest] = m;
  const resolveUrl = `https://huggingface.co/${repo}/resolve/${rest}?download=true`;
  const filenameHint = rest.split('/').pop() || 'lora';
  return { resolveUrl, filenameHint };
}

async function downloadHuggingFace(
  url: string,
  loraDir: string,
  onProgress: (frac: number, stage?: string) => void,
): Promise<{ safeName: string; bytesWritten: number }> {
  const { resolveUrl, filenameHint } = normalizeHfUrl(url);
  const headers: Record<string, string> = {};
  const hfToken = resolveHfToken();
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`;

  const res = await fetch(resolveUrl, { headers });
  if (!res.ok) throw new Error(`Hugging Face file download failed: ${res.status}`);

  const safeName = uniqueLoraFilename(loraDir, filenameHint);
  const destPath = path.join(loraDir, safeName);
  const bytesWritten = await streamToFile(res, destPath, undefined, (written, total) => {
    onProgress(total ? written / total : 0, `Downloading ${filenameHint}`);
  });

  return { safeName, bytesWritten };
}

// ───────────────────────────── direct URL ─────────────────────────────

async function downloadDirectUrl(
  url: string,
  loraDir: string,
  onProgress: (frac: number, stage?: string) => void,
): Promise<{ safeName: string; bytesWritten: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const filenameHint = (() => {
    try {
      return new URL(url).pathname.split('/').pop() || 'lora';
    } catch {
      return 'lora';
    }
  })();

  const safeName = uniqueLoraFilename(loraDir, filenameHint);
  const destPath = path.join(loraDir, safeName);
  const bytesWritten = await streamToFile(res, destPath, undefined, (written, total) => {
    onProgress(total ? written / total : 0, `Downloading ${filenameHint}`);
  });

  return { safeName, bytesWritten };
}

// ───────────────────────────── job runner ─────────────────────────────

registerRunner('lora_download', async (job, ctx) => {
  const params = job.params as Record<string, unknown>;
  const loraId = typeof params.loraId === 'string' ? params.loraId : undefined;
  const url = typeof params.url === 'string' ? params.url : undefined;
  const family: LoraFamily | undefined =
    params.family === 'zimage' || params.family === 'wan22' || params.family === 'qwen_edit' || params.family === 'minimax_h3'
      ? (params.family as LoraFamily)
      : undefined;

  if (!loraId) throw new Error('lora_download job is missing params.loraId');
  if (!url) throw new Error('lora_download job is missing params.url');

  const loraDir = path.join(MODELS_DIR, 'loras');
  fs.mkdirSync(loraDir, { recursive: true });

  ctx.setProgress(0, 'Starting download');

  try {
    const source = detectSourceFromUrl(url);
    let result: { safeName: string; bytesWritten: number; family?: LoraFamily; triggerWord?: string };

    if (source === 'civitai') {
      result = await downloadCivitai(url, loraDir, family ?? 'zimage', (frac, stage) => ctx.setProgress(frac, stage));
    } else if (source === 'huggingface') {
      const hf = await downloadHuggingFace(url, loraDir, (frac, stage) => ctx.setProgress(frac, stage));
      result = { ...hf, family: family ?? 'zimage' };
    } else {
      const direct = await downloadDirectUrl(url, loraDir, (frac, stage) => ctx.setProgress(frac, stage));
      result = { ...direct, family: family ?? 'zimage' };
    }

    const patch: Parameters<typeof loras.update>[1] = {
      status: 'ready',
      filename: result.safeName,
      sizeBytes: result.bytesWritten,
    };
    if (result.family) patch.family = result.family;
    if (result.triggerWord) patch.triggerWord = result.triggerWord;

    loras.update(loraId, patch);
    const updated = loras.get(loraId);
    if (updated) emit({ type: 'lora', lora: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loras.update(loraId, { status: 'error', error: message });
    const errored = loras.get(loraId);
    if (errored) emit({ type: 'lora', lora: errored });
    throw err;
  }
});

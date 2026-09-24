// Shared helpers for job runners: saving ComfyUI outputs as assets, thumbnails, size probing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR } from '../config';
import { assets as assetsRepo, loras as lorasRepo, newId } from '../db';
import { emit } from '../events';
import type { Asset, AssetKind, AssetOrigin, EngineId, ID, LoraRef } from '../../shared/types';
import type { ComfyClient, ComfyOutputFile } from '../comfy/client';
import type { LoraFile } from '../comfy/workflows';

const execFileAsync = promisify(execFile);

let ffmpegChecked: boolean | undefined;
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== undefined) return ffmpegChecked;
  try {
    await execFileAsync('ffmpeg', ['-version']);
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

/** Read PNG (IHDR) or JPEG (SOF marker) headers ourselves rather than pulling in an image library. */
export function probeImageSize(buf: Buffer): { width: number; height: number } {
  // PNG: 8-byte signature, then IHDR chunk with width/height as big-endian u32 at offset 16/20.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: scan markers for a SOFn (0xC0-0xCF, excluding C4/C8/CC) segment; height/width follow at +5/+7.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }
  return { width: 0, height: 0 };
}

function monthDir(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function resolveSeed(seed?: number): number {
  return seed ?? Math.floor(Math.random() * 2 ** 31);
}

export interface SaveOutputOpts {
  kind: AssetKind;
  origin: AssetOrigin;
  ext: string; // 'png' | 'jpg' | 'mp4'
  bytes: Buffer;
  prompt?: string;
  engine?: EngineId;
  params?: Record<string, unknown>;
  jobId?: ID;
  projectId?: ID;
  shotId?: ID;
  fps?: number;
}

/** Write a media file under DATA_DIR/media/<yyyy-mm>/<id>.<ext>, probe dims, make a thumb for video, and record an Asset. */
export async function saveAsset(opts: SaveOutputOpts): Promise<Asset> {
  const id = newId();
  const dir = path.join(DATA_DIR, 'media', monthDir());
  await fs.mkdir(dir, { recursive: true });
  const relFile = path.join(monthDir(), `${id}.${opts.ext}`);
  await fs.writeFile(path.join(dir, `${id}.${opts.ext}`), opts.bytes);

  let width = 0;
  let height = 0;
  let thumb: string | undefined;
  let durationSec: number | undefined;

  if (opts.kind === 'image') {
    ({ width, height } = probeImageSize(opts.bytes));
    // Gallery thumbnail: 640px-wide JPEG (~60 KB vs ~1–2 MB PNG) so grids load fast over the proxy.
    if (await hasFfmpeg()) {
      try {
        await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, `${id}.${opts.ext}`), '-vf', "scale='min(640,iw)':-2", '-q:v', '4', path.join(dir, `${id}.thumb.jpg`)]);
        thumb = path.join(monthDir(), `${id}.thumb.jpg`);
      } catch {
        thumb = undefined;
      }
    }
  } else {
    // Video: probe via ffprobe if available, else fall back to 0 (still a valid asset).
    if (await hasFfmpeg()) {
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,duration',
          '-of', 'json',
          path.join(dir, `${id}.${opts.ext}`),
        ]);
        const info = JSON.parse(stdout);
        const stream = info.streams?.[0];
        width = Number(stream?.width) || 0;
        height = Number(stream?.height) || 0;
        durationSec = Number(stream?.duration) || undefined;
      } catch {
        // ffprobe missing or file not decodable (e.g. mock's placeholder bytes) — leave 0/undefined
      }
      // Poster thumbnail.
      try {
        const thumbRel = path.join(monthDir(), `${id}.jpg`);
        await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0', '-i', path.join(dir, `${id}.${opts.ext}`), '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', path.join(dir, `${id}.jpg`)]);
        thumb = thumbRel;
      } catch {
        thumb = undefined;
      }
    }
  }

  const asset = assetsRepo.create({
    id,
    kind: opts.kind,
    origin: opts.origin,
    file: relFile,
    thumb,
    width,
    height,
    durationSec,
    fps: opts.fps,
    prompt: opts.prompt,
    engine: opts.engine,
    params: opts.params,
    jobId: opts.jobId,
    projectId: opts.projectId,
    shotId: opts.shotId,
    favorite: false,
  });
  emit({ type: 'asset', asset });
  return asset;
}

/** Download a ComfyUI output and save it as an Asset. */
export async function saveComfyOutput(
  comfy: ComfyClient,
  file: ComfyOutputFile,
  opts: Omit<SaveOutputOpts, 'kind' | 'ext' | 'bytes'>,
): Promise<Asset> {
  const bytes = await comfy.downloadOutput(file);
  const ext = file.isVideo ? 'mp4' : path.extname(file.filename).replace('.', '') || 'png';
  return saveAsset({ ...opts, kind: file.isVideo ? 'video' : 'image', ext, bytes, fps: file.isVideo ? opts.fps ?? 16 : undefined });
}

export function assetDiskPath(asset: Asset): string {
  return path.join(DATA_DIR, 'media', asset.file);
}

/** Resolve GenerateRequest/shot LoraRefs into the {filename, strength, expert} shape workflows.ts wants. */
export function toLoraFiles(refs: LoraRef[] | undefined): LoraFile[] {
  if (!refs?.length) return [];
  const files: LoraFile[] = [];
  for (const ref of refs) {
    const lora = lorasRepo.get(ref.loraId);
    if (!lora || lora.status !== 'ready') continue;
    files.push({ filename: lora.filename, strength: ref.strength, expert: ref.expert });
  }
  return files;
}

/** Upload an existing asset's file to ComfyUI so it can be used as a LoadImage input. */
export async function uploadAssetToComfy(comfy: ComfyClient, asset: Asset): Promise<string> {
  const bytes = await fs.readFile(assetDiskPath(asset));
  const ext = path.extname(asset.file) || '.png';
  return comfy.uploadImage(bytes, `${asset.id}${ext}`);
}

/** Backfill gallery thumbnails for images saved before thumbnails existed (runs once at startup). */
export async function backfillImageThumbs(): Promise<number> {
  if (!(await hasFfmpeg())) return 0;
  let made = 0;
  for (const a of assetsRepo.listImagesWithoutThumb()) {
    const src = path.join(DATA_DIR, 'media', a.file);
    const rel = a.file.replace(/\.[a-z0-9]+$/i, '.thumb.jpg');
    try {
      await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='min(640,iw)':-2", '-q:v', '4', path.join(DATA_DIR, 'media', rel)]);
      assetsRepo.update(a.id, { thumb: rel });
      made++;
    } catch {
      // missing/corrupt source: leave it without a thumb
    }
  }
  return made;
}

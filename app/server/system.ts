// Combines ComfyUI stats, the model download status file, and computed engine availability.
//
// Engine availability approach (documented per the task spec, which allows either the filesystem
// or ComfyUI's own /object_info as the source of truth): we ask ComfyUI's /object_info for the
// UNETLoader/CLIPLoader/VAELoader/LoraLoaderModelOnly dropdown options, which reflect whatever
// files are actually present in ComfyUI's configured model folders, and check each engine's
// required filenames (workflows.ts ENGINE_FILES) against that set. This works identically against
// a real ComfyUI and against dev/mock-comfy.ts (which serves the same filenames), so we don't need
// a second code path for "real files on disk" vs "the mock". When COMFY_MOCK=1 we still short-circuit
// to "all available" purely to avoid a network round trip during tests.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { AI_TOOLKIT_DIR, COMFY_MOCK, DATA_DIR, IS_RUNPOD, MODELS_DIR, MODELS_STATUS_FILE, RUNPOD_POD_ID, RUNPOD_ROOT_DIR, VERSION, WORKSPACE_DIR } from './config';
import type { ComfyClient } from './comfy/client';
import { ENGINE_FILES, H3_FILES, LTX_FILES, LTX_INGREDIENTS_FILES } from './comfy/workflows';
import { isLlmConfigured } from './ai/llm';
import { markMilestone } from './milestones';
import { tts, type TtsHealth } from './tts/client';
import type { EngineId, EngineState, ModelGroupId, ModelGroupStatus, SystemInfo, VideoModelId } from '../shared/types';

async function readModelsStatus(): Promise<ModelGroupStatus[]> {
  try {
    const raw = await fs.readFile(MODELS_STATUS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { groups?: ModelGroupStatus[] };
    return parsed.groups ?? [];
  } catch {
    return [];
  }
}

const ALL_TRUE: Record<EngineId, boolean> = { zimage: true, qwen_edit: true, qwen_angle: true, wan_i2v: true, wan_t2v: true, wan_animate: true, wan_control: true, wan_vace: true, h3_ref: true, ltx_ic: true, upscale_4k: true };
const ALL_FALSE: Record<EngineId, boolean> = { zimage: false, qwen_edit: false, qwen_angle: false, wan_i2v: false, wan_t2v: false, wan_animate: false, wan_control: false, wan_vace: false, h3_ref: false, ltx_ic: false, upscale_4k: false };

/** Which engines' own model files are present, plus the opt-in MiniMax H3 and LTX-2.5 video backends. */
export type FileAvailability = Record<EngineId, boolean> & { minimax_h3: boolean; ltx_2_5: boolean };

export async function computeFileAvailability(comfy: ComfyClient): Promise<FileAvailability> {
  if (COMFY_MOCK)
    return {
      ...ALL_TRUE,
      h3_ref: process.env.MOCK_MINIMAX === '1',
      minimax_h3: process.env.MOCK_MINIMAX === '1',
      ltx_2_5: process.env.MOCK_LTX === '1',
      wan_vace: process.env.MOCK_WAN_VACE === '1',
      ltx_ic: process.env.MOCK_LTX_IC === '1' || process.env.MOCK_LTX_INGREDIENTS === '1',
      upscale_4k: process.env.MOCK_UPSCALE === '1',
    };
  try {
    const info = await comfy.objectInfo();
    const available = new Set<string>();
    for (const nodeClass of ['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'CLIPVisionLoader', 'LatentUpscaleModelLoader']) {
      const required = info?.[nodeClass]?.input?.required ?? {};
      for (const value of Object.values(required) as unknown[]) {
        if (!Array.isArray(value)) continue;
        // Classic nodes list options as [[…files]]; newer (io.ComfyNode) ones, like LatentUpscaleModelLoader,
        // as ["COMBO", { options: […files] }].
        const options = Array.isArray(value[0]) ? value[0] : value[0] === 'COMBO' ? (value[1] as { options?: unknown })?.options : undefined;
        if (Array.isArray(options)) for (const f of options) available.add(String(f));
      }
    }
    // The SeedVR2 node pack's dropdowns list every model it could download, present or not, so its files are
    // checked on disk instead (the downloader moves a file into place only once it's complete).
    for (const f of await fs.readdir(path.join(MODELS_DIR, 'SEEDVR2')).catch(() => [] as string[])) available.add(f);
    const result = {} as FileAvailability;
    for (const engine of Object.keys(ENGINE_FILES) as EngineId[]) {
      result[engine] = ENGINE_FILES[engine].every((f) => available.has(f));
    }
    result.minimax_h3 = H3_FILES.every((f) => available.has(f)) && Boolean(info?.MiniMaxH3ImageToVideo);
    result.h3_ref = result.h3_ref && Boolean(info?.MiniMaxH3ReferenceToVideo);
    result.ltx_2_5 = LTX_FILES.every((f) => available.has(f)) && Boolean(info?.LTXVDualCFGGuider);
    result.wan_vace = result.wan_vace && Boolean(info?.WanVaceToVideo);
    // ltx_ic covers three independent modes (control video, reference sheet, or both): ready once either the
    // union-control LoRA or the Ingredients LoRA is installed alongside the base 'ltx' files.
    const ltxIngredientsReady = LTX_INGREDIENTS_FILES.every((f) => available.has(f));
    result.ltx_ic = (result.ltx_ic || ltxIngredientsReady) && Boolean(info?.GetICLoRAParameters);
    result.upscale_4k = result.upscale_4k && Boolean(info?.SeedVR2VideoUpscaler);
    return result;
  } catch {
    return { ...ALL_FALSE, minimax_h3: false, ltx_2_5: false };
  }
}

/** The model that renders video clips: whichever is installed (LTX-2.5, then H3, then Wan; see pickVideoModel —
 *  LTX-2.5 + the Ingredients/previs workflow is the studio's default template as of the Coast Road bake-off,
 *  docs/research/2026-09-model-ledger.md), else the one still downloading, so the UI offers the right clip
 *  lengths before the files land. */
/** Video models whose files are all present, in the order resolveVideoModel prefers them. */
export function installedVideoModels(files: FileAvailability): VideoModelId[] {
  const out: VideoModelId[] = [];
  if (files.ltx_2_5) out.push('ltx_2_5');
  if (files.minimax_h3) out.push('minimax_h3');
  if (files.wan_i2v || files.wan_t2v) out.push('wan');
  return out;
}

export function resolveVideoModel(files: FileAvailability, models: ModelGroupStatus[]): VideoModelId | null {
  if (files.ltx_2_5) return 'ltx_2_5';
  if (files.minimax_h3) return 'minimax_h3';
  if (files.wan_i2v || files.wan_t2v) return 'wan';
  const planned = (id: ModelGroupStatus['id']) => models.some((m) => m.id === id && m.enabled);
  if (planned('ltx')) return 'ltx_2_5';
  if (planned('minimax')) return 'minimax_h3';
  return planned('video') || planned('t2v') ? 'wan' : null;
}

/** Engine availability where Video / text→video also count as ready when an opt-in backend can render them. */
function withVideoBackends({ minimax_h3, ltx_2_5, ...files }: FileAvailability): Record<EngineId, boolean> {
  const alt = minimax_h3 || ltx_2_5;
  return { ...files, wan_i2v: files.wan_i2v || alt, wan_t2v: files.wan_t2v || alt };
}

export async function currentVideoModel(comfy: ComfyClient): Promise<VideoModelId | null> {
  const [models, files] = await Promise.all([readModelsStatus(), computeFileAvailability(comfy)]);
  return resolveVideoModel(files, models);
}

/** What the studio can do: video engines count as available when Wan, MiniMax H3 or LTX-2.5 can render them. */
export async function computeEngineAvailability(comfy: ComfyClient): Promise<Record<EngineId, boolean>> {
  return withVideoBackends(await computeFileAvailability(comfy));
}

/** Model groups each engine needs. Text-to-video also works as image → video (Z-Image keyframe + Wan I2V). */
const ENGINE_GROUPS: Record<EngineId, ModelGroupId[][]> = {
  zimage: [['image']],
  qwen_edit: [['edit']],
  qwen_angle: [['edit']],
  wan_i2v: [['video'], ['minimax'], ['ltx']],
  wan_t2v: [['t2v'], ['image', 'video'], ['minimax'], ['ltx']],
  wan_animate: [['perform']],
  wan_control: [['control']],
  wan_vace: [['wan_vace']],
  h3_ref: [['minimax_ref']],
  ltx_ic: [['ltx', 'ltx_ic'], ['ltx', 'ltx_ingredients']],
  upscale_4k: [['upscale']],
};

export function computeEngineState(engines: Record<EngineId, boolean>, models: ModelGroupStatus[]): Record<EngineId, EngineState> {
  // No status file (local dev / mock): everything counts as planned.
  const planned = new Set<ModelGroupId>(models.length ? models.filter((m) => m.enabled).map((m) => m.id) : ['image', 'video', 'edit', 'perform', 't2v']);
  const out = {} as Record<EngineId, EngineState>;
  for (const engine of Object.keys(ENGINE_GROUPS) as EngineId[]) {
    const ready = engines[engine] || (engine === 'wan_t2v' && engines.zimage && engines.wan_i2v);
    const inPlan = ENGINE_GROUPS[engine].some((alt) => alt.every((g) => planned.has(g)));
    out[engine] = ready ? 'ready' : inPlan ? 'downloading' : 'off';
  }
  return out;
}

/** Character voices: ready when the sidecar answers with both Qwen3-TTS models on disk; 'downloading' while
 *  the voice group is in this pod's plan (or everything is, in local dev without a status file). */
export function computeVoiceState(health: TtsHealth | null, models: ModelGroupStatus[]): EngineState {
  if (health?.ok && Object.values(health.models).length > 0 && Object.values(health.models).every(Boolean)) return 'ready';
  const planned = models.length === 0 || models.some((m) => m.id === 'voice' && m.enabled);
  return planned ? 'downloading' : 'off';
}

export async function isVoiceReady(): Promise<boolean> {
  const [health, models] = await Promise.all([tts.health(), readModelsStatus()]);
  return computeVoiceState(health, models) === 'ready';
}

export async function isEngineAvailable(comfy: ComfyClient, engine: EngineId): Promise<boolean> {
  const av = await computeEngineAvailability(comfy);
  return av[engine];
}

/** Minimal stat shape we need, so tests can inject fake devices without touching the real filesystem. */
export interface StatLike {
  statSync: (p: string) => { dev: number };
}

/** True when `workspacePath` sits on the same device as `rootPath` — i.e. it's just a folder on the
 *  container's own (small) disk rather than a separately mounted Runpod volume. A missing path (fresh
 *  dev checkout, or a container that never created /workspace) counts as "not a volume" so the caller
 *  still warns instead of silently assuming the best case. */
export function isWorkspaceOnRootDevice(workspacePath: string, rootPath: string, deps: StatLike = fsSync): boolean {
  try {
    return deps.statSync(workspacePath).dev === deps.statSync(rootPath).dev;
  } catch {
    return true;
  }
}

/** Bytes the downloader still has left to fetch for groups this pod's preset enabled. Ready groups
 *  contribute 0 (their downloadedBytes already equals totalBytes). */
export function remainingDownloadBytes(models: ModelGroupStatus[]): number {
  return models.filter((m) => m.enabled).reduce((sum, m) => sum + Math.max(0, m.totalBytes - m.downloadedBytes), 0);
}

export type StorageWarning = 'no-volume' | 'low-space';

export function computeStorageWarning(workspaceIsVolume: boolean, freeBytes: number, neededBytes: number): StorageWarning | undefined {
  if (!workspaceIsVolume) return 'no-volume';
  if (neededBytes > 0 && freeBytes < neededBytes) return 'low-space';
  return undefined;
}

export function computeStorageInfo(params: {
  runningOnRunpod: boolean;
  workspacePath: string;
  rootPath: string;
  freeBytes: number;
  neededBytes: number;
  deps?: StatLike;
}): SystemInfo['storage'] {
  const { runningOnRunpod, workspacePath, rootPath, freeBytes, neededBytes, deps } = params;
  const freeGb = freeBytes / 1e9;
  const neededGb = neededBytes > 0 ? neededBytes / 1e9 : undefined;
  // Local dev / non-Runpod hosts don't have a volume concept at all — never warn there.
  if (!runningOnRunpod) return { workspaceIsVolume: true, freeGb, neededGb };
  const workspaceIsVolume = !isWorkspaceOnRootDevice(workspacePath, rootPath, deps);
  return { workspaceIsVolume, freeGb, neededGb, warning: computeStorageWarning(workspaceIsVolume, freeBytes, neededBytes) };
}

export async function getSystemInfo(comfy: ComfyClient): Promise<SystemInfo> {
  const [stats, models, files, ttsHealth] = await Promise.all([comfy.systemStats(), readModelsStatus(), computeFileAvailability(comfy), tts.health()]);
  const engines = withVideoBackends(files);

  let disk = { totalBytes: 0, freeBytes: 0 };
  try {
    const st = await fs.statfs(MODELS_DIR);
    disk = { totalBytes: st.bsize * st.blocks, freeBytes: st.bsize * st.bavail };
  } catch {
    // statfs unsupported or path missing (e.g. fresh dev checkout without a models dir yet)
  }

  const storage = computeStorageInfo({
    runningOnRunpod: IS_RUNPOD,
    workspacePath: WORKSPACE_DIR,
    rootPath: RUNPOD_ROOT_DIR,
    freeBytes: disk.freeBytes,
    neededBytes: remainingDownloadBytes(models),
  });

  // Written by docker/start.sh at boot (see "GPU self-check").
  let gpuCheck: SystemInfo['gpuCheck'];
  try {
    gpuCheck = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'gpu-check.json'), 'utf8'));
  } catch {
    gpuCheck = undefined;
  }

  const videoModel = resolveVideoModel(files, models);
  if (videoModel) markMilestone('videoModelsReadyAt'); // polled every 10 s by the UI; set-once

  return {
    version: VERSION,
    comfy: { online: stats.online, queueRemaining: stats.queueRemaining, vramTotalMB: stats.vramTotalMB, vramFreeMB: stats.vramFreeMB, gpuName: stats.gpuName },
    models,
    engines,
    engineState: computeEngineState(engines, models),
    videoModel,
    videoModels: installedVideoModels(files),
    voice: computeVoiceState(ttsHealth, models),
    llmConfigured: isLlmConfigured(),
    trainerInstalled: fsSync.existsSync(path.join(AI_TOOLKIT_DIR, 'run.py')),
    disk,
    podId: RUNPOD_POD_ID,
    storage,
    gpuCheck,
  };
}

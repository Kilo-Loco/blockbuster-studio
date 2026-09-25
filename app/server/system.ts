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
import { AI_TOOLKIT_DIR, COMFY_MOCK, DATA_DIR, MODELS_DIR, MODELS_STATUS_FILE, RUNPOD_POD_ID, VERSION } from './config';
import type { ComfyClient } from './comfy/client';
import { ENGINE_FILES, H3_FILES } from './comfy/workflows';
import { isLlmConfigured } from './ai/llm';
import type { EngineId, EngineState, ModelGroupId, ModelGroupStatus, SystemInfo } from '../shared/types';

async function readModelsStatus(): Promise<ModelGroupStatus[]> {
  try {
    const raw = await fs.readFile(MODELS_STATUS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { groups?: ModelGroupStatus[] };
    return parsed.groups ?? [];
  } catch {
    return [];
  }
}

const ALL_TRUE: Record<EngineId, boolean> = { zimage: true, qwen_edit: true, qwen_angle: true, wan_i2v: true, wan_t2v: true, wan_animate: true };
const ALL_FALSE: Record<EngineId, boolean> = { zimage: false, qwen_edit: false, qwen_angle: false, wan_i2v: false, wan_t2v: false, wan_animate: false };

/** Which engines' own model files are present, plus the opt-in MiniMax H3 video backend. */
export type FileAvailability = Record<EngineId, boolean> & { minimax_h3: boolean };

export async function computeFileAvailability(comfy: ComfyClient): Promise<FileAvailability> {
  if (COMFY_MOCK) return { ...ALL_TRUE, minimax_h3: process.env.MOCK_MINIMAX === '1' };
  try {
    const info = await comfy.objectInfo();
    const available = new Set<string>();
    for (const nodeClass of ['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'CLIPVisionLoader']) {
      const required = info?.[nodeClass]?.input?.required ?? {};
      for (const value of Object.values(required) as unknown[]) {
        if (Array.isArray(value) && Array.isArray(value[0])) {
          for (const f of value[0] as unknown[]) available.add(String(f));
        }
      }
    }
    const result = {} as FileAvailability;
    for (const engine of Object.keys(ENGINE_FILES) as EngineId[]) {
      result[engine] = ENGINE_FILES[engine].every((f) => available.has(f));
    }
    result.minimax_h3 = H3_FILES.every((f) => available.has(f)) && Boolean(info?.MiniMaxH3ImageToVideo);
    return result;
  } catch {
    return { ...ALL_FALSE, minimax_h3: false };
  }
}

/** What the studio can do: video engines count as available when either Wan or MiniMax H3 can render them. */
export async function computeEngineAvailability(comfy: ComfyClient): Promise<Record<EngineId, boolean>> {
  const { minimax_h3, ...files } = await computeFileAvailability(comfy);
  return { ...files, wan_i2v: files.wan_i2v || minimax_h3, wan_t2v: files.wan_t2v || minimax_h3 };
}

/** Model groups each engine needs. Text-to-video also works as image → video (Z-Image keyframe + Wan I2V). */
const ENGINE_GROUPS: Record<EngineId, ModelGroupId[][]> = {
  zimage: [['image']],
  qwen_edit: [['edit']],
  qwen_angle: [['edit']],
  wan_i2v: [['video'], ['minimax']],
  wan_t2v: [['t2v'], ['image', 'video'], ['minimax']],
  wan_animate: [['perform']],
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

export async function isEngineAvailable(comfy: ComfyClient, engine: EngineId): Promise<boolean> {
  const av = await computeEngineAvailability(comfy);
  return av[engine];
}

export async function getSystemInfo(comfy: ComfyClient): Promise<SystemInfo> {
  const [stats, models, files] = await Promise.all([comfy.systemStats(), readModelsStatus(), computeFileAvailability(comfy)]);
  const { minimax_h3, ...engineFiles } = files;
  const engines = { ...engineFiles, wan_i2v: engineFiles.wan_i2v || minimax_h3, wan_t2v: engineFiles.wan_t2v || minimax_h3 };

  let disk = { totalBytes: 0, freeBytes: 0 };
  try {
    const st = await fs.statfs(MODELS_DIR);
    disk = { totalBytes: st.bsize * st.blocks, freeBytes: st.bsize * st.bavail };
  } catch {
    // statfs unsupported or path missing (e.g. fresh dev checkout without a models dir yet)
  }

  // Written by docker/start.sh at boot (see "GPU self-check").
  let gpuCheck: SystemInfo['gpuCheck'];
  try {
    gpuCheck = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'gpu-check.json'), 'utf8'));
  } catch {
    gpuCheck = undefined;
  }

  return {
    version: VERSION,
    comfy: { online: stats.online, queueRemaining: stats.queueRemaining, vramTotalMB: stats.vramTotalMB, vramFreeMB: stats.vramFreeMB, gpuName: stats.gpuName },
    models,
    engines,
    engineState: computeEngineState(engines, models),
    videoModel: minimax_h3 ? 'minimax_h3' : engineFiles.wan_i2v || engineFiles.wan_t2v ? 'wan' : null,
    llmConfigured: isLlmConfigured(),
    trainerInstalled: fsSync.existsSync(path.join(AI_TOOLKIT_DIR, 'run.py')),
    disk,
    podId: RUNPOD_POD_ID,
    gpuCheck,
  };
}

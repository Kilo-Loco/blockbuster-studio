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
import { AI_TOOLKIT_DIR, COMFY_MOCK, MODELS_DIR, MODELS_STATUS_FILE, RUNPOD_POD_ID, VERSION } from './config';
import type { ComfyClient } from './comfy/client';
import { ENGINE_FILES } from './comfy/workflows';
import { isLlmConfigured } from './ai/llm';
import type { EngineId, ModelGroupStatus, SystemInfo } from '../shared/types';

async function readModelsStatus(): Promise<ModelGroupStatus[]> {
  try {
    const raw = await fs.readFile(MODELS_STATUS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { groups?: ModelGroupStatus[] };
    return parsed.groups ?? [];
  } catch {
    return [];
  }
}

const ALL_TRUE: Record<EngineId, boolean> = { zimage: true, qwen_edit: true, qwen_angle: true, wan_i2v: true, wan_t2v: true };
const ALL_FALSE: Record<EngineId, boolean> = { zimage: false, qwen_edit: false, qwen_angle: false, wan_i2v: false, wan_t2v: false };

export async function computeEngineAvailability(comfy: ComfyClient): Promise<Record<EngineId, boolean>> {
  if (COMFY_MOCK) return { ...ALL_TRUE };
  try {
    const info = await comfy.objectInfo();
    const available = new Set<string>();
    for (const nodeClass of ['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly']) {
      const required = info?.[nodeClass]?.input?.required ?? {};
      for (const value of Object.values(required) as unknown[]) {
        if (Array.isArray(value) && Array.isArray(value[0])) {
          for (const f of value[0] as unknown[]) available.add(String(f));
        }
      }
    }
    const result = {} as Record<EngineId, boolean>;
    for (const engine of Object.keys(ENGINE_FILES) as EngineId[]) {
      result[engine] = ENGINE_FILES[engine].every((f) => available.has(f));
    }
    return result;
  } catch {
    return { ...ALL_FALSE };
  }
}

export async function isEngineAvailable(comfy: ComfyClient, engine: EngineId): Promise<boolean> {
  const av = await computeEngineAvailability(comfy);
  return av[engine];
}

export async function getSystemInfo(comfy: ComfyClient): Promise<SystemInfo> {
  const [stats, models, engines] = await Promise.all([comfy.systemStats(), readModelsStatus(), computeEngineAvailability(comfy)]);

  let disk = { totalBytes: 0, freeBytes: 0 };
  try {
    const st = await fs.statfs(MODELS_DIR);
    disk = { totalBytes: st.bsize * st.blocks, freeBytes: st.bsize * st.bavail };
  } catch {
    // statfs unsupported or path missing (e.g. fresh dev checkout without a models dir yet)
  }

  return {
    version: VERSION,
    comfy: { online: stats.online, queueRemaining: stats.queueRemaining, vramTotalMB: stats.vramTotalMB, vramFreeMB: stats.vramFreeMB, gpuName: stats.gpuName },
    models,
    engines,
    llmConfigured: isLlmConfigured(),
    trainerInstalled: fsSync.existsSync(path.join(AI_TOOLKIT_DIR, 'run.py')),
    disk,
    podId: RUNPOD_POD_ID,
  };
}

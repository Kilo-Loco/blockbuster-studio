// Persistent single-worker FIFO GPU queue, backed by the `jobs` table in SQLite.
import fs from 'node:fs';
import { DATA_DIR } from '../config';
import { jobs as jobsRepo, now } from '../db';
import { emit } from '../events';
import type { ID, Job, JobType } from '../../shared/types';
import { ComfyClient } from '../comfy/client';

export interface RunnerContext {
  comfy: ComfyClient;
  isCanceled(): boolean;
  setProgress(frac: number, stage?: string): void;
  addOutput(assetId: ID): void;
}

export type JobRunner = (job: Job, ctx: RunnerContext) => Promise<void>;

const runners = new Map<JobType, JobRunner>();

export function registerRunner(type: JobType, runner: JobRunner) {
  runners.set(type, runner);
}

let comfyClient: ComfyClient | null = null;
let processing = false;
let currentJobId: ID | null = null;
const canceledJobs = new Set<ID>();
const lastProgressEmit = new Map<ID, number>();
const PROGRESS_THROTTLE_MS = 250; // ~4/s

export function init(comfy: ComfyClient) {
  comfyClient = comfy;
}

/** Mark any jobs left `running` from a previous process as interrupted, and recompute positions. */
export function recoverOnStartup() {
  for (const job of jobsRepo.listByStatus('running')) {
    jobsRepo.update(job.id, { status: 'error', error: 'interrupted by restart', finishedAt: now() });
    emit({ type: 'job', job: jobsRepo.get(job.id)! });
  }
  recomputeQueuePositions();
}

function recomputeQueuePositions() {
  const queued = jobsRepo.list({ active: true }).filter((j) => j.status === 'queued');
  queued.forEach((j, i) => {
    const pos = i + 1;
    if (j.queuePosition !== pos) {
      jobsRepo.update(j.id, { queuePosition: pos });
      emit({ type: 'job', job: jobsRepo.get(j.id)! });
    }
  });
}

/** Free bytes on the data volume below which new GPU work is refused (outputs + DB need room). */
const MIN_FREE_BYTES = 3 * 1024 ** 3;

export class DiskFullError extends Error {
  status = 507;
}

function assertDiskSpace() {
  try {
    const st = fs.statfsSync(DATA_DIR);
    const free = st.bavail * st.bsize;
    if (free < MIN_FREE_BYTES) {
      throw new DiskFullError(
        `The pod's storage is almost full (${(free / 1e9).toFixed(1)} GB free). Delete some videos or redeploy with a larger volume.`,
      );
    }
  } catch (err) {
    if (err instanceof DiskFullError) throw err;
  }
}

export function enqueue(input: {
  type: JobType;
  title: string;
  params: Record<string, unknown>;
  projectId?: ID;
  shotId?: ID;
}): Job {
  assertDiskSpace();
  const job = jobsRepo.create({
    type: input.type,
    title: input.title,
    params: input.params,
    projectId: input.projectId,
    shotId: input.shotId,
    outputAssetIds: [],
  });
  emit({ type: 'job', job });
  recomputeQueuePositions();
  void tick();
  return jobsRepo.get(job.id)!;
}

export function cancel(id: ID): Job | undefined {
  const job = jobsRepo.get(id);
  if (!job) return undefined;
  if (job.status === 'queued') {
    const updated = jobsRepo.update(id, { status: 'canceled', finishedAt: now(), queuePosition: undefined })!;
    emit({ type: 'job', job: updated });
    recomputeQueuePositions();
    return updated;
  }
  if (job.status === 'running') {
    canceledJobs.add(id);
    void comfyClient?.interrupt();
    return job;
  }
  return job;
}

export function retry(id: ID): Job | undefined {
  const job = jobsRepo.get(id);
  if (!job) return undefined;
  return enqueue({ type: job.type, title: job.title, params: job.params, projectId: job.projectId, shotId: job.shotId });
}

// ── Model-affinity scheduling ────────────────────────────────────────────────
// One 24 GB GPU can hold only one engine at a time, and switching costs seconds (RAM) to a
// minute+ (network disk). When several jobs wait, prefer the next one that uses the engine that
// is already loaded, but never let the oldest job be skipped more than MAX_SKIPS times.
export type ModelFamily = 'zimage' | 'qwen' | 'wan' | 'animate';
const MAX_SKIPS = 4;
const skips = new Map<ID, number>();
let loadedFamily: ModelFamily | null = null;

/** [family loaded first, family loaded last] for a job, or null when it doesn't touch the GPU models. */
export function jobFamilies(job: Pick<Job, 'type' | 'params'>): [ModelFamily, ModelFamily] | null {
  const engine = (job.params as { engine?: string }).engine;
  switch (job.type) {
    case 'generate':
      if (engine === 'zimage') return ['zimage', 'zimage'];
      if (engine === 'qwen_edit' || engine === 'qwen_angle') return ['qwen', 'qwen'];
      if (engine === 'wan_i2v') return ['wan', 'wan'];
      if (engine === 'wan_t2v') return ['zimage', 'wan']; // keyframe first, then animate
      if (engine === 'wan_animate') return ['animate', 'animate'];
      return null;
    case 'location_establishing':
    case 'character_refs':
      return ['zimage', 'zimage'];
    case 'location_angle':
    case 'shot_keyframe': // compose mode (the common case) is Qwen; generate mode is Z-Image
      return ['qwen', 'qwen'];
    case 'shot_video':
      return ['wan', 'wan'];
    default:
      return null;
  }
}

/** Pick the next job: FIFO, except prefer one matching the loaded engine (bounded skipping). */
export function pickNext(queued: Job[], loaded: ModelFamily | null, skipCounts: Map<ID, number>): Job | undefined {
  const head = queued[0];
  if (!head || !loaded) return head;
  if ((skipCounts.get(head.id) ?? 0) >= MAX_SKIPS) return head;
  if (jobFamilies(head)?.[0] === loaded) return head;
  for (let i = 1; i < queued.length; i++) {
    const j = queued[i];
    if (jobFamilies(j)?.[0] !== loaded) continue;
    // Never jump ahead of earlier work for the same shot (a shot's video needs its keyframe).
    if (j.shotId && queued.slice(0, i).some((e) => e.shotId === j.shotId)) continue;
    return j;
  }
  return head;
}

async function tick() {
  if (processing) return;
  const queued = jobsRepo.list({ active: true }).filter((j) => j.status === 'queued');
  const next = pickNext(queued, loadedFamily, skips);
  if (!next) return;
  // Every job ahead of the chosen one was skipped once more.
  for (const j of queued) {
    if (j.id === next.id) break;
    skips.set(j.id, (skips.get(j.id) ?? 0) + 1);
  }
  skips.delete(next.id);
  processing = true;
  currentJobId = next.id;
  const started = jobsRepo.update(next.id, { status: 'running', startedAt: now(), queuePosition: undefined })!;
  emit({ type: 'job', job: started });
  recomputeQueuePositions();

  const runner = runners.get(next.type);
  const outputAssetIds: ID[] = [];
  const ctx: RunnerContext = {
    comfy: comfyClient!,
    isCanceled: () => canceledJobs.has(next.id),
    setProgress: (frac, stage) => {
      const t = Date.now();
      const last = lastProgressEmit.get(next.id) ?? 0;
      const clamped = Math.max(0, Math.min(1, frac));
      const updated = jobsRepo.update(next.id, { progress: clamped, stage })!;
      if (t - last >= PROGRESS_THROTTLE_MS) {
        lastProgressEmit.set(next.id, t);
        emit({ type: 'job', job: updated });
      }
    },
    addOutput: (assetId) => {
      outputAssetIds.push(assetId);
      jobsRepo.update(next.id, { outputAssetIds: [...outputAssetIds] });
    },
  };

  try {
    if (!runner) throw new Error(`No runner registered for job type "${next.type}"`);
    await runner(next, ctx);
    const canceled = canceledJobs.has(next.id);
    const finalStatus = canceled ? 'canceled' : 'done';
    const finished = jobsRepo.update(next.id, {
      status: finalStatus,
      progress: canceled ? jobsRepo.get(next.id)!.progress : 1,
      outputAssetIds: [...outputAssetIds],
      finishedAt: now(),
    })!;
    emit({ type: 'job', job: finished });
  } catch (err) {
    const canceled = canceledJobs.has(next.id) || (err instanceof Error && err.message === 'canceled');
    // This write can itself fail (e.g. SQLITE_FULL on a full volume); never let it escape the loop.
    try {
      const finished = jobsRepo.update(next.id, {
        status: canceled ? 'canceled' : 'error',
        error: canceled ? undefined : err instanceof Error ? err.message : String(err),
        outputAssetIds: [...outputAssetIds],
        finishedAt: now(),
      })!;
      emit({ type: 'job', job: finished });
    } catch (dbErr) {
      console.error('[queue] failed to record job failure', next.id, dbErr);
    }
  } finally {
    const fam = jobFamilies(next);
    if (fam) loadedFamily = fam[1];
    canceledJobs.delete(next.id);
    lastProgressEmit.delete(next.id);
    processing = false;
    currentJobId = null;
    try {
      recomputeQueuePositions();
    } catch (dbErr) {
      console.error('[queue] recomputeQueuePositions failed', dbErr);
    }
    void tick();
  }
}

export function currentJob(): ID | null {
  return currentJobId;
}

/** Force the loop to check for pending work (e.g. after startup recovery). */
export function kick() {
  void tick();
}

// Setup-milestone timestamps: how long a new user (or a timed test) took to get from "pod started" to a
// finished first video. Persisted to DATA_DIR/milestones.json so it survives restarts. Local only — nothing
// here is sent anywhere; it's read back by GET /api/diagnostics for the Settings "Setup and logs" panel and
// bundled into the downloadable log archive (routes/diagnostics.ts).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config';
import { assets as assetsRepo, scenes as scenesRepo, shots as shotsRepo } from './db';
import type { Diagnostics, Job, Milestones } from '../shared/types';

export type { Milestones };

const KEYS: (keyof Milestones)[] = [
  'podStartedAt',
  'studioReadyAt',
  'videoModelsReadyAt',
  'hfTokenSavedAt',
  'firstImageAt',
  'firstVideoQueuedAt',
  'firstVideoAt',
  'firstPrevisShotAt',
  'firstExportAt',
];

const file = () => path.join(DATA_DIR, 'milestones.json');
/** Written by docker/start.sh on the container's first-ever boot (see "First-boot / boot timestamps"). */
const podStartedFile = () => path.join(DATA_DIR, 'pod-started-at');
/** This server process's own start time, used in local dev where docker/start.sh never ran. */
const processStartedAt = new Date().toISOString();

function read(): Milestones {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, unknown>;
    const out: Milestones = {};
    for (const k of KEYS) if (typeof raw[k] === 'string') out[k] = raw[k] as string;
    return out;
  } catch {
    return {};
  }
}

function write(m: Milestones) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(m, null, 2));
  } catch (err) {
    console.error('[milestones] failed to persist', err);
  }
}

/** Sets `key` the first time only (never overwrites); `at` defaults to now. Safe to call repeatedly. */
export function markMilestone(key: keyof Milestones, at: string = new Date().toISOString()): Milestones {
  const cur = read();
  if (cur[key]) return cur;
  cur[key] = at;
  write(cur);
  return cur;
}

export function getMilestones(): Milestones {
  return read();
}

/** { milestones, durations }: durations are whole seconds from podStartedAt to each milestone (null when
 *  either is missing). Used by GET /api/diagnostics and the Settings "Setup and logs" panel. */
export function diagnosticsSummary(): Diagnostics {
  const milestones = read();
  const startMs = milestones.podStartedAt ? Date.parse(milestones.podStartedAt) : undefined;
  const durations = {} as Record<keyof Milestones, number | null>;
  for (const k of KEYS) {
    const v = milestones[k];
    durations[k] = startMs !== undefined && v ? Math.round((Date.parse(v) - startMs) / 1000) : null;
  }
  return { milestones, durations };
}

/** Records podStartedAt once per pod lifetime: from docker/start.sh's pod-started-at file (the container's
 *  first-ever boot) when present, else this process's own start time (local dev). Call once at startup. */
export function initPodStartedAt() {
  let boot: string | undefined;
  try {
    boot = fs.readFileSync(podStartedFile(), 'utf8').trim() || undefined;
  } catch {
    // no file: local dev, or an image predating this feature
  }
  markMilestone('podStartedAt', boot || processStartedAt);
}

/** Video-producing engines (a subset of shared/types EngineId): a 'generate' job using one of these renders
 *  a clip rather than a still. */
const VIDEO_ENGINES = new Set(['wan_i2v', 'wan_t2v', 'wan_animate', 'wan_control', 'wan_vace', 'h3_ref', 'ltx_ic']);

function jobRendersVideo(job: Pick<Job, 'type' | 'params'>): boolean {
  if (job.type === 'shot_video') return true;
  if (job.type === 'generate') return VIDEO_ENGINES.has(String((job.params as { engine?: string }).engine ?? ''));
  return false;
}

/** Call when a job is enqueued: marks "first video queued" as soon as one is asked for, not only once it
 *  finishes (the metric is about how long it took the user to ask). */
export function markJobQueued(job: Pick<Job, 'type' | 'params'>) {
  if (jobRendersVideo(job)) markMilestone('firstVideoQueuedAt');
}

/** Call once a job finishes successfully: marks whatever its outputs imply (first image / first video), plus
 *  the previs-shot and export milestones. */
export function markJobDone(job: Pick<Job, 'type' | 'shotId' | 'outputAssetIds'>) {
  for (const id of job.outputAssetIds) {
    const asset = assetsRepo.get(id);
    if (!asset) continue;
    if (asset.kind === 'image') markMilestone('firstImageAt');
    if (asset.kind === 'video') markMilestone('firstVideoAt');
  }
  if (job.type === 'shot_video' && job.shotId) {
    const shot = shotsRepo.get(job.shotId);
    const scene = shot && scenesRepo.get(shot.sceneId);
    if (scene?.previsAssetId) markMilestone('firstPrevisShotAt');
  }
  if (job.type === 'project_export') markMilestone('firstExportAt');
}

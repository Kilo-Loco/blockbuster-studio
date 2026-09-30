import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate this test's milestones.json from other test files / the real dev .data dir.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-milestones-test-'));
process.env.DATA_DIR = tmpDir;

const { markMilestone, getMilestones, diagnosticsSummary, markJobQueued, markJobDone } = await import('./milestones');
const { projects: projectsRepo, scenes: scenesRepo, shots: shotsRepo, assets: assetsRepo } = await import('./db');

function clearMilestones() {
  fs.rmSync(path.join(tmpDir, 'milestones.json'), { force: true });
}

beforeEach(() => {
  clearMilestones();
});

afterEach(() => {
  clearMilestones();
});

describe('markMilestone', () => {
  it('sets a key only the first time', () => {
    markMilestone('studioReadyAt', '2026-01-01T00:00:00.000Z');
    markMilestone('studioReadyAt', '2026-01-01T01:00:00.000Z');
    expect(getMilestones().studioReadyAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('persists across reads', () => {
    markMilestone('firstImageAt', '2026-01-01T00:05:00.000Z');
    expect(getMilestones().firstImageAt).toBe('2026-01-01T00:05:00.000Z');
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, 'milestones.json'), 'utf8')).firstImageAt).toBe('2026-01-01T00:05:00.000Z');
  });

  it('recovers from a missing or corrupt file instead of throwing', () => {
    fs.writeFileSync(path.join(tmpDir, 'milestones.json'), 'not json');
    expect(getMilestones()).toEqual({});
    markMilestone('studioReadyAt');
    expect(getMilestones().studioReadyAt).toBeTruthy();
  });
});

describe('diagnosticsSummary', () => {
  it('computes durations in whole seconds from podStartedAt, null when missing', () => {
    markMilestone('podStartedAt', '2026-01-01T00:00:00.000Z');
    markMilestone('studioReadyAt', '2026-01-01T00:01:12.000Z');
    const { durations } = diagnosticsSummary();
    expect(durations.studioReadyAt).toBe(72);
    expect(durations.firstVideoAt).toBeNull();
  });

  it('every duration is null when the pod start time is unknown', () => {
    markMilestone('studioReadyAt', '2026-01-01T00:01:12.000Z');
    const { durations } = diagnosticsSummary();
    expect(durations.studioReadyAt).toBeNull();
  });
});

describe('markJobQueued / markJobDone', () => {
  it('marks firstVideoQueuedAt for a shot_video job but not for an image job', () => {
    markJobQueued({ type: 'shot_keyframe', params: {} });
    expect(getMilestones().firstVideoQueuedAt).toBeUndefined();
    markJobQueued({ type: 'shot_video', params: {} });
    expect(getMilestones().firstVideoQueuedAt).toBeTruthy();
  });

  it('marks firstVideoQueuedAt for a generate job on a video engine', () => {
    markJobQueued({ type: 'generate', params: { engine: 'wan_i2v' } });
    expect(getMilestones().firstVideoQueuedAt).toBeTruthy();
  });

  it('marks firstImageAt / firstVideoAt from a finished job\'s output asset kinds', () => {
    const img = assetsRepo.create({ kind: 'image', origin: 'generated', file: 'a.png', width: 1, height: 1 });
    const vid = assetsRepo.create({ kind: 'video', origin: 'generated', file: 'a.mp4', width: 1, height: 1 });
    markJobDone({ type: 'generate', shotId: undefined, outputAssetIds: [img.id] });
    expect(getMilestones().firstImageAt).toBeTruthy();
    expect(getMilestones().firstVideoAt).toBeUndefined();
    markJobDone({ type: 'shot_video', shotId: undefined, outputAssetIds: [vid.id] });
    expect(getMilestones().firstVideoAt).toBeTruthy();
  });

  it('marks firstPrevisShotAt only when the shot\'s scene has a previsAssetId', () => {
    const project = projectsRepo.create({ name: 'p' });
    const plainScene = scenesRepo.create({ projectId: project.id, title: 'plain' });
    const plainShot = shotsRepo.create({ sceneId: plainScene.id, camera: { pos: { x: 0, y: 0 }, heightM: 1.6 } });
    markJobDone({ type: 'shot_video', shotId: plainShot.id, outputAssetIds: [] });
    expect(getMilestones().firstPrevisShotAt).toBeUndefined();

    const previsAsset = assetsRepo.create({ kind: 'video', origin: 'upload', file: 'previs.mp4', width: 1, height: 1 });
    const previsScene = scenesRepo.create({ projectId: project.id, title: 'previs', previsAssetId: previsAsset.id });
    const previsShot = shotsRepo.create({ sceneId: previsScene.id, camera: { pos: { x: 0, y: 0 }, heightM: 1.6 } });
    markJobDone({ type: 'shot_video', shotId: previsShot.id, outputAssetIds: [] });
    expect(getMilestones().firstPrevisShotAt).toBeTruthy();
  });

  it('marks firstExportAt for a finished project_export job', () => {
    markJobDone({ type: 'project_export', shotId: undefined, outputAssetIds: [] });
    expect(getMilestones().firstExportAt).toBeTruthy();
  });
});

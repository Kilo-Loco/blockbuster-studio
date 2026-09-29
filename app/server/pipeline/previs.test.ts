import { describe, expect, it } from 'vitest';
import { previsCutsFromSequences, previsShotDurations, previsShotWindows, shouldRenderScenePrevisH3, shouldRenderScenePrevisLtx } from './previs';
import type { Shot } from '../../shared/types';

function shot(durationSec: number, over: Partial<Shot> = {}): Shot {
  return {
    id: `s${durationSec}-${Math.random()}`,
    sceneId: 'scene1',
    order: 0,
    action: '',
    shotSize: 'MS',
    cameraMove: 'static',
    camera: { pos: { x: 0, y: 0 }, heightM: 1.6 },
    characterIds: [],
    durationSec,
    keyframeMode: 'auto',
    keyframeCandidates: [],
    videoCandidates: [],
    status: 'draft',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('previsShotWindows', () => {
  it('lays shots back to back by durationSec when there are no cuts', () => {
    const shots = [shot(3), shot(5), shot(2)];
    expect(previsShotWindows(shots, undefined)).toEqual([
      { start: 0, duration: 3 },
      { start: 3, duration: 5 },
      { start: 8, duration: 2 },
    ]);
  });

  it('falls back to cumulative durations when the cut count does not match', () => {
    const shots = [shot(3), shot(5), shot(2)];
    expect(previsShotWindows(shots, [3])).toEqual(previsShotWindows(shots, undefined));
  });

  it('uses previsCuts as interior boundaries when the count matches shots.length - 1', () => {
    const shots = [shot(5), shot(5), shot(5)];
    const windows = previsShotWindows(shots, [3, 7.5], 12);
    expect(windows).toEqual([
      { start: 0, duration: 3 },
      { start: 3, duration: 4.5 },
      { start: 7.5, duration: 4.5 },
    ]);
  });

  it("without a known previs duration, the last shot's window falls back to its own durationSec", () => {
    const shots = [shot(5), shot(6)];
    const windows = previsShotWindows(shots, [3]);
    expect(windows[0]).toEqual({ start: 0, duration: 3 });
    expect(windows[1]).toEqual({ start: 3, duration: 6 });
  });

  it('never returns a non-positive duration', () => {
    const shots = [shot(5), shot(5)];
    const windows = previsShotWindows(shots, [3], 3); // second cut collapses the last window
    expect(windows[1]!.duration).toBeGreaterThan(0);
  });

  it('returns an empty array for no shots', () => {
    expect(previsShotWindows([], undefined)).toEqual([]);
  });
});

describe('previsShotDurations', () => {
  it('keeps the exact cut times (to the hundredth), so export trims on the cut', () => {
    const shots = [shot(5), shot(5), shot(5)];
    expect(previsShotDurations(shots, [3, 7.5], 12)).toEqual([3, 4.5, 4.5]);
    // Coast Road: cuts at 3, 5 and 7.5 s in a 10 s previs
    expect(previsShotDurations([shot(3), shot(2), shot(3), shot(3)], [3, 5, 7.5], 10)).toEqual([3, 2, 2.5, 2.5]);
  });
});

describe('previsCutsFromSequences (Blender previs skill sequences.json)', () => {
  it('extracts interior cut points from shots[].start_s', () => {
    const sequences = { shots: [{ start_s: 0, end_s: 3 }, { start_s: 3, end_s: 7.5 }, { start_s: 7.5, end_s: 12 }] };
    expect(previsCutsFromSequences(sequences)).toEqual([3, 7.5]);
  });

  it('returns undefined for a malformed or too-short shape', () => {
    expect(previsCutsFromSequences({ shots: [{ start_s: 0 }] })).toBeUndefined();
    expect(previsCutsFromSequences({})).toBeUndefined();
    expect(previsCutsFromSequences(null)).toBeUndefined();
    expect(previsCutsFromSequences({ shots: [{ start_s: 0 }, {}] })).toBeUndefined();
  });
});

describe('shouldRenderScenePrevisLtx', () => {
  const scene = { previsAssetId: 'v1', referenceSheetAssetId: 'sheet1' };
  const bareShot = { controlVideoAssetId: undefined, referenceAssetIds: undefined, referenceVideoAssetId: undefined, videoModel: undefined };

  it('fires when the scene has previs + sheet, no manual overrides, and the engine is installed', () => {
    expect(shouldRenderScenePrevisLtx({ scene, shot: bareShot, ltxIcAvailable: true })).toBe(true);
    expect(shouldRenderScenePrevisLtx({ scene, shot: { ...bareShot, videoModel: 'ltx_2_5' }, ltxIcAvailable: true })).toBe(true);
  });

  it('does not fire without a previs, a sheet, or the engine', () => {
    expect(shouldRenderScenePrevisLtx({ scene: { previsAssetId: undefined, referenceSheetAssetId: 'sheet1' }, shot: bareShot, ltxIcAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisLtx({ scene: { previsAssetId: 'v1', referenceSheetAssetId: undefined }, shot: bareShot, ltxIcAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisLtx({ scene, shot: bareShot, ltxIcAvailable: false })).toBe(false);
  });

  it('does not fire when the shot sets a manual control/reference override, or asks for another model', () => {
    expect(shouldRenderScenePrevisLtx({ scene, shot: { ...bareShot, controlVideoAssetId: 'ctl1' }, ltxIcAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisLtx({ scene, shot: { ...bareShot, referenceAssetIds: ['r1'] }, ltxIcAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisLtx({ scene, shot: { ...bareShot, referenceVideoAssetId: 'rv1' }, ltxIcAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisLtx({ scene, shot: { ...bareShot, videoModel: 'wan' }, ltxIcAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisLtx({ scene, shot: { ...bareShot, videoModel: 'minimax_h3' }, ltxIcAvailable: true })).toBe(false);
  });
});

describe('shouldRenderScenePrevisH3', () => {
  const scene = { previsAssetId: 'v1' };
  const bareShot = { controlVideoAssetId: undefined, referenceAssetIds: undefined, referenceVideoAssetId: undefined, videoModel: 'minimax_h3' as const };

  it('fires only when the shot explicitly asks for minimax_h3, the scene has a previs, and h3_ref is installed', () => {
    expect(shouldRenderScenePrevisH3({ scene, shot: bareShot, h3RefAvailable: true })).toBe(true);
    expect(shouldRenderScenePrevisH3({ scene, shot: { ...bareShot, videoModel: undefined }, h3RefAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisH3({ scene: { previsAssetId: undefined }, shot: bareShot, h3RefAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisH3({ scene, shot: bareShot, h3RefAvailable: false })).toBe(false);
    expect(shouldRenderScenePrevisH3({ scene, shot: { ...bareShot, controlVideoAssetId: 'ctl1' }, h3RefAvailable: true })).toBe(false);
  });

  it('is mutually exclusive with shouldRenderScenePrevisLtx for the same bare shot', () => {
    const fullScene = { previsAssetId: 'v1', referenceSheetAssetId: 'sheet1' };
    expect(shouldRenderScenePrevisLtx({ scene: fullScene, shot: bareShot, ltxIcAvailable: true })).toBe(false);
    expect(shouldRenderScenePrevisH3({ scene: fullScene, shot: { ...bareShot, videoModel: undefined }, h3RefAvailable: true })).toBe(false);
  });
});

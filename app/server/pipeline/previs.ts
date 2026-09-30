// Turns a scene's previsCuts (or plain cumulative shot durations) into each shot's [start, duration] window
// inside the scene's previs video. Pure functions, used by the shot_video.ts scene-previs branch and by
// PATCH /api/scenes/:id (which recomputes shot durationSec when previsCuts changes).
import type { Scene, Shot, VideoModelId } from '../../shared/types';
import { previsCutsFromSequences as sharedPrevisCutsFromSequences } from '../../shared/previs';

export interface ScenePrevisShotInput {
  scene: Pick<Scene, 'previsAssetId' | 'referenceSheetAssetId'>;
  shot: Pick<Shot, 'controlVideoAssetId' | 'referenceAssetIds' | 'referenceVideoAssetId' | 'videoModel'>;
  ltxIcAvailable: boolean;
}

/** True when shot_video.ts's top-priority scene-previs (LTX-2.5 + Ingredients sheet) branch fires for this
 *  shot: the scene has both a previs and a reference sheet, the shot sets none of the manual per-shot
 *  control/reference overrides (those branches, below this one, still win when set by hand), the shot's
 *  videoModel is unset or explicitly 'ltx_2_5', and the ltx_ic engine (union control or Ingredients) is
 *  installed. */
export function shouldRenderScenePrevisLtx(input: ScenePrevisShotInput): boolean {
  const { scene, shot } = input;
  return Boolean(
    scene.previsAssetId &&
      scene.referenceSheetAssetId &&
      !shot.controlVideoAssetId &&
      !shot.referenceAssetIds?.length &&
      !shot.referenceVideoAssetId &&
      (!shot.videoModel || shot.videoModel === 'ltx_2_5') &&
      input.ltxIcAvailable,
  );
}

export interface ScenePrevisH3Input {
  scene: Pick<Scene, 'previsAssetId'>;
  shot: Pick<Shot, 'controlVideoAssetId' | 'referenceAssetIds' | 'referenceVideoAssetId' | 'videoModel'>;
  h3RefAvailable: boolean;
}

/** True when shot_video.ts's scene-previs MiniMax H3 Ref2VA alternative fires: the scene has a previs, the
 *  shot sets none of the manual per-shot control/reference overrides, the shot explicitly asked for
 *  'minimax_h3', and h3_ref is installed. This is the alternative path to shouldRenderScenePrevisLtx above
 *  (mutually exclusive: that one only ever fires for 'ltx_2_5' or unset). */
export function shouldRenderScenePrevisH3(input: ScenePrevisH3Input): boolean {
  const { scene, shot } = input;
  return Boolean(
    scene.previsAssetId &&
      !shot.controlVideoAssetId &&
      !shot.referenceAssetIds?.length &&
      !shot.referenceVideoAssetId &&
      shot.videoModel === ('minimax_h3' satisfies VideoModelId) &&
      input.h3RefAvailable,
  );
}

export interface PrevisWindow {
  start: number;
  duration: number;
}

/** One [start, duration] window per shot. When `previsCuts` has exactly `shots.length - 1` entries, they mark
 *  the cut points between shots (shot 0 starts at 0, shot 1 at previsCuts[0], …); the last shot's end is the
 *  previs's own duration when known, else it keeps its current durationSec. Otherwise (no cuts, or a mismatched
 *  count) shots are laid back to back by their own durationSec, cumulative from 0. */
export function previsShotWindows(shots: Shot[], previsCuts: number[] | undefined, previsDurationSec?: number): PrevisWindow[] {
  if (!shots.length) return [];
  if (previsCuts && previsCuts.length === shots.length - 1) {
    const lastFallback = previsCuts[previsCuts.length - 1]! + Math.max(0.1, shots[shots.length - 1]!.durationSec);
    const bounds = [0, ...previsCuts, previsDurationSec ?? lastFallback];
    return shots.map((_s, i) => ({ start: bounds[i]!, duration: Math.max(0.1, bounds[i + 1]! - bounds[i]!) }));
  }
  let acc = 0;
  return shots.map((s) => {
    const start = acc;
    acc += s.durationSec;
    return { start, duration: s.durationSec };
  });
}

/** Rounded whole-second durations for each shot from previsShotWindows, for writing back to Shot.durationSec
 *  when a scene's previsCuts is set (see routes/projects.ts PATCH /api/scenes/:id). */
export function previsShotDurations(shots: Shot[], previsCuts: number[], previsDurationSec?: number): number[] {
  // Keep the previs's exact cut times (to the hundredth): whole-second rounding made 2.5 s shots 3 s, so the
  // export's trim to durationSec kept frames from past the cut.
  return previsShotWindows(shots, previsCuts, previsDurationSec).map((w) => Math.max(0.5, Math.round(w.duration * 100) / 100));
}

/** Thin wrapper over the shared parser (app/shared/previs.ts), kept for callers that only want the first
 *  sequence's interior cut points: our Blender previs skill's sequences.json ({ sequences: [{ shots: [{
 *  start_s, end_s }, …] }] }) or the older flat { shots: [...] }, converted into the interior cut points
 *  previsCuts wants (the first shot's start_s and the last shot's end_s are dropped: they are implicitly 0 and
 *  the previs's own length). */
export const previsCutsFromSequences = sharedPrevisCutsFromSequences;

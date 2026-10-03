import type { AspectRatio, CameraMoveId, Distance, ShotSize, TimeOfDay, VideoModelId, VideoQuality } from './types';

/** Every aspect a film or render can use. AspectRatio is derived from this list. */
export const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '1.91:1', '4:5', '2:3'] as const;
/** Perform (Wan Animate) is offered at these only. */
export const PERFORM_ASPECTS: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];

export const isAspect = (v: unknown): v is AspectRatio => typeof v === 'string' && (ASPECTS as readonly string[]).includes(v);

/** A request's aspect error, or undefined when it's one of ASPECTS. */
export const aspectError = (v: unknown): string | undefined =>
  isAspect(v) ? undefined : `aspect must be one of ${ASPECTS.join(', ')} (got ${JSON.stringify(v)})`;

/** '1.91:1' → [1.91, 1]. */
export function aspectParts(aspect: AspectRatio): [number, number] {
  const [w, h] = aspect.split(':').map(Number);
  return [w, h];
}

/** Z-Image / Qwen-Edit output sizes (~1 MP, multiples of 16). */
export const IMAGE_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1152, height: 864 },
  '3:4': { width: 864, height: 1152 },
  '21:9': { width: 1536, height: 640 },
  '1.91:1': { width: 1408, height: 736 },
  '4:5': { width: 896, height: 1120 },
  '2:3': { width: 832, height: 1248 },
};

/** Wan 2.2 sizes. 'fast' ≈ 480p (≈1–2 min on a 4090 with Lightning), 'hd' = 720p (several minutes). */
export const VIDEO_SIZES: Record<VideoQuality, Record<AspectRatio, { width: number; height: number }>> = {
  fast: {
    '16:9': { width: 832, height: 480 },
    '9:16': { width: 480, height: 832 },
    '1:1': { width: 640, height: 640 },
    '4:3': { width: 736, height: 544 },
    '3:4': { width: 544, height: 736 },
    '21:9': { width: 960, height: 416 },
    '1.91:1': { width: 832, height: 448 },
    '4:5': { width: 576, height: 720 },
    '2:3': { width: 512, height: 768 },
  },
  hd: {
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '1:1': { width: 960, height: 960 },
    '4:3': { width: 1088, height: 816 },
    '3:4': { width: 816, height: 1088 },
    '21:9': { width: 1344, height: 576 },
    '1.91:1': { width: 1344, height: 704 },
    '4:5': { width: 896, height: 1152 },
    '2:3': { width: 768, height: 1152 },
  },
};

/** Short names for the video models, as the UI and agents show them. */
export const VIDEO_MODEL_LABEL: Record<VideoModelId, string> = { wan: 'Wan 2.2', minimax_h3: 'MiniMax H3', ltx_2_5: 'LTX-2.5' };

export const WAN_FPS = 16;
/** Clip lengths offered per video model. Wan 2.2 tops out at 121 frames (~7.5 s at 16 fps);
 *  MiniMax H3 is trained for 4–15 s; LTX-2.5 renders 24 fps on an 8k+1 frame grid. */
export const VIDEO_DURATIONS: Record<VideoModelId, readonly number[]> = {
  wan: [2, 3, 4, 5, 6, 7],
  minimax_h3: [4, 5, 6, 8, 10, 12, 15],
  ltx_2_5: [4, 5, 6, 8, 10],
};

/** Longest HD clip on a 24 GB card, per model; longer HD clips need ≥ 30 GB (docs/research/2026-09-model-review.md).
 *  H3: 1280×736 fits 10 s, a 15 s clip peaked at 29 GB. LTX-2.5 renders its full 4–10 s range in HD on a 4090. */
export const HD_MAX_SEC_24GB: Partial<Record<VideoModelId, number>> = { minimax_h3: 10 };
const LONG_HD_MIN_VRAM_MB = 30_000;

/** MiniMax H3 Ref2VA at HD with a reference video attached: 5 s fits 32 GB; 9–11 s ran out of memory in the
 *  DiT forward pass on 32 GB (RTX PRO 4500) and 11 s on 48 GB (PRO 6000 MIG 2g.48gb), 2026-09-28. Only a
 *  96 GB card is assumed to fit (not yet measured). */
export const REF_VIDEO_HD_MAX_SEC_32GB = 5;
export const REF_VIDEO_LONG_HD_MIN_VRAM_MB = 90_000;

/** Why an HD reference render will not fit this GPU, or undefined when it should. */
export function refVideoHdFit(sec: number, vramTotalMB: number | undefined): string | undefined {
  if (!vramTotalMB || vramTotalMB >= REF_VIDEO_LONG_HD_MIN_VRAM_MB || sec <= REF_VIDEO_HD_MAX_SEC_32GB) return undefined;
  return `An HD clip longer than ${REF_VIDEO_HD_MAX_SEC_32GB} s with a reference video needs about ${Math.round(REF_VIDEO_LONG_HD_MIN_VRAM_MB / 1000)} GB of GPU memory; this GPU has ${Math.round(vramTotalMB / 1024)} GB. Use quality "fast", ${REF_VIDEO_HD_MAX_SEC_32GB} s or less, or a larger GPU.`;
}

export interface DurationContext {
  quality?: VideoQuality;
  /** GPU memory; unknown counts as 24 GB. */
  vramTotalMB?: number;
}

export function durationsFor(model: VideoModelId | null | undefined, ctx: DurationContext = {}): readonly number[] {
  const all = VIDEO_DURATIONS[model ?? 'wan'];
  const hdMax = model ? HD_MAX_SEC_24GB[model] : undefined;
  if (hdMax && ctx.quality === 'hd' && (ctx.vramTotalMB ?? 0) < LONG_HD_MIN_VRAM_MB) return all.filter((d) => d <= hdMax);
  return all;
}

/** Whole seconds inside the model's range (stored durations may come from the other model). */
export function clampDuration(sec: number, model: VideoModelId | null | undefined, ctx: DurationContext = {}): number {
  const options = durationsFor(model, ctx);
  if (!Number.isFinite(sec)) return 5;
  return Math.min(options[options.length - 1], Math.max(options[0], Math.round(sec)));
}

/** The offered option closest to `sec`, for showing a stored duration in a picker. */
export function nearestDuration(sec: number, model: VideoModelId | null | undefined, ctx: DurationContext = {}): number {
  return durationsFor(model, ctx).reduce((best, d) => (Math.abs(d - sec) < Math.abs(best - sec) ? d : best));
}

/** Minutes per second of video for the sound-capable opt-in models, measured on a 4090 / 5090
 *  (docs/research/2026-09-model-review.md). LTX-2.5 on a 4090, warm: 5 s in 41 s / 10 s in 73 s at 832×512,
 *  5 s in 78–80 s / 10 s in 151 s at 1280×704. */
export const VIDEO_MIN_PER_SEC: Partial<Record<VideoModelId, Record<VideoQuality, readonly [number, number]>>> = {
  minimax_h3: { fast: [0.17, 0.27], hd: [0.45, 0.65] },
  ltx_2_5: { fast: [0.12, 0.2], hd: [0.25, 0.33] },
};

/** Rough [low, high] minutes to render one clip. */
export function clipMinutes(model: VideoModelId | null | undefined, quality: VideoQuality, sec: number): [number, number] {
  const rate = model ? VIDEO_MIN_PER_SEC[model]?.[quality] : undefined;
  if (rate) return [rate[0] * sec, rate[1] * sec];
  return quality === 'hd' ? [3, 5] : [1, 2];
}

/** Rough minutes for a storyboard frame (Qwen compose or Z-Image) and a character/location reference image. */
export const KEYFRAME_MINUTES: [number, number] = [0.3, 0.6];
export const REFERENCE_MINUTES: [number, number] = [0.2, 0.4];

/** Wan wants length = 4n + 1 frames. */
export function framesForDuration(sec: number): number {
  const raw = Math.round(sec * WAN_FPS) + 1;
  const n = Math.max(1, Math.round((raw - 1) / 4));
  return Math.min(4 * n + 1, 121);
}

export interface CameraMovePreset {
  id: CameraMoveId;
  label: string;
  /** Phrase appended to the Wan motion prompt. */
  phrase: string;
  /** Short hint shown in the picker. */
  hint: string;
}

export const CAMERA_MOVES: CameraMovePreset[] = [
  { id: 'static', label: 'Static', hint: 'Locked-off tripod', phrase: 'The camera is completely still, locked-off tripod shot.' },
  { id: 'push_in', label: 'Push In', hint: 'Slow dolly toward subject', phrase: 'The camera slowly dollies in toward the subject.' },
  { id: 'pull_out', label: 'Pull Out', hint: 'Dolly back to reveal', phrase: 'The camera slowly dollies backward, revealing more of the surroundings.' },
  { id: 'pan_left', label: 'Pan Left', hint: 'Rotate left', phrase: 'The camera pans smoothly to the left.' },
  { id: 'pan_right', label: 'Pan Right', hint: 'Rotate right', phrase: 'The camera pans smoothly to the right.' },
  { id: 'tilt_up', label: 'Tilt Up', hint: 'Rotate upward', phrase: 'The camera tilts slowly upward.' },
  { id: 'tilt_down', label: 'Tilt Down', hint: 'Rotate downward', phrase: 'The camera tilts slowly downward.' },
  { id: 'orbit_left', label: 'Orbit Left', hint: 'Arc around subject', phrase: 'The camera arcs around the subject to the left in a smooth orbit.' },
  { id: 'orbit_right', label: 'Orbit Right', hint: 'Arc around subject', phrase: 'The camera arcs around the subject to the right in a smooth orbit.' },
  { id: 'crane_up', label: 'Crane Up', hint: 'Rise above the scene', phrase: 'The camera cranes upward, rising above the scene.' },
  { id: 'crane_down', label: 'Crane Down', hint: 'Descend into the scene', phrase: 'The camera cranes down, descending toward the subject.' },
  { id: 'tracking', label: 'Tracking', hint: 'Follow the subject', phrase: 'The camera tracks alongside the subject, following the movement.' },
  { id: 'handheld', label: 'Handheld', hint: 'Documentary shake', phrase: 'Handheld camera with subtle natural shake, documentary style.' },
  { id: 'crash_zoom', label: 'Crash Zoom', hint: 'Fast snap zoom', phrase: 'A sudden fast crash zoom in on the subject.' },
  { id: 'dolly_zoom', label: 'Dolly Zoom', hint: 'Vertigo effect', phrase: 'Dolly zoom vertigo effect: the background stretches while the subject stays the same size.' },
  { id: 'fpv_drone', label: 'FPV Drone', hint: 'Fast fly-through', phrase: 'A fast FPV drone shot swooping through the scene.' },
  { id: 'whip_pan', label: 'Whip Pan', hint: 'Blurred fast pan', phrase: 'A fast whip pan with motion blur.' },
];

export const CAMERA_MOVE_BY_ID = Object.fromEntries(CAMERA_MOVES.map((m) => [m.id, m])) as Record<CameraMoveId, CameraMovePreset>;

export interface ShotSizePreset {
  id: ShotSize;
  label: string;
  phrase: string;
  distance: Distance; // multi-angle LoRA bucket
  lensMm: number;
  fovDeg: number; // horizontal FOV on full frame for lensMm
  /** Default camera distance from subject (m) when auto-placing. */
  defaultDistM: number;
}

export const SHOT_SIZES: ShotSizePreset[] = [
  { id: 'ECU', label: 'Extreme close-up', phrase: 'extreme close-up', distance: 'close-up', lensMm: 100, fovDeg: 20, defaultDistM: 0.8 },
  { id: 'CU', label: 'Close-up', phrase: 'close-up shot', distance: 'close-up', lensMm: 85, fovDeg: 24, defaultDistM: 1.3 },
  { id: 'MCU', label: 'Medium close-up', phrase: 'medium close-up shot', distance: 'close-up', lensMm: 65, fovDeg: 31, defaultDistM: 1.8 },
  { id: 'MS', label: 'Medium shot', phrase: 'medium shot', distance: 'medium shot', lensMm: 50, fovDeg: 40, defaultDistM: 2.5 },
  { id: 'MWS', label: 'Medium wide', phrase: 'medium wide shot', distance: 'medium shot', lensMm: 35, fovDeg: 54, defaultDistM: 3.5 },
  { id: 'WS', label: 'Wide shot', phrase: 'wide shot', distance: 'wide shot', lensMm: 24, fovDeg: 74, defaultDistM: 5 },
  { id: 'EWS', label: 'Extreme wide', phrase: 'extreme wide establishing shot', distance: 'wide shot', lensMm: 18, fovDeg: 90, defaultDistM: 8 },
];

export const SHOT_SIZE_BY_ID = Object.fromEntries(SHOT_SIZES.map((s) => [s.id, s])) as Record<ShotSize, ShotSizePreset>;

export const TIMES_OF_DAY: TimeOfDay[] = ['dawn', 'day', 'golden hour', 'dusk', 'night'];

export const CHARACTER_COLORS = ['#f5a524', '#3dd9c1', '#ff6b8a', '#8b7bff', '#5cc8ff', '#b6e35a', '#ff8f4a', '#e879f9'];

/** Standard Wan negative prompt (from the official Comfy-Org template, Chinese as Wan was trained). */
export const WAN_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

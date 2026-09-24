import type { AspectRatio, CameraMoveId, Distance, ShotSize, TimeOfDay, VideoQuality } from './types';

export const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

/** Z-Image / Qwen-Edit output sizes (~1 MP, multiples of 16). */
export const IMAGE_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1152, height: 864 },
  '3:4': { width: 864, height: 1152 },
  '21:9': { width: 1536, height: 640 },
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
  },
  hd: {
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '1:1': { width: 960, height: 960 },
    '4:3': { width: 1088, height: 816 },
    '3:4': { width: 816, height: 1088 },
    '21:9': { width: 1344, height: 576 },
  },
};

export const WAN_FPS = 16;
export const DURATIONS = [2, 3, 4, 5, 6, 7] as const;

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

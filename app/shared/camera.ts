// Location-map camera math.
//
// Map coordinates are meters, x → right, y → down (SVG). The location's `referenceCamera`
// is where the establishing ("front view") image was shot from. A shot camera's azimuth is the
// clockwise-on-screen angle from the reference camera to the shot camera, measured around the
// look-at target. That matches the multi-angle LoRA convention: the subject faces the
// reference camera, so a camera moved to the viewer's left sees the subject's right side
// ("right side view", 90°).

import type {
  AngleSpec,
  Azimuth,
  CharacterMark,
  Distance,
  Elevation,
  LocationMap,
  MapCamera,
  ShotSize,
  Vec2,
} from './types';
import { SHOT_SIZE_BY_ID } from './presets';

export const AZIMUTHS: Azimuth[] = [
  'front view',
  'front-right quarter view',
  'right side view',
  'back-right quarter view',
  'back view',
  'back-left quarter view',
  'left side view',
  'front-left quarter view',
];

export const ELEVATIONS: Elevation[] = ['low-angle shot', 'eye-level shot', 'elevated shot', 'high-angle shot'];
export const DISTANCES: Distance[] = ['close-up', 'medium shot', 'wide shot'];

const EYE_HEIGHT_M = 1.6;
const DEG = 180 / Math.PI;

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** Normalize degrees to [0, 360). */
export const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/** Screen-clockwise angle (y-down) from vector a to vector b, in [0, 360). */
export function angleBetween(a: Vec2, b: Vec2): number {
  return wrap360((Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x)) * DEG);
}

export function centroid(points: Vec2[]): Vec2 | undefined {
  if (!points.length) return undefined;
  const s = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
  return scale(s, 1 / points.length);
}

/** Resolve where a camera looks: explicit target → centroid of marks → map subject. */
export function resolveTarget(cam: MapCamera, marks: CharacterMark[], map: LocationMap): Vec2 {
  return cam.target ?? centroid(marks.map((m) => m.pos)) ?? map.subject;
}

export function azimuthDegrees(cam: MapCamera, target: Vec2, map: LocationMap): number {
  const refTarget = map.referenceCamera.target ?? map.subject;
  const vRef = sub(map.referenceCamera.pos, refTarget);
  const v = sub(cam.pos, target);
  if (len(v) < 1e-6 || len(vRef) < 1e-6) return 0;
  return angleBetween(vRef, v);
}

export function bucketAzimuth(deg: number): Azimuth {
  return AZIMUTHS[Math.round(wrap360(deg) / 45) % 8];
}

export function elevationDegrees(cam: MapCamera, target: Vec2): number {
  const horizontal = Math.max(0.1, len(sub(cam.pos, target)));
  return Math.atan2(cam.heightM - EYE_HEIGHT_M, horizontal) * DEG;
}

export function bucketElevation(deg: number): Elevation {
  if (deg < -12) return 'low-angle shot';
  if (deg < 15) return 'eye-level shot';
  if (deg < 45) return 'elevated shot';
  return 'high-angle shot';
}

export interface ShotAngleInput {
  camera: MapCamera;
  shotSize: ShotSize;
  marks: CharacterMark[];
  map: LocationMap;
  elevationOverride?: Elevation;
}

/** Map-placed camera → multi-angle LoRA pose. */
export function shotAngle({ camera, shotSize, marks, map, elevationOverride }: ShotAngleInput): AngleSpec & {
  azimuthDeg: number;
  elevationDeg: number;
} {
  const target = resolveTarget(camera, marks, map);
  const azimuthDeg = azimuthDegrees(camera, target, map);
  const elevationDeg = elevationDegrees(camera, target);
  return {
    azimuth: bucketAzimuth(azimuthDeg),
    elevation: elevationOverride ?? bucketElevation(elevationDeg),
    distance: SHOT_SIZE_BY_ID[shotSize].distance,
    azimuthDeg,
    elevationDeg,
  };
}

export const angleKey = (a: AngleSpec) => `${a.azimuth}|${a.elevation}|${a.distance}`;

/** Prompt for fal's Qwen-Image-Edit-2511 Multiple-Angles LoRA. */
export const anglePrompt = (a: AngleSpec) => `<sks> ${a.azimuth} ${a.elevation} ${a.distance}`;

export type ScreenX = 'left' | 'center-left' | 'center' | 'center-right' | 'right';
export type Depth = 'foreground' | 'midground' | 'background';

export interface ScreenPlacement {
  characterId: ID;
  visible: boolean;
  /** -1 (left edge) … 1 (right edge); |x| > 1 means outside the frame. */
  x: number;
  distM: number;
  screenX: ScreenX;
  depth: Depth;
  /** Relative to the camera: 'toward camera' | 'away from camera' | 'left' | 'right' (screen directions). */
  facing: 'toward camera' | 'away from camera' | 'screen left' | 'screen right';
}
type ID = string;

export function fovFor(camera: MapCamera, shotSize: ShotSize): number {
  return camera.fovDeg ?? SHOT_SIZE_BY_ID[shotSize].fovDeg;
}

/** Project character marks through the shot camera to get left/right + depth for prompts. */
export function projectMarks(camera: MapCamera, shotSize: ShotSize, marks: CharacterMark[], map: LocationMap): ScreenPlacement[] {
  const target = resolveTarget(camera, marks, map);
  const f = norm(sub(target, camera.pos));
  const r: Vec2 = { x: -f.y, y: f.x }; // camera right (y-down)
  const halfTan = Math.tan((fovFor(camera, shotSize) / 2) / DEG);
  const dists = marks.map((m) => Math.max(0.05, dot(sub(m.pos, camera.pos), f)));
  const minD = Math.min(...dists);
  const maxD = Math.max(...dists);

  return marks.map((m, i) => {
    const rel = sub(m.pos, camera.pos);
    const depthM = dot(rel, f);
    const lateral = dot(rel, r);
    const x = depthM <= 0.05 ? (lateral >= 0 ? 9 : -9) : lateral / depthM / halfTan;
    const visible = depthM > 0.05 && Math.abs(x) <= 1.1;
    const screenX: ScreenX = x < -0.6 ? 'left' : x < -0.2 ? 'center-left' : x <= 0.2 ? 'center' : x <= 0.6 ? 'center-right' : 'right';
    let depth: Depth = 'midground';
    if (marks.length > 1 && maxD - minD > 1.2) {
      const t = (dists[i] - minD) / (maxD - minD);
      depth = t < 0.34 ? 'foreground' : t > 0.66 ? 'background' : 'midground';
    }
    // Facing: facingDeg 0 = map up (−y), clockwise.
    const fd = (m.facingDeg / DEG);
    const faceVec: Vec2 = { x: Math.sin(fd), y: -Math.cos(fd) };
    const toCam = norm(sub(camera.pos, m.pos));
    const c = dot(faceVec, toCam);
    const side = dot(faceVec, r);
    const facing: ScreenPlacement['facing'] = c > 0.5 ? 'toward camera' : c < -0.5 ? 'away from camera' : side > 0 ? 'screen right' : 'screen left';
    return { characterId: m.characterId, visible, x, distM: depthM, screenX, depth, facing };
  });
}

/** Place a camera around a target for a given side and shot size (used by AI breakdown + "auto place"). */
export function placeCamera(
  map: LocationMap,
  target: Vec2,
  side: 'front' | 'front-left' | 'front-right' | 'left' | 'right' | 'back' | 'overhead',
  shotSize: ShotSize,
): MapCamera {
  const refTarget = map.referenceCamera.target ?? map.subject;
  const base = norm(sub(map.referenceCamera.pos, refTarget));
  const sideDeg: Record<typeof side, number> = {
    front: 0,
    'front-right': 45,
    right: 90,
    back: 180,
    left: 270,
    'front-left': 315,
    overhead: 0,
  };
  const a = sideDeg[side] / DEG;
  // Rotate clockwise on screen (y-down): x' = x cos − y sin, y' = x sin + y cos
  const dir: Vec2 = { x: base.x * Math.cos(a) - base.y * Math.sin(a), y: base.x * Math.sin(a) + base.y * Math.cos(a) };
  const dist = SHOT_SIZE_BY_ID[shotSize].defaultDistM;
  const pos = add(target, scale(dir, dist));
  const clamped = { x: Math.min(map.widthM, Math.max(0, pos.x)), y: Math.min(map.heightM, Math.max(0, pos.y)) };
  return { pos: clamped, target, heightM: side === 'overhead' ? Math.max(4, dist * 1.5) : 1.6 };
}

export function defaultLocationMap(): LocationMap {
  const widthM = 12;
  const heightM = 8;
  const subject = { x: widthM / 2, y: heightM / 2 };
  return {
    widthM,
    heightM,
    elements: [],
    subject,
    referenceCamera: { pos: { x: widthM / 2, y: heightM - 0.5 }, target: subject, heightM: 1.6 },
  };
}

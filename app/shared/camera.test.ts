import { describe, expect, it } from 'vitest';
import { anglePrompt, defaultLocationMap, placeCamera, projectMarks, shotAngle } from './camera';
import type { CharacterMark } from './types';

const map = defaultLocationMap(); // 12×8, subject (6,4), reference camera at (6,7.5) looking north

describe('shotAngle', () => {
  it('reference position is the front view at eye level', () => {
    const a = shotAngle({ camera: { pos: { x: 6, y: 7.5 }, heightM: 1.6 }, shotSize: 'MS', marks: [], map });
    expect(a.azimuth).toBe('front view');
    expect(a.elevation).toBe('eye-level shot');
    expect(a.distance).toBe('medium shot');
  });

  it("camera on the viewer's left (west) sees the subject's right side", () => {
    const a = shotAngle({ camera: { pos: { x: 2, y: 4 }, heightM: 1.6 }, shotSize: 'CU', marks: [], map });
    expect(a.azimuth).toBe('right side view');
    expect(a.distance).toBe('close-up');
  });

  it('camera east sees the left side, north sees the back', () => {
    expect(shotAngle({ camera: { pos: { x: 10, y: 4 }, heightM: 1.6 }, shotSize: 'WS', marks: [], map }).azimuth).toBe('left side view');
    expect(shotAngle({ camera: { pos: { x: 6, y: 0.5 }, heightM: 1.6 }, shotSize: 'WS', marks: [], map }).azimuth).toBe('back view');
    expect(shotAngle({ camera: { pos: { x: 3, y: 7 }, heightM: 1.6 }, shotSize: 'WS', marks: [], map }).azimuth).toBe('front-right quarter view');
  });

  it('height maps to elevation buckets', () => {
    expect(shotAngle({ camera: { pos: { x: 6, y: 7 }, heightM: 0.3 }, shotSize: 'MS', marks: [], map }).elevation).toBe('low-angle shot');
    expect(shotAngle({ camera: { pos: { x: 6, y: 7 }, heightM: 3.2 }, shotSize: 'MS', marks: [], map }).elevation).toBe('elevated shot');
    expect(shotAngle({ camera: { pos: { x: 6, y: 5 }, heightM: 6 }, shotSize: 'MS', marks: [], map }).elevation).toBe('high-angle shot');
  });

  it('builds the LoRA prompt', () => {
    expect(anglePrompt({ azimuth: 'back view', elevation: 'low-angle shot', distance: 'wide shot' })).toBe('<sks> back view low-angle shot wide shot');
  });
});

describe('placeCamera ↔ shotAngle round trip', () => {
  const sides = [
    ['front', 'front view'],
    ['front-right', 'front-right quarter view'],
    ['right', 'right side view'],
    ['back', 'back view'],
    ['left', 'left side view'],
    ['front-left', 'front-left quarter view'],
  ] as const;
  for (const [side, az] of sides) {
    it(side, () => {
      const cam = placeCamera(map, map.subject, side, 'MS');
      expect(shotAngle({ camera: cam, shotSize: 'MS', marks: [], map }).azimuth).toBe(az);
    });
  }
});

describe('projectMarks', () => {
  const marks: CharacterMark[] = [
    { characterId: 'a', pos: { x: 5, y: 4 }, facingDeg: 180 }, // west of center, facing south (toward ref camera)
    { characterId: 'b', pos: { x: 7, y: 4 }, facingDeg: 270 }, // east of center, facing west
  ];
  it('left/right from the front camera', () => {
    const cam = { pos: { x: 6, y: 7.5 }, heightM: 1.6 };
    const [a, b] = projectMarks(cam, 'WS', marks, map);
    expect(a.screenX === 'left' || a.screenX === 'center-left').toBe(true);
    expect(b.screenX === 'right' || b.screenX === 'center-right').toBe(true);
    expect(a.visible && b.visible).toBe(true);
    expect(a.facing).toBe('toward camera');
    expect(b.facing).toBe('screen left');
  });
  it('mirrors from the reverse angle', () => {
    const cam = { pos: { x: 6, y: 0.5 }, heightM: 1.6 };
    const [a, b] = projectMarks(cam, 'WS', marks, map);
    expect(a.x).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(0);
    expect(a.facing).toBe('away from camera');
  });
  it('marks behind the camera are not visible', () => {
    const cam = { pos: { x: 6, y: 3 }, target: { x: 6, y: 0 }, heightM: 1.6 };
    const [a] = projectMarks(cam, 'MS', marks, map);
    expect(a.visible).toBe(false);
  });
});

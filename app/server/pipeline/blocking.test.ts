import { describe, expect, it } from 'vitest';
import { aimCamera, completeBlocking, defaultLocationMap, placeCamera, projectMarks } from '../../shared/camera';
import type { CharacterMark } from '../../shared/types';

const map = defaultLocationMap();
const visible = (marks: CharacterMark[], size: 'CU' | 'MS' | 'WS') => {
  const cam = aimCamera(placeCamera(map, map.subject, 'front', size), marks, size, map);
  return projectMarks(cam, size, marks, map).map((p) => p.visible);
};

describe('hand-built shots frame their cast', () => {
  it('gives unplaced characters default spots near the subject', () => {
    const marks = completeBlocking([], ['a', 'b'], map);
    expect(marks.map((m) => m.characterId)).toEqual(['a', 'b']);
    for (const m of marks) expect(Math.hypot(m.pos.x - map.subject.x, m.pos.y - map.subject.y)).toBeCloseTo(0.6);
  });

  it('keeps existing marks and only fills in the missing ones', () => {
    const placed: CharacterMark = { characterId: 'a', pos: { x: 2, y: 2 }, facingDeg: 90 };
    expect(completeBlocking([placed], ['a', 'b'], map)[0]).toBe(placed);
    expect(completeBlocking([placed], ['b'], map).map((m) => m.characterId)).toEqual(['b']);
  });

  it('frames a single character and a two-shot at MS and CU', () => {
    expect(visible(completeBlocking([], ['a'], map), 'CU')).toEqual([true]);
    expect(visible(completeBlocking([], ['a', 'b'], map), 'MS')).toEqual([true, true]);
  });

  it('backs off to fit a cast placed far apart', () => {
    const far: CharacterMark[] = [
      { characterId: 'a', pos: { x: 4.9, y: 4.6 }, facingDeg: 90 },
      { characterId: 'b', pos: { x: 7.5, y: 4.6 }, facingDeg: 270 },
    ];
    expect(visible(far, 'MS')).toEqual([true, true]);
  });

  it('marks studio-placed cameras as auto and keeps their direction', () => {
    const side = placeCamera(map, map.subject, 'left', 'MS');
    const cam = aimCamera(side, completeBlocking([], ['a'], map), 'MS', map);
    expect(cam.auto).toBe(true);
    expect(Math.sign(cam.pos.x - cam.target!.x)).toBe(Math.sign(side.pos.x - side.target!.x));
  });
});

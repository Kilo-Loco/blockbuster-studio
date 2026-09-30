import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Isolate this test's SQLite DB from other test files / the real dev .data dir — reference_sheet.ts's job
// runner registration touches '../db' at import time, though these tests only exercise its pure functions.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-refsheet-test-'));
process.env.DATA_DIR = tmpDir;

const { describeReferenceSheet, layoutReferenceSheet, sceneCastIds, SHEET_WIDTH, SHEET_HEIGHT } = await import('./reference_sheet');

describe('layoutReferenceSheet', () => {
  it('gives each character a full-width row, face + turnaround split when both exist', () => {
    const layout = layoutReferenceSheet({ characters: [{ id: 'c1', face: true, turnaround: true }], props: [], location: false }, 900, 600);
    expect(layout.rows).toHaveLength(1);
    expect(layout.panels).toHaveLength(2);
    const [face, turnaround] = layout.panels;
    expect(face).toMatchObject({ ownerId: 'c1', kind: 'face', x: 0, y: 0, h: 600 });
    expect(turnaround!.kind).toBe('turnaround');
    expect(turnaround!.x).toBe(face!.w);
    expect(face!.w + turnaround!.w).toBe(900);
  });

  it('gives a character with only one sheet asset the full row width', () => {
    const layout = layoutReferenceSheet({ characters: [{ id: 'c1', face: false, turnaround: true }], props: [], location: false }, 900, 600);
    expect(layout.panels).toEqual([{ ownerId: 'c1', kind: 'turnaround', x: 0, y: 0, w: 900, h: 600 }]);
  });

  it('stacks multiple characters into equal-height rows filling the full height', () => {
    const layout = layoutReferenceSheet(
      { characters: [{ id: 'c1', face: true, turnaround: true }, { id: 'c2', face: true, turnaround: true }], props: [], location: false },
      900,
      600,
    );
    expect(layout.rows).toHaveLength(2);
    const totalH = layout.rows.reduce((sum, r) => sum + r.panels[0]!.h, 0);
    expect(totalH).toBe(600);
    expect(layout.rows[1]!.panels[0]!.y).toBe(layout.rows[0]!.panels[0]!.h);
  });

  it('gives props and the location a shared bottom row, smaller than the character rows', () => {
    const layout = layoutReferenceSheet(
      { characters: [{ id: 'c1', face: true, turnaround: true }], props: [{ id: 'car1' }], location: true },
      900,
      600,
    );
    expect(layout.rows).toHaveLength(2);
    const [charRow, bottomRow] = layout.rows;
    expect(bottomRow!.panels).toHaveLength(2);
    expect(bottomRow!.panels.map((p) => p.kind)).toEqual(['prop', 'location']);
    expect(bottomRow!.panels[0]!.h).toBeLessThan(charRow!.panels[0]!.h); // characters get the biggest panels
    // Panels tile the full width with no gap or overlap.
    expect(bottomRow!.panels[0]!.x).toBe(0);
    expect(bottomRow!.panels[0]!.x + bottomRow!.panels[0]!.w).toBe(bottomRow!.panels[1]!.x);
    expect(bottomRow!.panels[1]!.x + bottomRow!.panels[1]!.w).toBe(900);
    // A prop gets twice the location's width and a taller row than a location-only sheet.
    expect(bottomRow!.panels[0]!.w).toBe(600);
    expect(bottomRow!.panels[0]!.h).toBe(240);
  });

  it('keeps the shorter bottom row when there is only a location', () => {
    const layout = layoutReferenceSheet({ characters: [{ id: 'c1', face: true, turnaround: true }], props: [], location: true }, 900, 600);
    expect(layout.rows[1]!.panels[0]!.h).toBe(168);
  });

  it('has no bottom row when there are no props and no location', () => {
    const layout = layoutReferenceSheet({ characters: [{ id: 'c1', face: true, turnaround: false }], props: [], location: false }, 900, 600);
    expect(layout.rows).toHaveLength(1);
    expect(layout.panels[0]!.h).toBe(600);
  });

  it('handles no characters at all (props/location only)', () => {
    const layout = layoutReferenceSheet({ characters: [], props: [{ id: 'car1' }], location: true }, 900, 600);
    expect(layout.rows).toHaveLength(1);
    expect(layout.panels).toHaveLength(2);
  });

  it('uses the tested ~16:9 sheet canvas size', () => {
    expect(SHEET_WIDTH / SHEET_HEIGHT).toBeCloseTo(16 / 9, 1);
  });
});

describe('describeReferenceSheet', () => {
  const describe_ = (ownerId: string, kind: string) => `${kind}:${ownerId}`;

  it('labels a single row "Top row" and positions left/right for two panels', () => {
    const layout = layoutReferenceSheet({ characters: [{ id: 'c1', face: true, turnaround: true }], props: [], location: false }, 900, 600);
    const text = describeReferenceSheet(layout, describe_);
    expect(text).toBe('Top row left: face:c1. Top row right: turnaround:c1.');
  });

  it('labels the last of several rows "Bottom row" and middle rows by number', () => {
    const layout = layoutReferenceSheet(
      {
        characters: [{ id: 'c1', face: true, turnaround: false }, { id: 'c2', face: true, turnaround: false }],
        props: [{ id: 'car1' }],
        location: true,
      },
      900,
      600,
    );
    const text = describeReferenceSheet(layout, describe_);
    expect(text).toContain('Top row: face:c1.');
    expect(text).toContain('Row 2: face:c2.');
    expect(text).toContain('Bottom row left: prop:car1.');
    expect(text).toContain('Bottom row right: location:__location__.');
  });

  it('uses left/middle/right for a three-panel row', () => {
    const layout = layoutReferenceSheet({ characters: [], props: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], location: false }, 900, 600);
    const text = describeReferenceSheet(layout, describe_);
    expect(text).toBe('Top row left: prop:a. Top row middle: prop:b. Top row right: prop:c.');
  });
});

describe('sceneCastIds', () => {
  it('uses scene.castIds, in order, when set', () => {
    const scene = { castIds: ['c2', 'c1'] };
    const shots = [{ characterIds: ['c1'] }, { characterIds: ['c3'] }];
    expect(sceneCastIds(scene, shots)).toEqual(['c2', 'c1']);
  });

  it("falls back to the union of the shots' characterIds when castIds is unset or empty", () => {
    const shots = [{ characterIds: ['c1', 'c2'] }, { characterIds: ['c2', 'c3'] }];
    expect(sceneCastIds({}, shots)).toEqual(['c1', 'c2', 'c3']);
    expect(sceneCastIds({ castIds: [] }, shots)).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns an empty array for a scene with no cast and no shot characters', () => {
    expect(sceneCastIds({}, [])).toEqual([]);
  });
});

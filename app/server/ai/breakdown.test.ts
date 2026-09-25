import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-breakdown-test-'));
process.env.DATA_DIR = tmpDir;

const { applyBreakdown } = await import('./breakdown');
const { projects, characters, locations, scenes } = await import('../db');
import type { BreakdownDraft } from '../../shared/types';

function cannedDraft(): BreakdownDraft {
  return {
    logline: 'A courier discovers her final delivery is a bomb.',
    characters: [{ name: 'Mara', description: 'a woman in her 30s with short silver hair, a black courier jacket' }],
    locations: [{ name: 'Ramen bar', description: 'a neon-lit ramen bar, rain streaking the windows, 1980s Tokyo' }],
    scenes: [
      {
        title: 'INT. RAMEN BAR - NIGHT',
        description: 'Mara waits at the counter, watching the door.',
        locationName: 'Ramen bar',
        timeOfDay: 'night',
        shots: [
          {
            action: 'Establishing wide of the empty bar.',
            shotSize: 'EWS',
            cameraMove: 'static',
            characterNames: [],
            durationSec: 4,
            cameraSide: 'front',
          },
          {
            action: 'Mara slides the envelope across the counter without looking up.',
            dialogue: "It's not what you think.",
            shotSize: 'MCU',
            cameraMove: 'push_in',
            characterNames: ['Mara'],
            durationSec: 5,
            cameraSide: 'front-left',
          },
        ],
      },
    ],
  };
}

describe('applyBreakdown', () => {
  it('creates missing characters/locations/scenes/shots and returns a ProjectDetail', () => {
    const project = projects.create({ name: 'Courier', aspect: '16:9' });
    const detail = applyBreakdown(project.id, cannedDraft());

    expect(detail.project.id).toBe(project.id);
    expect(detail.scenes).toHaveLength(1);
    expect(detail.scenes[0]!.shots).toHaveLength(2);

    const mara = characters.list().find((c) => c.name === 'Mara');
    expect(mara).toBeDefined();
    expect(mara!.description).toContain('silver hair');

    const bar = locations.list().find((l) => l.name === 'Ramen bar');
    expect(bar).toBeDefined();

    const scene = scenes.get(detail.scenes[0]!.id)!;
    expect(scene.locationId).toBe(bar!.id);
    expect(scene.timeOfDay).toBe('night');

    const [wideShot, closeShot] = detail.scenes[0]!.shots;
    expect(wideShot!.characterIds).toEqual([]);
    expect(closeShot!.characterIds).toEqual([mara!.id]);
    expect(closeShot!.dialogue).toBe("It's not what you think.");
    expect(closeShot!.durationSec).toBeGreaterThanOrEqual(2);
    expect(closeShot!.durationSec).toBeLessThanOrEqual(7);
    // camera was auto-placed from placeCamera(), so it should have a valid in-bounds position.
    expect(closeShot!.camera.pos.x).toBeGreaterThanOrEqual(0);
    expect(closeShot!.camera.pos.y).toBeGreaterThanOrEqual(0);
  });

  it('reuses an existing character by exact name instead of creating a duplicate', () => {
    const project = projects.create({ name: 'Courier 2', aspect: '16:9' });
    const existing = characters.create({ name: 'Mara Reuse', description: 'existing description', color: '#fff' });
    const draft = cannedDraft();
    draft.characters[0]!.name = 'Mara Reuse';
    draft.scenes[0]!.shots[1]!.characterNames = ['Mara Reuse'];
    applyBreakdown(project.id, draft);
    const maras = characters.list().filter((c) => c.name === 'Mara Reuse');
    expect(maras).toHaveLength(1);
    expect(maras[0]!.id).toBe(existing.id);
    // The existing character's description is NOT overwritten by the draft.
    expect(maras[0]!.description).toBe('existing description');
  });
});

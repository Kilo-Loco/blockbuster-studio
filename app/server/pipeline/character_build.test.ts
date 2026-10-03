import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// character_build.ts imports the DB (through the runner registry); keep it off the dev data dir.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-character-build-test-'));

const { planBuild, readBuildParams, defaultTriggerWord, DEFAULT_VARIATIONS, MAX_VARIATIONS } = await import('./character_build');

describe('planBuild', () => {
  it('makes a turnaround, a face and the requested variations for a person with the edit models', () => {
    const steps = planBuild({ kind: 'person', description: 'a woman with silver hair' }, 12, true);
    expect(steps.map((s) => s.slot)).toEqual(['turnaround', 'face', ...Array<string>(12).fill('variation')]);
    // The look drives every image; about a third of the variations are other camera angles of it.
    expect(steps.every((s) => s.engine !== 'zimage')).toBe(true);
    expect(steps.filter((s) => s.engine === 'angle')).toHaveLength(4);
    expect(steps.filter((s) => s.engine === 'angle').every((s) => s.prompt.startsWith('<sks> '))).toBe(true);
    // Scene variations leave the grey studio, so the LoRA learns the character and not the backdrop.
    const scenes = steps.filter((s) => s.slot === 'variation' && s.engine === 'edit');
    expect(scenes).toHaveLength(8);
    expect(new Set(scenes.map((s) => s.prompt)).size).toBe(8);
    expect(scenes.every((s) => s.prompt.includes('same person as in image 1'))).toBe(true);
    // Sheets keep the studio backdrop and their frames.
    expect(steps[0]).toMatchObject({ slot: 'turnaround', width: 1344, height: 768 });
    expect(steps[0]!.prompt).toContain('#C8C8C8');
    expect(steps[1]).toMatchObject({ slot: 'face', width: 1024, height: 1024 });
  });

  it('skips the face for props and describes the same object', () => {
    const steps = planBuild({ kind: 'prop', description: 'a dented teal pickup' }, 6, true);
    expect(steps.some((s) => s.slot === 'face')).toBe(false);
    expect(steps[0]!.prompt).toContain('same object as in image 1');
    expect(steps.filter((s) => s.slot === 'variation')).toHaveLength(6);
  });

  it('falls back to Z-Image from the description without the edit models', () => {
    const steps = planBuild({ kind: 'person', description: 'a tall man in a red coat' }, 5, false);
    expect(steps.every((s) => s.engine === 'zimage')).toBe(true);
    expect(steps.filter((s) => s.slot === 'variation')).toHaveLength(5);
    expect(steps.every((s) => s.prompt.includes('a tall man in a red coat'))).toBe(true);
  });

  it('can build with no variations at all (sheets only)', () => {
    expect(planBuild({ kind: 'person', description: 'x' }, 0, true).map((s) => s.slot)).toEqual(['turnaround', 'face']);
  });
});

describe('readBuildParams', () => {
  it('fills defaults and clamps', () => {
    const p = readBuildParams({ characterId: 'c1', lookAssetId: 'a1' });
    expect(p).toMatchObject({ characterId: 'c1', lookAssetId: 'a1', train: true, variations: DEFAULT_VARIATIONS });
    expect(readBuildParams({ characterId: 'c1', lookAssetId: 'a1', variations: 999, train: false, triggerWord: '  ', steps: 800 })).toMatchObject({
      variations: MAX_VARIATIONS,
      train: false,
      triggerWord: undefined,
      steps: 800,
    });
  });

  it('refuses a job without a look', () => {
    expect(() => readBuildParams({ characterId: 'c1' })).toThrow(/lookAssetId/);
  });
});

describe('defaultTriggerWord', () => {
  it("keeps the character's own, else derives one from the name", () => {
    expect(defaultTriggerWord({ name: 'Mara', triggerWord: 'ohwx_m' })).toBe('ohwx_m');
    expect(defaultTriggerWord({ name: 'Dr. Mara Voss!' })).toBe('ohwx_dr_mara_voss');
    expect(defaultTriggerWord({ name: '!!!' })).toBe('ohwx_character');
  });
});

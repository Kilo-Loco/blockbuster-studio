import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// character_build.ts imports the DB (through the runner registry); keep it off the dev data dir.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-captions-test-'));

const { captionFor, sceneFromPrompt } = await import('./captions');
const { planBuild } = await import('../pipeline/character_build');

const description = 'a woman with silver hair and an eyebrow scar, green raincoat';
const params = { triggerWord: 'ohwx_mara', description };

describe('captionFor on character builder images', () => {
  const steps = planBuild({ kind: 'person', description }, 12, true);
  const captions = steps.map((s, i) => captionFor(params, { id: `a${i}`, prompt: s.prompt }));

  it('gives every image its own caption, led by the trigger word', () => {
    expect(new Set(captions).size).toBe(captions.length);
    expect(captions.every((c) => c.startsWith('ohwx_mara, '))).toBe(true);
  });

  it('keeps what is specific to the image and drops the identity boilerplate and backdrop', () => {
    for (const c of captions) {
      expect(c).not.toContain('The same person as in image 1');
      expect(c).not.toContain('<sks>');
      expect(c).not.toContain('#C8C8C8');
      expect(c).not.toMatch(/no watermark/i);
    }
    const scene = captions[steps.findIndex((s) => s.prompt.includes('café'))];
    expect(scene).toBe('ohwx_mara, sitting at a café table, laughing, daylight, shallow depth of field, photorealistic.');
    const angle = captions[steps.findIndex((s) => s.engine === 'angle')];
    expect(angle).toBe('ohwx_mara, front-left quarter view eye-level shot medium shot');
  });

  it('leaves the description out, so the trigger word carries the identity', () => {
    expect(captions.some((c) => c.includes('silver hair'))).toBe(false);
  });
});

describe('captionFor', () => {
  it('uses an explicit caption as written, for LoRAs that hold several characters', () => {
    const caption = 'ohwx_astra sitting behind a desk, ohwx_hrrep standing on the left, claymation office';
    expect(captionFor({ ...params, captions: { a1: `  ${caption} ` } }, { id: 'a1', prompt: 'anything' })).toBe(caption);
  });

  it('falls back to the trigger word and description when the image has no prompt (an upload)', () => {
    expect(captionFor(params, { id: 'u1' })).toBe(`ohwx_mara, ${description}`);
    expect(captionFor({ triggerWord: 'ohwx_mara' }, { id: 'u1' })).toBe('ohwx_mara');
  });

  it('strips the description from a text-only (Z-Image) look prompt', () => {
    const look = `Full body photo of ${description}, standing, facing the camera, plain flat light-grey seamless background (#C8C8C8), soft even light, sharp focus, photorealistic. No text, no labels, no graphics, single person only.`;
    expect(sceneFromPrompt(look, description)).toBe('Full body, standing, facing the camera, sharp focus, photorealistic.');
  });
});

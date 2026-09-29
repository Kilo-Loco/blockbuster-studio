import { describe, expect, it } from 'vitest';
import { CAMERA_MOVE_BY_ID } from '../../shared/presets';
import { loraFamilyFromBaseModel } from '../loras/import';
import { H3_CAMERA, H3_FIRST_FRAME_LINE, formatH3Prompt, formatH3RefPrompt } from './h3_prompt';
import { buildClipWorkflow } from './video_backend';
import type { ClipRequest } from './video_backend';

describe('formatH3Prompt', () => {
  it('wraps a plain prompt in the three official sections with safe audio defaults', () => {
    const out = formatH3Prompt('A dog skateboards across a campus quad.', { firstFrame: false });
    expect(out).toBe(
      'integrated_multimodal_description: [Shot 1] A dog skateboards across a campus quad.\n' +
        'overall_soundscape: Natural, realistic sound that matches the scene: its ambience and the sounds of the action.\n' +
        'non_diegetic_music: No music.',
    );
  });

  it('adds the image-alignment line for image-to-video', () => {
    const out = formatH3Prompt('She takes a bite.', { firstFrame: true });
    expect(out.startsWith(`${H3_FIRST_FRAME_LINE}\nintegrated_multimodal_description: [Shot 1] She takes a bite.`)).toBe(true);
  });

  it('turns studio camera presets into H3 camera phrasing', () => {
    const out = formatH3Prompt(`She walks away. ${CAMERA_MOVE_BY_ID.push_in.phrase}`, { firstFrame: false });
    expect(out).toContain(H3_CAMERA.push_in);
    expect(out).not.toContain(CAMERA_MOVE_BY_ID.push_in.phrase);
  });

  it('moves Audio: and Music: into their own sections', () => {
    const out = formatH3Prompt('Rain in an alley. Audio: heavy rain, footsteps. Music: a low synth pad.', { firstFrame: false });
    expect(out).toContain('integrated_multimodal_description: [Shot 1] Rain in an alley.\n');
    expect(out).toContain('overall_soundscape: heavy rain, footsteps.\n');
    expect(out).toContain('non_diegetic_music: a low synth pad.');
  });

  it('turns quoted speech into H3 dialogue tags', () => {
    const out = formatH3Prompt('The old man smiles and says: "Rough night, huh?"', { firstFrame: true });
    expect(out).toContain('says: <d>[English] Rough night, huh?</d>');
  });

  it('passes prompts already in H3 format through (adding only the alignment line)', () => {
    const own = 'integrated_multimodal_description: [Shot 1] x\noverall_soundscape: y\nnon_diegetic_music: z';
    expect(formatH3Prompt(own, { firstFrame: false })).toBe(own);
    expect(formatH3Prompt(own, { firstFrame: true })).toBe(`${H3_FIRST_FRAME_LINE}\n${own}`);
  });
});

describe('formatH3RefPrompt', () => {
  it('wraps a plain prompt: images are fully_preserved subjects, the video a partially_preserved guide', () => {
    const out = formatH3RefPrompt('The car launches. Sound: engines. Music: none.', { imageLabels: ['the green car'], videoLabels: ['the previs cut of this shot'] });
    expect(out.startsWith('subject_definitions:\n<Subject 1> is the green car, whose appearance comes from <Picture 1>.\n<Video 1> is the previs cut of this shot;')).toBe(true);
    expect(out).toContain('<Subject 1> (appears in [Shot 1]): fully_preserved');
    expect(out).toContain('<Video 1> (camera, framing, positions and timing): partially_preserved');
    expect(out).not.toContain('weak_reference');
    expect(out).toContain('detailed_description: One single continuous shot with no cuts; the reference pictures define appearance only and never appear as inserted stills. [Shot 1] The car launches.');
    expect(out).toContain('overall_soundscape: engines');
  });

  it('keeps the cuts of a multi-shot description and only forbids inserted stills', () => {
    const out = formatH3RefPrompt('[Shot 1] She runs. [Shot 2] At 00:02.000, the camera cuts to her feet.', { imageLabels: ['Maya'], videoLabels: ['the previs'] });
    expect(out).toContain('detailed_description: The reference pictures define appearance only and never appear as inserted stills; the only cuts are the ones listed, at their times. [Shot 1] She runs. [Shot 2]');
    expect(out).not.toContain('no cuts');
  });

  it('passes a prompt already in the six-field format through untouched', () => {
    const full = 'subject_definitions:\n<Subject 1> is X, from <Picture 1>.\nsummary: s\nretention_analysis:\n<Subject 1>: fully_preserved\ndetailed_description: d\noverall_soundscape: o\nnon_diegetic_music: No music.';
    expect(formatH3RefPrompt(full, { imageLabels: ['ignored'] })).toBe(full);
  });
});

describe('Civitai base model → LoRA family', () => {
  it('recognizes MiniMax H3 LoRAs', () => {
    expect(loraFamilyFromBaseModel('MiniMax H3', 'zimage')).toBe('minimax_h3');
    expect(loraFamilyFromBaseModel('Wan Video 2.2 I2V-A14B', 'zimage')).toBe('wan22');
    expect(loraFamilyFromBaseModel('ZImageTurbo', 'wan22')).toBe('zimage');
    expect(loraFamilyFromBaseModel('Qwen Image Edit', 'zimage')).toBe('qwen_edit');
  });
});

describe('video LoRAs reach only their own model', () => {
  const req: ClipRequest = {
    prompt: 'x',
    negativePrompt: 'n',
    aspect: '16:9',
    quality: 'fast',
    durationSec: 5,
    seed: 1,
    startImage: 'in.png',
    loras: [
      { filename: 'wan_style.safetensors', strength: 0.8, family: 'wan22' },
      { filename: 'h3_style.safetensors', strength: 0.9, family: 'minimax_h3' },
    ],
  };
  const loraNames = (wf: ReturnType<typeof buildClipWorkflow>['workflow']) =>
    Object.values(wf)
      .filter((n) => n.class_type === 'LoraLoaderModelOnly')
      .map((n) => n.inputs.lora_name);

  it('H3 gets the turbo LoRA plus H3 LoRAs', () => {
    const names = loraNames(buildClipWorkflow('minimax_h3', req, true).workflow);
    expect(names).toContain('h3_style.safetensors');
    expect(names).not.toContain('wan_style.safetensors');
    expect(names[0]).toMatch(/turbo/);
  });

  it('Wan gets only Wan LoRAs', () => {
    const names = loraNames(buildClipWorkflow('wan', req, true).workflow);
    expect(names).toContain('wan_style.safetensors');
    expect(names).not.toContain('h3_style.safetensors');
  });
});

describe('Civitai URLs', () => {
  it('accepts civitai.red links (same model ids as civitai.com)', async () => {
    const { parseImportUrl } = await import('../loras/import');
    expect(parseImportUrl('https://civitai.red/models/2834417/hmnsfw-aio')).toEqual({ source: 'civitai', civitaiModelId: '2834417' });
    expect(parseImportUrl('https://civitai.com/models/2834417?modelVersionId=3268303')).toEqual({ source: 'civitai', civitaiModelVersionId: '3268303' });
    expect(parseImportUrl('https://notcivitai.example.com/models/1').source).toBe('url');
  });
});

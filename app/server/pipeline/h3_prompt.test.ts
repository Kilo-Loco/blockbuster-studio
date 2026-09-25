import { describe, expect, it } from 'vitest';
import { CAMERA_MOVE_BY_ID } from '../../shared/presets';
import { loraFamilyFromBaseModel } from '../loras/import';
import { H3_CAMERA, H3_FIRST_FRAME_LINE, formatH3Prompt } from './h3_prompt';
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

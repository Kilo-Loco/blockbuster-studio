import { describe, expect, it } from 'vitest';
import { CAMERA_MOVE_BY_ID } from '../../shared/presets';
import { loraFamilyFromBaseModel } from '../loras/import';
import { LTX_FIRST_FRAME_LINE, LTX_FIRST_LAST_FRAME_LINE, formatLtxPrompt } from './ltx_prompt';
import { buildClipWorkflow, type ClipRequest } from './video_backend';

describe('formatLtxPrompt', () => {
  it('keeps the description and camera sentence as one paragraph, and asks for no music by default', () => {
    const camera = CAMERA_MOVE_BY_ID.push_in.phrase;
    expect(formatLtxPrompt(`A dog skateboards across a campus quad. ${camera}`, { firstFrame: false })).toBe(
      `A dog skateboards across a campus quad. ${camera} No music.`,
    );
  });

  it('adds the start-image line for image-to-video and the end-image anchor for first/last frame', () => {
    expect(formatLtxPrompt('She takes a bite.', { firstFrame: true })).toBe(`${LTX_FIRST_FRAME_LINE} She takes a bite. No music.`);
    expect(formatLtxPrompt('She takes a bite.', { firstFrame: true, lastFrame: true })).toBe(`${LTX_FIRST_LAST_FRAME_LINE} She takes a bite. No music.`);
    const own = 'Use the provided start image as the first frame. She walks.';
    expect(formatLtxPrompt(own, { firstFrame: true })).toBe(`${own} No music.`);
  });

  it('moves Audio: and Music: to the end and keeps quoted dialogue as written', () => {
    const out = formatLtxPrompt('Hank says: "Rough night, huh?" Audio: rain on the window. Music: a low synth pad.', { firstFrame: true });
    expect(out).toBe(`${LTX_FIRST_FRAME_LINE} Hank says: "Rough night, huh?" Sound: rain on the window. Music: a low synth pad.`);
  });
});

describe('LTX-2.5 clip workflows', () => {
  const req: ClipRequest = {
    prompt: 'x',
    negativePrompt: 'n',
    aspect: '16:9',
    quality: 'fast',
    durationSec: 5,
    seed: 1,
    loras: [
      { filename: 'wan_style.safetensors', strength: 0.8, family: 'wan22' },
      { filename: 'ltx_style.safetensors', strength: 0.9, family: 'ltx2' },
    ],
  };
  const nodes = (r: ClipRequest) => Object.values(buildClipWorkflow('ltx_2_5', r, true).workflow);
  const count = (r: ClipRequest, type: string) => nodes(r).filter((n) => n.class_type === type).length;

  it('gets only LTX LoRAs', () => {
    const loras = nodes(req)
      .filter((n) => n.class_type === 'LoraLoaderModelOnly')
      .map((n) => n.inputs.lora_name);
    expect(loras).toEqual(['ltx_style.safetensors']);
  });

  it('text-to-video: two passes with the latent upscaler, no image conditioning', () => {
    expect(count(req, 'SamplerCustomAdvanced')).toBe(2);
    expect(count(req, 'LTXVLatentUpsampler')).toBe(1);
    expect(count(req, 'LTXVImgToVideoInplace')).toBe(0);
    expect(count(req, 'LoadImage')).toBe(0);
  });

  it('image-to-video: the start image conditions both passes', () => {
    const i2v = { ...req, startImage: 'in.png' };
    expect(count(i2v, 'LTXVImgToVideoInplace')).toBe(2);
    expect(count(i2v, 'LTXVAddGuide')).toBe(0);
    expect(nodes(i2v).find((n) => n.class_type === 'LTXVImgToVideoInplace')!.inputs.strength).toBe(0.7);
  });

  it('first/last frame: one full-size pass with keyframe guides at both ends, cropped before decoding', () => {
    const flf = { ...req, startImage: 'a.png', endImage: 'b.png' };
    const guides = nodes(flf).filter((n) => n.class_type === 'LTXVAddGuide');
    expect(guides.map((n) => n.inputs.frame_idx)).toEqual([0, -1]);
    expect(count(flf, 'SamplerCustomAdvanced')).toBe(1);
    expect(count(flf, 'LTXVLatentUpsampler')).toBe(0);
    expect(count(flf, 'LTXVCropGuides')).toBe(1);
    expect(nodes(flf).find((n) => n.class_type === 'EmptyLTXVLatentVideo')!.inputs).toMatchObject({ width: 832, height: 512 });
  });

  it('muxes the generated audio into a 24 fps video', () => {
    const create = nodes(req).find((n) => n.class_type === 'CreateVideo')!;
    expect(create.inputs.fps).toBe(24);
    expect(create.inputs.audio).toBeDefined();
  });
});

describe('Civitai base model → LTX LoRA family', () => {
  it('recognizes LTX-2.x LoRAs but not the older LTX-Video 0.9', () => {
    expect(loraFamilyFromBaseModel('LTXV2', 'zimage')).toBe('ltx2');
    expect(loraFamilyFromBaseModel('LTXV 2.3', 'zimage')).toBe('ltx2');
    expect(loraFamilyFromBaseModel('LTX Video 2', 'zimage')).toBe('ltx2');
    expect(loraFamilyFromBaseModel('LTXV', 'zimage')).toBe('zimage');
    expect(loraFamilyFromBaseModel('LTX Video 0.9', 'wan22')).toBe('wan22');
  });
});

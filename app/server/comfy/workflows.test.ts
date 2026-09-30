// buildSeedVR2Upscale: the graph the SeedVR2 node pack (numz/ComfyUI-SeedVR2_VideoUpscaler) runs, with the
// settings from the 720p→4K bake-off.
import { describe, expect, it } from 'vitest';
import { buildSeedVR2Upscale, MODEL_FILES } from './workflows';

describe('buildSeedVR2Upscale', () => {
  const nodes = buildSeedVR2Upscale({ video: 'drive.mp4', resolution: 2160, fps: 24, seed: 7, filenamePrefix: 'studio/upscale_4k' });
  const byClass = (c: string) => Object.values(nodes).find((n) => n.class_type === c)!;

  it('wires load → upscale → save through the node pack', () => {
    expect(Object.values(nodes).map((n) => n.class_type)).toEqual([
      'LoadVideo',
      'GetVideoComponents',
      'SeedVR2LoadDiTModel',
      'SeedVR2LoadVAEModel',
      'SeedVR2VideoUpscaler',
      'CreateVideo',
      'SaveVideo',
    ]);
  });

  it('loads the 7B fp8-mixed DiT and the fp16 VAE with tiled encode/decode', () => {
    expect(byClass('SeedVR2LoadDiTModel').inputs.model).toBe(MODEL_FILES.seedvr2.dit);
    const vae = byClass('SeedVR2LoadVAEModel').inputs;
    expect(vae.model).toBe(MODEL_FILES.seedvr2.vae);
    expect(vae.encode_tiled).toBe(true);
    expect(vae.decode_tiled).toBe(true);
  });

  it('upscales to the target short edge in overlapping 4n+1 batches with LAB color correction', () => {
    const up = byClass('SeedVR2VideoUpscaler').inputs;
    expect(up.resolution).toBe(2160);
    expect(up.seed).toBe(7);
    expect(((up.batch_size as number) - 1) % 4).toBe(0);
    expect(up.temporal_overlap).toBeGreaterThan(0);
    expect(up.color_correction).toBe('lab');
    expect(up.batch_size).toBe(9);
    const big = buildSeedVR2Upscale({ video: 'drive.mp4', resolution: 2160, fps: 24, batchSize: 13 });
    expect(Object.values(big).find((n) => n.class_type === 'SeedVR2VideoUpscaler')!.inputs.batch_size).toBe(13);
  });

  it('saves an h264 mp4 at the segment fps, with defaults for seed and prefix', () => {
    expect(byClass('CreateVideo').inputs.fps).toBe(24);
    expect(byClass('SaveVideo').inputs.filename_prefix).toBe('studio/upscale_4k');
    const defaults = buildSeedVR2Upscale({ video: 'drive.mp4', resolution: 2160, fps: 24 });
    expect(Object.values(defaults).find((n) => n.class_type === 'SeedVR2VideoUpscaler')!.inputs.seed).toBe(42);
    expect(Object.values(defaults).find((n) => n.class_type === 'SaveVideo')!.inputs.filename_prefix).toBe('studio/upscale_4k');
  });
});

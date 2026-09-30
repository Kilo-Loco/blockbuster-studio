import { describe, expect, it } from 'vitest';
import { ENGINE_FILES, H3_FILES, LTX_FILES, LTX_INGREDIENTS_FILES, MODEL_FILES, buildLtxIc, buildWanVace, h3FramesForDuration, ltxFramesForDuration, ltxKeyframeFrameIdx } from '../comfy/workflows';
import type { ComfyClient } from '../comfy/client';
import { buildClipWorkflow, gridSize, pickVideoModel } from './video_backend';
import { clampDuration, durationsFor, nearestDuration } from '../../shared/presets';
import { resolveVideoModel, type FileAvailability } from '../system';
import type { ModelGroupStatus } from '../../shared/types';

/** A ComfyUI whose loader dropdowns list exactly `files` (plus the H3 / LTX nodes unless turned off). */
function fakeComfy(files: readonly string[], nodes: { h3?: boolean; ltx?: boolean } = {}): ComfyClient {
  const list = [[...files]];
  return {
    objectInfo: async () => ({
      UNETLoader: { input: { required: { unet_name: list } } },
      CLIPLoader: { input: { required: { clip_name: list } } },
      VAELoader: { input: { required: { vae_name: list } } },
      LoraLoaderModelOnly: { input: { required: { lora_name: list } } },
      CLIPVisionLoader: { input: { required: { clip_name: list } } },
      // Newer ComfyUI nodes list options as ["COMBO", { options }] (as the real LatentUpscaleModelLoader does).
      LatentUpscaleModelLoader: { input: { required: { model_name: ['COMBO', { multiselect: false, options: [...files] }] } } },
      ...(nodes.h3 !== false ? { MiniMaxH3ImageToVideo: { input: { required: {} } } } : {}),
      ...(nodes.ltx !== false ? { LTXVDualCFGGuider: { input: { required: {} } } } : {}),
    }),
  } as unknown as ComfyClient;
}

const WAN = [...ENGINE_FILES.wan_i2v, ...ENGINE_FILES.wan_t2v, ...ENGINE_FILES.zimage];

describe('pickVideoModel', () => {
  it('uses Wan when MiniMax H3 is not installed', async () => {
    expect(await pickVideoModel(fakeComfy(WAN), { loras: [], textOnly: false })).toBe('wan');
  });

  it('prefers H3 once it is installed', async () => {
    expect(await pickVideoModel(fakeComfy([...WAN, ...H3_FILES]), { loras: [], textOnly: true })).toBe('minimax_h3');
  });

  it('falls back to Wan for requests with Wan LoRAs', async () => {
    expect(await pickVideoModel(fakeComfy([...WAN, ...H3_FILES]), { loras: [{ filename: 'x.safetensors', strength: 1, family: 'wan22' }], textOnly: false })).toBe('wan');
  });

  it('still uses H3 with LoRAs when Wan is not installed (LoRAs are skipped)', async () => {
    expect(await pickVideoModel(fakeComfy(H3_FILES), { loras: [{ filename: 'x.safetensors', strength: 1, family: 'wan22' }], textOnly: false })).toBe('minimax_h3');
  });

  it('ignores H3 files when ComfyUI has no H3 nodes', async () => {
    expect(await pickVideoModel(fakeComfy([...WAN, ...H3_FILES], { h3: false }), { loras: [], textOnly: false })).toBe('wan');
  });

  it('uses LTX-2.5 once it is installed', async () => {
    expect(await pickVideoModel(fakeComfy([...WAN, ...LTX_FILES]), { loras: [], textOnly: true })).toBe('ltx_2_5');
    expect(await pickVideoModel(fakeComfy(LTX_FILES), { loras: [], textOnly: false })).toBe('ltx_2_5');
  });

  it('prefers LTX-2.5 when both opt-in models are installed (the studio default template)', async () => {
    expect(await pickVideoModel(fakeComfy([...H3_FILES, ...LTX_FILES]), { loras: [], textOnly: false })).toBe('ltx_2_5');
  });

  it("honours a shot's model choice when that model is installed, else falls back", async () => {
    const both = fakeComfy([...H3_FILES, ...LTX_FILES]);
    expect(await pickVideoModel(both, { loras: [], textOnly: false, prefer: 'ltx_2_5' })).toBe('ltx_2_5');
    expect(await pickVideoModel(both, { loras: [], textOnly: false, prefer: 'minimax_h3' })).toBe('minimax_h3');
    expect(await pickVideoModel(both, { loras: [], textOnly: false, prefer: 'wan' })).toBe('ltx_2_5');
    expect(await pickVideoModel(fakeComfy(WAN), { loras: [], textOnly: false, prefer: 'ltx_2_5' })).toBe('wan');
  });

  it('falls back from LTX to Wan for requests with Wan LoRAs', async () => {
    const loras = [{ filename: 'x.safetensors', strength: 1, family: 'wan22' as const }];
    expect(await pickVideoModel(fakeComfy([...WAN, ...LTX_FILES]), { loras, textOnly: false })).toBe('wan');
    expect(await pickVideoModel(fakeComfy([...WAN, ...LTX_FILES]), { loras: [{ ...loras[0], family: 'ltx2' }], textOnly: false })).toBe('ltx_2_5');
  });

  it('ignores LTX files when ComfyUI has no LTX nodes, or the upscaler is missing', async () => {
    expect(await pickVideoModel(fakeComfy([...WAN, ...LTX_FILES], { ltx: false }), { loras: [], textOnly: false })).toBe('wan');
    expect(await pickVideoModel(fakeComfy([...WAN, ...LTX_FILES.slice(0, -1)]), { loras: [], textOnly: false })).toBe('wan');
  });

  it('returns null when no video model is installed', async () => {
    expect(await pickVideoModel(fakeComfy(ENGINE_FILES.zimage), { loras: [], textOnly: false })).toBeNull();
  });
});

describe('H3 geometry', () => {
  it('snaps durations onto the 17k+5 frame grid at 24 fps', () => {
    expect(h3FramesForDuration(5)).toBe(124);
    expect(h3FramesForDuration(2)).toBe(56);
    for (const s of [2, 3, 4, 5, 6, 7]) {
      const n = h3FramesForDuration(s);
      expect(n % 17).toBe(5);
      expect(n).toBeGreaterThanOrEqual(s * 24);
    }
  });

  it('rounds video sizes to the 32 px grid', () => {
    expect(gridSize('fast', '16:9', 32)).toEqual({ width: 832, height: 480 });
    expect(gridSize('hd', '16:9', 32)).toEqual({ width: 1280, height: 736 });
    for (const q of ['fast', 'hd'] as const)
      for (const a of ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const) {
        const { width, height } = gridSize(q, a, 32);
        expect(width % 32).toBe(0);
        expect(height % 32).toBe(0);
      }
  });
});

describe('LTX-2.5 geometry', () => {
  it('uses 24 fps on the 8k+1 frame grid', () => {
    expect(ltxFramesForDuration(5)).toBe(121);
    for (const s of [4, 5, 6, 8, 10]) {
      const n = ltxFramesForDuration(s);
      expect((n - 1) % 8).toBe(0);
      expect(n).toBe(s * 24 + 1);
    }
  });

  it('renders on a 64 px grid so the half-size first pass stays on the 32 px latent grid', () => {
    expect(gridSize('hd', '16:9', 64)).toEqual({ width: 1280, height: 704 });
    const req = { prompt: 'x', negativePrompt: 'n', aspect: '16:9' as const, quality: 'fast' as const, durationSec: 5, seed: 1, loras: [] };
    const wf = Object.values(buildClipWorkflow('ltx_2_5', req, true).workflow);
    const empty = wf.find((n) => n.class_type === 'EmptyLTXVLatentVideo')!;
    expect(empty.inputs).toMatchObject({ width: 416, height: 256, length: 121 });
  });
});

describe('clip lengths per video model', () => {
  it('offers 2–7 s for Wan, 4–15 s for MiniMax H3 and 4–10 s for LTX-2.5', () => {
    expect(durationsFor('ltx_2_5')).toEqual([4, 5, 6, 8, 10]);
    expect(durationsFor('wan')).toEqual([2, 3, 4, 5, 6, 7]);
    expect(durationsFor(null)).toEqual(durationsFor('wan'));
    expect(durationsFor('minimax_h3')[0]).toBe(4);
    expect(durationsFor('minimax_h3').at(-1)).toBe(15);
  });

  it('limits MiniMax HD to 10 s unless the GPU has 30 GB or more', () => {
    expect(durationsFor('minimax_h3', { quality: 'hd', vramTotalMB: 24_564 }).at(-1)).toBe(10);
    expect(durationsFor('minimax_h3', { quality: 'hd' }).at(-1)).toBe(10);
    expect(durationsFor('minimax_h3', { quality: 'hd', vramTotalMB: 32_607 }).at(-1)).toBe(15);
    expect(durationsFor('minimax_h3', { quality: 'fast', vramTotalMB: 24_564 }).at(-1)).toBe(15);
  });

  it('flags HD reference renders that will not fit the GPU', async () => {
    const { refVideoHdFit } = await import('../../shared/presets');
    expect(refVideoHdFit(11, 32_607)).toContain('90 GB');
    expect(refVideoHdFit(11, 48_512)).toContain('90 GB');
    expect(refVideoHdFit(5, 32_607)).toBeUndefined();
    expect(refVideoHdFit(11, 97_000)).toBeUndefined();
    expect(refVideoHdFit(11, undefined)).toBeUndefined();
    expect(nearestDuration(15, 'minimax_h3', { quality: 'hd' })).toBe(10);
  });

  it('offers LTX-2.5 HD up to 10 s on a 24 GB card (measured on a 4090)', () => {
    expect(durationsFor('ltx_2_5', { quality: 'hd', vramTotalMB: 24_564 }).at(-1)).toBe(10);
    expect(durationsFor('ltx_2_5', { quality: 'fast' }).at(-1)).toBe(10);
  });

  it('clamps and snaps stored durations from the other model', () => {
    expect(clampDuration(12, 'wan')).toBe(7);
    expect(clampDuration(2, 'minimax_h3')).toBe(4);
    expect(clampDuration(9, 'minimax_h3')).toBe(9);
    expect(nearestDuration(7, 'minimax_h3')).toBe(6);
    expect(nearestDuration(15, 'wan')).toBe(7);
  });

  it('renders each model inside its range', () => {
    const req = { prompt: 'x', negativePrompt: 'n', aspect: '16:9' as const, quality: 'fast' as const, seed: 1, loras: [] };
    const frames = (model: 'wan' | 'minimax_h3', durationSec: number) => {
      const wf = buildClipWorkflow(model, { ...req, durationSec }, true).workflow;
      return Object.values(wf).map((n) => n.inputs.length).find((l) => typeof l === 'number');
    };
    expect(frames('minimax_h3', 2)).toBe(h3FramesForDuration(4));
    expect(frames('minimax_h3', 15)).toBe(h3FramesForDuration(15));
    expect(frames('wan', 15)).toBe(frames('wan', 7));
    const hd = (vramTotalMB?: number) =>
      Object.values(buildClipWorkflow('minimax_h3', { ...req, quality: 'hd', durationSec: 15, vramTotalMB }, true).workflow)
        .map((n) => n.inputs.length)
        .find((l) => typeof l === 'number');
    expect(hd()).toBe(h3FramesForDuration(10));
    expect(hd(32_607)).toBe(h3FramesForDuration(15));
  });
});

describe('resolveVideoModel', () => {
  const none: FileAvailability = {
    zimage: false,
    qwen_edit: false,
    qwen_angle: false,
    wan_i2v: false,
    wan_t2v: false,
    wan_animate: false,
    wan_control: false,
    wan_vace: false,
    h3_ref: false,
    ltx_ic: false,
    upscale_4k: false,
    minimax_h3: false,
    ltx_2_5: false,
  };
  const group = (id: ModelGroupStatus['id'], enabled: boolean): ModelGroupStatus => ({ id, label: id, ready: false, enabled, downloadedBytes: 0, totalBytes: 1 });

  it('reports MiniMax H3 while it is still downloading', () => {
    expect(resolveVideoModel(none, [group('minimax', true), group('video', false)])).toBe('minimax_h3');
    expect(resolveVideoModel(none, [group('video', true)])).toBe('wan');
    expect(resolveVideoModel(none, [])).toBeNull();
  });

  it('prefers installed files over the plan', () => {
    expect(resolveVideoModel({ ...none, wan_i2v: true }, [group('minimax', true)])).toBe('wan');
    expect(resolveVideoModel({ ...none, wan_i2v: true, minimax_h3: true }, [])).toBe('minimax_h3');
  });

  it('reports LTX-2.5 when installed or planned, before H3 (the studio default template)', () => {
    expect(resolveVideoModel({ ...none, wan_i2v: true, ltx_2_5: true }, [])).toBe('ltx_2_5');
    expect(resolveVideoModel({ ...none, minimax_h3: true, ltx_2_5: true }, [])).toBe('ltx_2_5');
    expect(resolveVideoModel(none, [group('ltx', true), group('video', false)])).toBe('ltx_2_5');
    expect(resolveVideoModel(none, [group('minimax', true), group('ltx', true)])).toBe('ltx_2_5');
  });
});

describe('buildWanVace', () => {
  const base = { prompt: 'x', negativePrompt: 'y', width: 832, height: 480, length: 81, fps: 16, seed: 1, controlVideo: 'ctl.mp4' };

  it('wires WanVaceToVideo with a reference image and trims its latent before decode', () => {
    const nodes = Object.values(buildWanVace({ ...base, refImage: 'ref.png' }));
    const vace = nodes.find((n) => n.class_type === 'WanVaceToVideo');
    expect(vace?.inputs.reference_image).toBeDefined();
    expect(nodes.some((n) => n.class_type === 'TrimVideoLatent')).toBe(true);
    expect(nodes.some((n) => n.class_type === 'Canny')).toBe(true); // default preprocess
  });

  it('skips Canny with preprocess "none", and skips the trim without a reference image', () => {
    const nodes = Object.values(buildWanVace({ ...base, preprocess: 'none' }));
    expect(nodes.some((n) => n.class_type === 'Canny')).toBe(false);
    expect(nodes.some((n) => n.class_type === 'TrimVideoLatent')).toBe(false);
    const vace = nodes.find((n) => n.class_type === 'WanVaceToVideo');
    expect(vace?.inputs.reference_image).toBeUndefined();
  });

  it('uses the VACE-Fun 14B checkpoints, not the I2V or Fun-Control ones', () => {
    const unetNames = Object.values(buildWanVace(base))
      .filter((n) => n.class_type === 'UNETLoader')
      .map((n) => n.inputs.unet_name);
    expect(unetNames).toEqual(expect.arrayContaining([MODEL_FILES.vace.high, MODEL_FILES.vace.low]));
    expect(unetNames).not.toEqual(expect.arrayContaining([MODEL_FILES.control.high, MODEL_FILES.wan.i2vHigh]));
  });
});

describe('buildLtxIc', () => {
  const base = { prompt: 'x', width: 832, height: 512, length: 121, seed: 1, controlVideo: 'ctl.mp4' };

  it('loads the IC-LoRA and reads its reference_downscale_factor before guiding the control video', () => {
    const nodes = Object.values(buildLtxIc(base));
    expect(nodes.find((n) => n.class_type === 'LoraLoaderModelOnly')?.inputs.lora_name).toBe(MODEL_FILES.ltx.icLora);
    expect(nodes.some((n) => n.class_type === 'GetICLoRAParameters')).toBe(true);
    const guides = nodes.filter((n) => n.class_type === 'LTXVAddGuide');
    expect(guides).toHaveLength(1); // control video only, no reference image
    expect(guides[0]?.inputs.iclora_parameters).toBeDefined();
    expect(nodes.some((n) => n.class_type === 'Canny')).toBe(true); // default preprocess
  });

  it('adds a second, plain guide (no iclora_parameters) for the optional reference image', () => {
    const guides = Object.values(buildLtxIc({ ...base, refImage: 'ref.png' })).filter((n) => n.class_type === 'LTXVAddGuide');
    expect(guides).toHaveLength(2);
    expect(guides[0]?.inputs.iclora_parameters).toBeUndefined();
    expect(guides[1]?.inputs.iclora_parameters).toBeDefined();
  });

  it('skips Canny with preprocess "none"', () => {
    expect(Object.values(buildLtxIc({ ...base, preprocess: 'none' })).some((n) => n.class_type === 'Canny')).toBe(false);
  });

  it('fast (no twoStage) stays a single full-size pass with no upscaler', () => {
    const nodes = Object.values(buildLtxIc(base));
    expect(nodes.some((n) => n.class_type === 'LatentUpscaleModelLoader')).toBe(false);
    expect(nodes.some((n) => n.class_type === 'LTXVLatentUpsampler')).toBe(false);
    expect(nodes.filter((n) => n.class_type === 'LTXVSeparateAVLatent')).toHaveLength(1);
    expect(nodes.filter((n) => n.class_type === 'LTXVCropGuides')).toHaveLength(1);
    const empty = nodes.find((n) => n.class_type === 'EmptyLTXVLatentVideo');
    expect(empty?.inputs).toMatchObject({ width: base.width, height: base.height });
  });

  it('twoStage (hd) renders stage 1 at half size and adds the official second stage', () => {
    const nodes = Object.values(buildLtxIc({ ...base, width: 1280, height: 768, twoStage: true }));

    const empty = nodes.find((n) => n.class_type === 'EmptyLTXVLatentVideo');
    expect(empty?.inputs).toMatchObject({ width: 640, height: 384 });

    const upscaler = nodes.find((n) => n.class_type === 'LatentUpscaleModelLoader');
    expect(upscaler?.inputs.model_name).toBe(MODEL_FILES.ltx.upscaler);
    expect(nodes.some((n) => n.class_type === 'LTXVLatentUpsampler')).toBe(true);

    // Two full sampler passes, but the guide frames are cropped only once, before the upscale.
    expect(nodes.filter((n) => n.class_type === 'SamplerCustomAdvanced')).toHaveLength(2);
    expect(nodes.filter((n) => n.class_type === 'LTXVSeparateAVLatent')).toHaveLength(2);
    expect(nodes.filter((n) => n.class_type === 'LTXVCropGuides')).toHaveLength(1);

    // Stage 2 uses the official sigmas and sampler, distinct from stage 1's.
    const sigmasNodes = nodes.filter((n) => n.class_type === 'ManualSigmas').map((n) => n.inputs.sigmas);
    expect(sigmasNodes).toEqual(expect.arrayContaining(['0.909375, 0.725, 0.421875, 0.0']));
    const ksamplerSelects = nodes.filter((n) => n.class_type === 'KSamplerSelect');
    expect(ksamplerSelects).toHaveLength(1);
    expect(ksamplerSelects[0]?.inputs.sampler_name).toBe('euler');
    expect(nodes.some((n) => n.class_type === 'SamplerEulerAncestral')).toBe(true); // stage 1 keeps its sampler

    // Stage 2's fixed noise seed matches the official workflow.
    const randomNoises = nodes.filter((n) => n.class_type === 'RandomNoise').map((n) => n.inputs.noise_seed);
    expect(randomNoises).toEqual(expect.arrayContaining([42]));
  });

  it('twoStage re-applies the reference image after the upscale, and only then', () => {
    const withRef = Object.values(buildLtxIc({ ...base, width: 1280, height: 768, twoStage: true, refImage: 'ref.png' }));
    const imgToVideo = withRef.filter((n) => n.class_type === 'LTXVImgToVideoInplace');
    expect(imgToVideo).toHaveLength(1);
    expect(imgToVideo[0]?.inputs).toMatchObject({ strength: 1, bypass: false });

    const withoutRef = Object.values(buildLtxIc({ ...base, width: 1280, height: 768, twoStage: true }));
    expect(withoutRef.some((n) => n.class_type === 'LTXVImgToVideoInplace')).toBe(false);
  });

  it('twoStage concats the upscaled video latent with the uncropped, unscaled stage-1 audio latent', () => {
    const nodes = buildLtxIc({ ...base, width: 1280, height: 768, twoStage: true });
    const upscaler = Object.entries(nodes).find(([, n]) => n.class_type === 'LTXVLatentUpsampler')?.[0];
    const separates = Object.entries(nodes).filter(([, n]) => n.class_type === 'LTXVSeparateAVLatent');
    const concats = Object.entries(nodes).filter(([, n]) => n.class_type === 'LTXVConcatAVLatent');
    expect(upscaler).toBeDefined();
    expect(separates).toHaveLength(2);
    expect(concats).toHaveLength(2);
    // The second concat's audio_latent comes straight from the first (stage-1) split, never through the upscaler.
    const [firstSplitId] = separates[0]!;
    const stage2Concat = concats[1]![1];
    expect(stage2Concat.inputs.audio_latent).toEqual([firstSplitId, 1]);
  });

  it('never JPEG-compresses the control frames or the reference image (unlike buildLtx25)', () => {
    const nodes = Object.values(buildLtxIc({ ...base, refImage: 'ref.png' }));
    expect(nodes.some((n) => n.class_type === 'LTXVPreprocess')).toBe(false);
  });

  it('applies controlStrength to the union-control IC-LoRA loader, defaulting to 1', () => {
    const loraName = (r: ReturnType<typeof buildLtxIc>) => Object.values(r).find((n) => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === MODEL_FILES.ltx.icLora);
    expect(loraName(buildLtxIc(base))?.inputs.strength_model).toBe(1);
    expect(loraName(buildLtxIc({ ...base, controlStrength: 0.6 }))?.inputs.strength_model).toBe(0.6);
  });
});

describe('ltxKeyframeFrameIdx', () => {
  it('snaps onto the 8n+1 grid, rounding down (LTXVAddGuide get_latent_index)', () => {
    expect(ltxKeyframeFrameIdx(0, 121)).toEqual({ frameIdx: 0, isEnd: false });
    expect(ltxKeyframeFrameIdx(2, 121)).toEqual({ frameIdx: 41, isEnd: false }); // 2*24=48 -> floor((48-1)/8)*8+1=41
  });

  it('treats a keyframe at or past the clip duration as an end frame', () => {
    expect(ltxKeyframeFrameIdx(5, 121)).toEqual({ frameIdx: -1, isEnd: true }); // 5*24=120 >= 121-1
    expect(ltxKeyframeFrameIdx(100, 121)).toEqual({ frameIdx: -1, isEnd: true });
  });

  it('never returns an index at or beyond the last frame for a non-end keyframe', () => {
    for (let t = 0; t <= 4; t += 0.25) {
      const { frameIdx, isEnd } = ltxKeyframeFrameIdx(t, 121);
      if (!isEnd) {
        expect(frameIdx).toBeLessThan(120);
        expect(frameIdx === 0 || (frameIdx - 1) % 8 === 0).toBe(true);
      }
    }
  });
});

describe('buildLtxIc keyframes and end frame', () => {
  const base = { prompt: 'x', width: 832, height: 512, length: 121, seed: 1, controlVideo: 'ctl.mp4' };

  it('chains one LTXVAddGuide per keyframe, defaulting strength to 0.7', () => {
    const nodes = Object.values(buildLtxIc({ ...base, keyframes: [{ image: 'k1.png', timeSec: 1 }, { image: 'k2.png', timeSec: 2, strength: 0.5 }] }));
    const guides = nodes.filter((n) => n.class_type === 'LTXVAddGuide');
    // control guide + 2 keyframe guides
    expect(guides).toHaveLength(3);
    const strengths = guides.slice(1).map((n) => n.inputs.strength);
    expect(strengths).toEqual([0.7, 0.5]);
  });

  it('extends the clip by 8 frames and trims them back off when a keyframe is an end frame', () => {
    const nodes = buildLtxIc({ ...base, keyframes: [{ image: 'end.png', timeSec: 5 }] });
    const list = Object.values(nodes);
    const empty = list.find((n) => n.class_type === 'EmptyLTXVLatentVideo')!;
    expect(empty.inputs.length).toBe(129); // 121 + 8
    const audio = list.find((n) => n.class_type === 'LTXVEmptyLatentAudio')!;
    expect(audio.inputs.frames_number).toBe(129);
    const guide = list.find((n) => n.class_type === 'LTXVAddGuide' && n.inputs.strength === 0.7)!;
    expect(guide.inputs.frame_idx).toBe(-1);
    const trim = list.find((n) => n.class_type === 'ImageFromBatch')!;
    expect(trim.inputs.length).toBe(121);
    expect(trim.inputs.batch_index).toBe(0);
  });

  it('does not extend or trim when no keyframe reaches the end of the clip', () => {
    const nodes = Object.values(buildLtxIc({ ...base, keyframes: [{ image: 'mid.png', timeSec: 1 }] }));
    expect(nodes.find((n) => n.class_type === 'EmptyLTXVLatentVideo')!.inputs.length).toBe(121);
    expect(nodes.some((n) => n.class_type === 'ImageFromBatch')).toBe(false);
  });

  it('twoStage re-applies each keyframe on the upscaled latent and crops those guides before decode', () => {
    const nodes = Object.values(buildLtxIc({ ...base, width: 1280, height: 768, twoStage: true, keyframes: [{ image: 'k1.png', timeSec: 1 }] }));
    expect(nodes.filter((n) => n.class_type === 'LTXVCropGuides')).toHaveLength(2); // stage 1 (control) + stage 2 (keyframe)
    const stage2Guide = nodes.filter((n) => n.class_type === 'LTXVAddGuide').at(-1)!;
    expect(stage2Guide.inputs.strength).toBe(1); // reapplied at full strength in stage 2
  });
});

describe('buildLtxIc reference sheet (Ingredients)', () => {
  const base = { prompt: 'Reference sheet: a cat. Generated video: the cat walks.', width: 832, height: 512, length: 121, seed: 1 };

  it('sheet only: loads the Ingredients LoRA and reads its own metadata, no control video needed', () => {
    const nodes = Object.values(buildLtxIc({ ...base, referenceSheetVideo: 'sheet.mp4' }));
    const loras = nodes.filter((n) => n.class_type === 'LoraLoaderModelOnly').map((n) => n.inputs.lora_name);
    expect(loras).toEqual([MODEL_FILES.ltx.icLoraIngredients]);
    expect(nodes.filter((n) => n.class_type === 'GetICLoRAParameters')).toHaveLength(1);
    const guides = nodes.filter((n) => n.class_type === 'LTXVAddGuide');
    expect(guides).toHaveLength(1);
    expect(guides[0]?.inputs.iclora_parameters).toBeDefined();
    expect(guides[0]?.inputs.frame_idx).toBe(0);
    expect(nodes.some((n) => n.class_type === 'LoadVideo')).toBe(true);
    expect(LTX_INGREDIENTS_FILES).toContain(MODEL_FILES.ltx.icLoraIngredients);
  });

  it('sheet + control (experimental): two LoRAs, two GetICLoRAParameters, two guides each with its own iclora_parameters', () => {
    const nodes = Object.values(buildLtxIc({ ...base, controlVideo: 'ctl.mp4', referenceSheetVideo: 'sheet.mp4' }));
    const loras = nodes.filter((n) => n.class_type === 'LoraLoaderModelOnly').map((n) => n.inputs.lora_name);
    expect(loras).toEqual([MODEL_FILES.ltx.icLora, MODEL_FILES.ltx.icLoraIngredients]);
    expect(nodes.filter((n) => n.class_type === 'GetICLoRAParameters')).toHaveLength(2);
    const guides = nodes.filter((n) => n.class_type === 'LTXVAddGuide');
    expect(guides).toHaveLength(2);
    expect(guides.every((g) => g.inputs.iclora_parameters !== undefined)).toBe(true);
    expect(new Set(guides.map((g) => JSON.stringify(g.inputs.iclora_parameters))).size).toBe(2); // distinct params
  });

  it('the Ingredients LoRA loads at strength 1.3 (the official workflow instance, not its 1.0 node default)', () => {
    const nodes = Object.values(buildLtxIc({ ...base, referenceSheetVideo: 'sheet.mp4' }));
    const ingredientsLora = nodes.find((n) => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === MODEL_FILES.ltx.icLoraIngredients);
    expect(ingredientsLora?.inputs.strength_model).toBe(1.3);
  });
});

describe('gridSize for two-stage IC control', () => {
  it('128 grid keeps the half-size stage-1 latent even (factor 2)', () => {
    const s = gridSize('hd', '16:9', 128);
    expect(s.width % 128).toBe(0);
    expect(s.height % 128).toBe(0);
    expect(((s.height / 2) / 32) % 2).toBe(0);
  });
});

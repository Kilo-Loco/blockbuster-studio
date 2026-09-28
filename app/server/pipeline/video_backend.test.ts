import { describe, expect, it } from 'vitest';
import { ENGINE_FILES, H3_FILES, LTX_FILES, h3FramesForDuration, ltxFramesForDuration } from '../comfy/workflows';
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

  it('prefers H3 when both opt-in models are installed', async () => {
    expect(await pickVideoModel(fakeComfy([...H3_FILES, ...LTX_FILES]), { loras: [], textOnly: false })).toBe('minimax_h3');
  });

  it("honours a shot's model choice when that model is installed, else falls back", async () => {
    const both = fakeComfy([...H3_FILES, ...LTX_FILES]);
    expect(await pickVideoModel(both, { loras: [], textOnly: false, prefer: 'ltx_2_5' })).toBe('ltx_2_5');
    expect(await pickVideoModel(both, { loras: [], textOnly: false, prefer: 'minimax_h3' })).toBe('minimax_h3');
    expect(await pickVideoModel(both, { loras: [], textOnly: false, prefer: 'wan' })).toBe('minimax_h3');
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
    h3_ref: false,
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

  it('reports LTX-2.5 when installed or planned, after H3', () => {
    expect(resolveVideoModel({ ...none, wan_i2v: true, ltx_2_5: true }, [])).toBe('ltx_2_5');
    expect(resolveVideoModel({ ...none, minimax_h3: true, ltx_2_5: true }, [])).toBe('minimax_h3');
    expect(resolveVideoModel(none, [group('ltx', true), group('video', false)])).toBe('ltx_2_5');
    expect(resolveVideoModel(none, [group('minimax', true), group('ltx', true)])).toBe('minimax_h3');
  });
});

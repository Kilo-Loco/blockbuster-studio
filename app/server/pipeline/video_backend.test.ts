import { describe, expect, it } from 'vitest';
import { ENGINE_FILES, H3_FILES, h3FramesForDuration } from '../comfy/workflows';
import type { ComfyClient } from '../comfy/client';
import { buildClipWorkflow, h3Size, pickVideoModel } from './video_backend';
import { clampDuration, durationsFor, nearestDuration } from '../../shared/presets';
import { resolveVideoModel, type FileAvailability } from '../system';
import type { ModelGroupStatus } from '../../shared/types';

/** A ComfyUI whose loader dropdowns list exactly `files` (plus the H3 node when `h3Node`). */
function fakeComfy(files: readonly string[], h3Node = true): ComfyClient {
  const list = [[...files]];
  return {
    objectInfo: async () => ({
      UNETLoader: { input: { required: { unet_name: list } } },
      CLIPLoader: { input: { required: { clip_name: list } } },
      VAELoader: { input: { required: { vae_name: list } } },
      LoraLoaderModelOnly: { input: { required: { lora_name: list } } },
      CLIPVisionLoader: { input: { required: { clip_name: list } } },
      ...(h3Node ? { MiniMaxH3ImageToVideo: { input: { required: {} } } } : {}),
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
    expect(await pickVideoModel(fakeComfy([...WAN, ...H3_FILES], false), { loras: [], textOnly: false })).toBe('wan');
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
    expect(h3Size('fast', '16:9')).toEqual({ width: 832, height: 480 });
    expect(h3Size('hd', '16:9')).toEqual({ width: 1280, height: 736 });
    for (const q of ['fast', 'hd'] as const)
      for (const a of ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const) {
        const { width, height } = h3Size(q, a);
        expect(width % 32).toBe(0);
        expect(height % 32).toBe(0);
      }
  });
});

describe('clip lengths per video model', () => {
  it('offers 2–7 s for Wan and 4–15 s for MiniMax H3', () => {
    expect(durationsFor('wan')).toEqual([2, 3, 4, 5, 6, 7]);
    expect(durationsFor(null)).toEqual(durationsFor('wan'));
    expect(durationsFor('minimax_h3')[0]).toBe(4);
    expect(durationsFor('minimax_h3').at(-1)).toBe(15);
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
  });
});

describe('resolveVideoModel', () => {
  const none: FileAvailability = { zimage: false, qwen_edit: false, qwen_angle: false, wan_i2v: false, wan_t2v: false, wan_animate: false, minimax_h3: false };
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
});

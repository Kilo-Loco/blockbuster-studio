import { describe, expect, it } from 'vitest';
import { ENGINE_FILES, H3_FILES, h3FramesForDuration } from '../comfy/workflows';
import type { ComfyClient } from '../comfy/client';
import { h3Size, pickVideoModel } from './video_backend';

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
    expect(await pickVideoModel(fakeComfy(WAN), { hasLoras: false, textOnly: false })).toBe('wan');
  });

  it('prefers H3 once it is installed', async () => {
    expect(await pickVideoModel(fakeComfy([...WAN, ...H3_FILES]), { hasLoras: false, textOnly: true })).toBe('minimax_h3');
  });

  it('falls back to Wan for requests with Wan LoRAs', async () => {
    expect(await pickVideoModel(fakeComfy([...WAN, ...H3_FILES]), { hasLoras: true, textOnly: false })).toBe('wan');
  });

  it('still uses H3 with LoRAs when Wan is not installed (LoRAs are skipped)', async () => {
    expect(await pickVideoModel(fakeComfy(H3_FILES), { hasLoras: true, textOnly: false })).toBe('minimax_h3');
  });

  it('ignores H3 files when ComfyUI has no H3 nodes', async () => {
    expect(await pickVideoModel(fakeComfy([...WAN, ...H3_FILES], false), { hasLoras: false, textOnly: false })).toBe('wan');
  });

  it('returns null when no video model is installed', async () => {
    expect(await pickVideoModel(fakeComfy(ENGINE_FILES.zimage), { hasLoras: false, textOnly: false })).toBeNull();
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

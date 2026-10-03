import { afterEach, describe, expect, it } from 'vitest';
import { ComfyClient } from './client';

// Nothing listens on this port: the client only needs to exist; waits that aren't aborted never settle.
const clients: ComfyClient[] = [];
const client = () => {
  const c = new ComfyClient('http://127.0.0.1:9');
  clients.push(c);
  return c;
};
afterEach(() => clients.splice(0).forEach((c) => c.close()));

describe('ComfyClient cancel', () => {
  it('rejects a wait that is already in progress', async () => {
    const c = client();
    const wait = c.waitFor('p1', {});
    c.abortWaiters();
    await expect(wait).rejects.toThrow('canceled');
  });

  it('rejects a wait that starts after the cancel (job canceled while still queueing its prompt)', async () => {
    const c = client();
    c.abortWaiters();
    await expect(c.waitFor('p2', {})).rejects.toThrow('canceled');
    await expect(c.waitFor('p3', {})).rejects.toThrow('canceled');
  });

  it('forgets the cancel once the next job starts', async () => {
    const c = client();
    c.abortWaiters();
    c.resetAbort();
    const wait = c.waitFor('p4', {}).then(() => 'settled', () => 'settled');
    const state = await Promise.race([wait, new Promise((r) => setTimeout(() => r('waiting'), 100))]);
    expect(state).toBe('waiting');
    c.abortWaiters(); // settle it so its history poll stops
    await wait;
  });
});

describe('ComfyClient freeAndWait', () => {
  it('waits until ComfyUI has actually released the memory', async () => {
    const c = client();
    let calls = 0;
    const free = [2_000, 2_000, 15_000];
    (c as any).free = async () => undefined;
    (c as any).systemStats = async () => ({ online: true, queueRemaining: 0, vramFreeMB: free[Math.min(calls++, 2)] });
    expect(await c.freeAndWait(10_000, 5_000, 1)).toBe(true);
    expect(calls).toBe(3);
  });

  it('gives up after the timeout', async () => {
    const c = client();
    (c as any).free = async () => undefined;
    (c as any).systemStats = async () => ({ online: true, queueRemaining: 0, vramFreeMB: 1_000 });
    expect(await c.freeAndWait(10_000, 20, 5)).toBe(false);
  });
});

describe('ComfyClient loadingModels', () => {
  it('is true while loaders, text encoders and a not-yet-stepping sampler run, false once sampling starts', async () => {
    const c = client();
    const workflow = {
      '1': { class_type: 'UNETLoader', inputs: {} },
      '2': { class_type: 'ModelSamplingAuraFlow', inputs: {} },
      '3': { class_type: 'CLIPTextEncode', inputs: {} },
      '4': { class_type: 'KSampler', inputs: {} },
      '5': { class_type: 'VAEDecode', inputs: {} },
    };
    const send = (type: string, data: object) => (c as any).handleMessage({ type, data: { prompt_id: 'p', ...data } });
    const stages: boolean[] = [];
    const wait = c.waitFor('p', workflow, () => stages.push(c.loadingModels));
    expect(c.loadingModels).toBe(false);
    send('executing', { node: '1' });
    send('executing', { node: '2' }); // a quick patch node before the first step keeps the loading state
    send('executing', { node: '3' });
    send('executing', { node: '4' });
    send('progress', { node: '4', value: 0, max: 8 }); // not a step yet
    send('progress', { node: '4', value: 1, max: 8 });
    send('executing', { node: '5' });
    // The flag is already set when the runner's progress callback reads it.
    expect(stages).toEqual([true, true, true, true, true, false, false]);
    send('executing', { node: null });
    await wait;
    expect(c.loadingModels).toBe(false);
  });

  it('replays the first node when ComfyUI starts the prompt before waitFor is called', async () => {
    const c = client();
    const workflow = { '1': { class_type: 'UNETLoader', inputs: {} }, '2': { class_type: 'KSampler', inputs: {} } };
    (c as any).handleMessage({ type: 'executing', data: { prompt_id: 'q', node: '1' } });
    const seen: boolean[] = [];
    const wait = c.waitFor('q', workflow, () => seen.push(c.loadingModels));
    expect(seen).toEqual([true]);
    (c as any).handleMessage({ type: 'executing', data: { prompt_id: 'q', node: null } });
    await wait;
  });

  it('resolves a prompt that finished before waitFor was called', async () => {
    const c = client();
    (c as any).handleMessage({ type: 'executing', data: { prompt_id: 'r', node: '1' } });
    (c as any).handleMessage({ type: 'executing', data: { prompt_id: 'r', node: null } });
    await expect(c.waitFor('r', { '1': { class_type: 'SaveImage', inputs: {} } })).resolves.toBeUndefined();
  });
});

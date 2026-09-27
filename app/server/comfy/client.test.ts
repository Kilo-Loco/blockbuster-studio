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

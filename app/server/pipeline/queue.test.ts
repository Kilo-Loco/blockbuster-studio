import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Isolate this test's SQLite DB from other test files / the real dev .data dir.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-queue-test-'));
process.env.DATA_DIR = tmpDir;

const { registerRunner, enqueue, cancel, init } = await import('./queue');
const { jobs: jobsRepo } = await import('../db');

class FakeComfy {
  interrupt = vi.fn(async () => undefined);
}

describe('queue', () => {
  beforeEach(() => {
    init(new FakeComfy() as never);
  });

  it('runs jobs FIFO and marks them done', async () => {
    const order: string[] = [];
    let resolveFirst: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => (resolveFirst = resolve));

    registerRunner('generate', async (job, ctx) => {
      order.push(job.id);
      ctx.setProgress(0.5, 'working');
      if (order.length === 1) {
        resolveFirst();
        await new Promise((r) => setTimeout(r, 30));
      }
    });

    const j1 = enqueue({ type: 'generate', title: 'first', params: {} });
    const j2 = enqueue({ type: 'generate', title: 'second', params: {} });
    expect(j2.queuePosition).toBeGreaterThanOrEqual(1);

    await firstStarted;
    // While job 1 is running, job 2 should still be queued.
    expect(jobsRepo.get(j2.id)?.status).toBe('queued');

    await vi.waitFor(() => {
      expect(jobsRepo.get(j1.id)?.status).toBe('done');
      expect(jobsRepo.get(j2.id)?.status).toBe('done');
    }, { timeout: 2000 });

    expect(order).toEqual([j1.id, j2.id]);
  });

  it('marks a job errored when the runner throws', async () => {
    registerRunner('lora_download', async () => {
      throw new Error('boom');
    });
    const job = enqueue({ type: 'lora_download', title: 'will fail', params: {} });
    await vi.waitFor(() => {
      expect(jobsRepo.get(job.id)?.status).toBe('error');
    });
    expect(jobsRepo.get(job.id)?.error).toBe('boom');
  });

  it('cancels a queued job immediately', async () => {
    registerRunner('lora_train', async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    const blocker = enqueue({ type: 'lora_train', title: 'blocker', params: {} });
    const queued = enqueue({ type: 'lora_train', title: 'queued', params: {} });
    expect(jobsRepo.get(queued.id)?.status).toBe('queued');
    const canceled = cancel(queued.id);
    expect(canceled?.status).toBe('canceled');
    expect(jobsRepo.get(queued.id)?.status).toBe('canceled');
    // Clean up: cancel the blocker too so it doesn't leak into other tests.
    cancel(blocker.id);
  });

  it('interrupts comfy and marks a running job canceled', async () => {
    let releaseRunner: () => void = () => {};
    const comfy = new FakeComfy();
    init(comfy as never);
    registerRunner('character_refs', async (job, ctx) => {
      await new Promise<void>((resolve) => {
        releaseRunner = () => resolve();
      });
      if (ctx.isCanceled()) throw new Error('canceled');
    });
    const job = enqueue({ type: 'character_refs', title: 'running', params: {} });
    await vi.waitFor(() => expect(jobsRepo.get(job.id)?.status).toBe('running'));
    cancel(job.id);
    expect(comfy.interrupt).toHaveBeenCalled();
    releaseRunner();
    await vi.waitFor(() => expect(jobsRepo.get(job.id)?.status).toBe('canceled'));
  });
});

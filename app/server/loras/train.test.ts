import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-train-test-'));
const { parseTrainingStep } = await import('./train');

describe('parseTrainingStep', () => {
  it('reads the training step from ai-toolkit progress lines', () => {
    expect(parseTrainingStep('mara:   9%|▉         | 136/1500 [05:02<50:37,  2.23s/it, lr: 1.0e-04 loss: 3.412e-01]', 1500)).toEqual({ current: 136, total: 1500 });
  });
  it('ignores the other progress bars ai-toolkit prints (model shards, latent caching)', () => {
    expect(parseTrainingStep('Loading checkpoint shards: 100%|██████████| 3/3 [00:04<00:00,  1.5s/it]', 1500)).toBeUndefined();
    expect(parseTrainingStep('Caching latents: 40%|████      | 12/30 [00:03<00:04]', 1500)).toBeUndefined();
    expect(parseTrainingStep('no numbers here', 1500)).toBeUndefined();
  });
});

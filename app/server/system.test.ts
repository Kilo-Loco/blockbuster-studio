import { describe, expect, it } from 'vitest';
import { computeEngineState, computeStorageInfo, computeStorageWarning, isWorkspaceOnRootDevice, remainingDownloadBytes } from './system';
import type { EngineId, ModelGroupStatus } from '../shared/types';

const none: Record<EngineId, boolean> = {
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
};
const group = (id: ModelGroupStatus['id'], enabled: boolean): ModelGroupStatus => ({ id, label: id, enabled, ready: false, downloadedBytes: 0, totalBytes: 1 });

describe('computeEngineState', () => {
  it('hides engines outside the preset and marks planned ones as downloading', () => {
    // "Perform" preset: image + edit + perform
    const models = [group('image', true), group('video', false), group('edit', true), group('perform', true), group('t2v', false)];
    const s = computeEngineState({ ...none, zimage: true }, models);
    expect(s.zimage).toBe('ready');
    expect(s.qwen_edit).toBe('downloading');
    expect(s.wan_animate).toBe('downloading');
    expect(s.wan_i2v).toBe('off');
    expect(s.wan_t2v).toBe('off');
  });

  it('text-to-video is available via image + video even without the native t2v group', () => {
    const models = [group('image', true), group('video', true), group('t2v', false)];
    expect(computeEngineState({ ...none, zimage: true, wan_i2v: true }, models).wan_t2v).toBe('ready');
    expect(computeEngineState(none, models).wan_t2v).toBe('downloading');
  });

  it('counts the opt-in LTX-2.5 group as planned video in place of the Wan groups it replaces', () => {
    const models = [group('image', true), group('video', false), group('t2v', false), group('ltx', true)];
    const s = computeEngineState({ ...none, zimage: true }, models);
    expect(s.wan_i2v).toBe('downloading');
    expect(s.wan_t2v).toBe('downloading');
  });

  it('treats everything as planned when there is no status file (local dev)', () => {
    expect(computeEngineState(none, []).wan_animate).toBe('downloading');
  });

  it('wan_vace is planned only while its own group is enabled', () => {
    expect(computeEngineState(none, [group('wan_vace', true)]).wan_vace).toBe('downloading');
    expect(computeEngineState(none, [group('wan_vace', false)]).wan_vace).toBe('off');
    expect(computeEngineState({ ...none, wan_vace: true }, [group('wan_vace', true)]).wan_vace).toBe('ready');
  });

  it('ltx_ic needs both the ltx and ltx_ic groups enabled', () => {
    expect(computeEngineState(none, [group('ltx', true), group('ltx_ic', true)]).ltx_ic).toBe('downloading');
    expect(computeEngineState(none, [group('ltx', true), group('ltx_ic', false)]).ltx_ic).toBe('off');
    expect(computeEngineState(none, [group('ltx_ic', true)]).ltx_ic).toBe('off');
    expect(computeEngineState({ ...none, ltx_ic: true }, [group('ltx', true), group('ltx_ic', true)]).ltx_ic).toBe('ready');
  });
});

describe('isWorkspaceOnRootDevice', () => {
  it('is true when /workspace and / share a device (no volume attached)', () => {
    const dev = (n: number) => ({ statSync: (p: string) => ({ dev: p === '/workspace' ? n : n }) });
    expect(isWorkspaceOnRootDevice('/workspace', '/', dev(1))).toBe(true);
  });

  it('is false when /workspace is a separate mount (a real volume)', () => {
    const deps = { statSync: (p: string) => ({ dev: p === '/workspace' ? 2 : 1 }) };
    expect(isWorkspaceOnRootDevice('/workspace', '/', deps)).toBe(false);
  });

  it('treats a missing path as "on root" so the caller still warns', () => {
    const deps = {
      statSync: () => {
        throw new Error('ENOENT');
      },
    };
    expect(isWorkspaceOnRootDevice('/workspace', '/', deps)).toBe(true);
  });
});

describe('remainingDownloadBytes', () => {
  const g = (enabled: boolean, downloadedBytes: number, totalBytes: number): ModelGroupStatus => ({
    id: 'image',
    label: 'image',
    enabled,
    ready: downloadedBytes >= totalBytes,
    downloadedBytes,
    totalBytes,
  });

  it('sums what enabled groups still have left to download', () => {
    expect(remainingDownloadBytes([g(true, 10, 100), g(true, 100, 100), g(false, 0, 50)])).toBe(90);
  });

  it('is zero when nothing is enabled or everything is done', () => {
    expect(remainingDownloadBytes([])).toBe(0);
    expect(remainingDownloadBytes([g(true, 100, 100)])).toBe(0);
  });
});

describe('computeStorageWarning', () => {
  it('flags no-volume regardless of free space', () => {
    expect(computeStorageWarning(false, 500e9, 10e9)).toBe('no-volume');
    expect(computeStorageWarning(false, 0, 0)).toBe('no-volume');
  });

  it('flags low-space when the volume is real but too small for what remains', () => {
    expect(computeStorageWarning(true, 10e9, 50e9)).toBe('low-space');
  });

  it('is clear when the volume has enough room', () => {
    expect(computeStorageWarning(true, 100e9, 50e9)).toBeUndefined();
    expect(computeStorageWarning(true, 5e9, 0)).toBeUndefined();
  });
});

describe('computeStorageInfo', () => {
  it('never warns off Runpod, even on the same device as root', () => {
    const deps = { statSync: () => ({ dev: 1 }) };
    const info = computeStorageInfo({ runningOnRunpod: false, workspacePath: '/workspace', rootPath: '/', freeBytes: 1e9, neededBytes: 100e9, deps });
    expect(info.workspaceIsVolume).toBe(true);
    expect(info.warning).toBeUndefined();
  });

  it('warns no-volume on Runpod when /workspace is the container disk', () => {
    const deps = { statSync: () => ({ dev: 1 }) };
    const info = computeStorageInfo({ runningOnRunpod: true, workspacePath: '/workspace', rootPath: '/', freeBytes: 20e9, neededBytes: 100e9, deps });
    expect(info.workspaceIsVolume).toBe(false);
    expect(info.warning).toBe('no-volume');
    expect(info.freeGb).toBeCloseTo(20);
    expect(info.neededGb).toBeCloseTo(100);
  });

  it('warns low-space on Runpod when the volume is real but undersized', () => {
    const deps = { statSync: (p: string) => ({ dev: p === '/workspace' ? 2 : 1 }) };
    const info = computeStorageInfo({ runningOnRunpod: true, workspacePath: '/workspace', rootPath: '/', freeBytes: 20e9, neededBytes: 100e9, deps });
    expect(info.workspaceIsVolume).toBe(true);
    expect(info.warning).toBe('low-space');
  });

  it('is clear on Runpod with a real, big-enough volume', () => {
    const deps = { statSync: (p: string) => ({ dev: p === '/workspace' ? 2 : 1 }) };
    const info = computeStorageInfo({ runningOnRunpod: true, workspacePath: '/workspace', rootPath: '/', freeBytes: 200e9, neededBytes: 100e9, deps });
    expect(info.workspaceIsVolume).toBe(true);
    expect(info.warning).toBeUndefined();
  });
});

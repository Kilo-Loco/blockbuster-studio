import { describe, expect, it } from 'vitest';
import { computeEngineState } from './system';
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

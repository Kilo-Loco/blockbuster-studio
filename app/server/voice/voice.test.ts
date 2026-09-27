import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { dialogueKey, lineState, needsSpeakerChoice, resolveSpeaker } from '../../shared/dialogue';
import { wavDurationSec } from '../pipeline/media';
import { toneWav } from '../dev/tone';
import type { Character, CharacterVoice, Shot } from '../../shared/types';

const voice = (over: Partial<CharacterVoice> = {}): CharacterVoice => ({
  source: 'designed',
  description: 'gravelly, tired man in his 60s',
  refAssetId: 'ref1',
  refText: 'Well, hello.',
  language: 'English',
  updatedAt: '2026-09-27T00:00:00.000Z',
  ...over,
});
const char = (id: string, v?: CharacterVoice): Character => ({ id, name: id.toUpperCase(), description: '', referenceAssetIds: [], color: '#fff', createdAt: '', updatedAt: '', voice: v });
type LineShot = Pick<Shot, 'dialogue' | 'dialogueSpeakerId' | 'characterIds' | 'dialogueAudioAssetId' | 'dialogueAudioKey'>;
const shot = (over: Partial<LineShot> = {}): LineShot => ({ dialogue: 'Rough night, huh?', characterIds: ['hank'], ...over });

describe('speaker', () => {
  const hank = char('hank', voice());
  const mara = char('mara');
  it('is the only character in the shot, or the chosen one', () => {
    expect(resolveSpeaker(shot(), [hank])?.id).toBe('hank');
    expect(resolveSpeaker(shot({ characterIds: ['hank', 'mara'] }), [hank, mara])).toBeUndefined();
    expect(resolveSpeaker(shot({ characterIds: ['hank', 'mara'], dialogueSpeakerId: 'mara' }), [hank, mara])?.id).toBe('mara');
    expect(resolveSpeaker(shot({ characterIds: [] }), [])).toBeUndefined();
  });

  it('asks for a choice only when a line has several possible speakers', () => {
    expect(needsSpeakerChoice(shot({ characterIds: ['hank', 'mara'] }))).toBe(true);
    expect(needsSpeakerChoice(shot({ characterIds: ['hank', 'mara'], dialogueSpeakerId: 'hank' }))).toBe(false);
    expect(needsSpeakerChoice(shot({ characterIds: ['hank', 'mara'], dialogue: '  ' }))).toBe(false);
    expect(needsSpeakerChoice(shot())).toBe(false);
  });
});

describe('line state', () => {
  const hank = char('hank', voice());
  const key = dialogueKey('Rough night, huh?', 'hank', hank.voice!);

  it('walks from nothing to ready', () => {
    expect(lineState(shot({ dialogue: undefined }), [hank])).toBe('none');
    expect(lineState(shot({ characterIds: ['hank', 'mara'] }), [hank, char('mara')])).toBe('no_speaker');
    expect(lineState(shot(), [char('hank')])).toBe('no_voice');
    expect(lineState(shot(), [hank])).toBe('missing');
    expect(lineState(shot({ dialogueAudioAssetId: 'a1', dialogueAudioKey: key }), [hank])).toBe('ready');
  });

  it('goes stale when the words, the speaker or the voice change', () => {
    const rendered = { dialogueAudioAssetId: 'a1', dialogueAudioKey: key };
    expect(lineState(shot({ ...rendered, dialogue: 'Long night, huh?' }), [hank])).toBe('stale');
    expect(lineState(shot(rendered), [char('hank', voice({ updatedAt: '2026-09-28T00:00:00.000Z' }))])).toBe('stale');
    expect(lineState(shot(rendered), [char('hank', voice({ refAssetId: 'ref2' }))])).toBe('stale');
    // Surrounding whitespace isn't a different line.
    expect(lineState(shot({ ...rendered, dialogue: ' Rough night, huh? ' }), [hank])).toBe('ready');
  });
});

describe('audio assets', () => {
  it('reads a WAV duration from its header', () => {
    expect(wavDurationSec(toneWav('x'.repeat(28)))).toBe(2);
    expect(wavDurationSec(Buffer.from('not a wav at all, just some bytes here....'))).toBeUndefined();
  });
});

describe('export segment', () => {
  const size = { width: 832, height: 480 };
  it('mixes a rendered line into a silent clip and leaves clips with sound alone', async () => {
    const { segmentArgs, LINE_OFFSET_MS } = await import('../pipeline/project_export');
    const silent = segmentArgs({ src: 'a.mp4', out: 'o.mp4', withAudio: false, size, fps: 16 });
    expect(silent).toContain('anullsrc=r=48000:cl=stereo');
    expect(silent.join(' ')).toContain('-map 1:a:0');
    expect(silent).not.toContain('-filter_complex');

    const withLine = segmentArgs({ src: 'a.mp4', out: 'o.mp4', withAudio: false, line: 'l.wav', size, fps: 16 });
    const filter = withLine[withLine.indexOf('-filter_complex') + 1];
    expect(filter).toContain(`adelay=${LINE_OFFSET_MS}`);
    expect(filter).toContain('amix=inputs=2:duration=first');
    expect(withLine.join(' ')).toContain('-i l.wav');
    expect(withLine.join(' ')).toContain('-map [a]');

    const sound = segmentArgs({ src: 'a.mp4', out: 'o.mp4', withAudio: true, line: 'l.wav', size, fps: 24 });
    expect(sound.join(' ')).toContain('-map 0:a:0');
    expect(sound).not.toContain('l.wav');
  });

  const hasFfmpeg = (() => {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasFfmpeg)('produces a segment you can hear the line in (real ffmpeg)', async () => {
    const { segmentArgs } = await import('../pipeline/project_export');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-segment-'));
    const clip = path.join(dir, 'clip.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=16:duration=3', '-pix_fmt', 'yuv420p', clip]);
    const line = path.join(dir, 'line.wav');
    fs.writeFileSync(line, toneWav('x'.repeat(28))); // 2 s
    const maxVolumeDb = (file: string) => {
      const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
      return Number(/max_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1]);
    };
    const run = (withLine: boolean) => {
      const out = path.join(dir, withLine ? 'with.mp4' : 'without.mp4');
      execFileSync('ffmpeg', ['-loglevel', 'error', ...segmentArgs({ src: clip, out, withAudio: false, line: withLine ? line : undefined, size: { width: 320, height: 240 }, fps: 16 })]);
      const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', out], { encoding: 'utf8' });
      const info = JSON.parse(probe);
      const maxDb = maxVolumeDb(out);
      return { streams: info.streams.map((s: any) => s.codec_type).sort(), duration: Number(info.format.duration), maxDb };
    };
    const silent = run(false);
    const spoken = run(true);
    expect(silent.streams).toEqual(['audio', 'video']);
    expect(spoken.streams).toEqual(['audio', 'video']);
    expect(spoken.duration).toBeCloseTo(3, 0); // the picture sets the length
    expect(silent.maxDb).toBeLessThan(-80);
    expect(spoken.maxDb).toBeGreaterThan(-30);
  });
});

// "Room sound" for recorded lines. Qwen3-TTS renders dry studio audio; laid over a picture it sounds pasted
// on. A light early reflection + low cut places it in a room, and a very quiet room-tone bed under the
// film's silent shots keeps the cut from dropping to digital silence between lines. ffmpeg only.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LINE_START_SEC } from '../../shared/dialogue';

const execFileAsync = promisify(execFile);

/** On a line: low cut, then two soft reflections (~35 and ~55 ms), as in a small room. */
export const ROOM_FILTER = 'highpass=f=70,aecho=0.8:0.6:35|55:0.18|0.12';

/** Under silent shots of a film that has lines: brown noise far below speech (about -60 dB). */
export const ROOM_TONE_SOURCE = 'anoisesrc=color=brown:amplitude=0.002:sample_rate=48000';

/** A shot's line as its clip's soundtrack: LINE_START_SEC in, room sound, exactly `durationSec` long,
 *  48 kHz stereo WAV. Used to drive LTX-2.5 lip sync. */
export async function lineForClip(lineFile: string, durationSec: number): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-line-'));
  const out = path.join(dir, 'line.wav');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', lineFile,
      '-af', `${ROOM_FILTER},adelay=${Math.round(LINE_START_SEC * 1000)}:all=1,apad=whole_dur=${durationSec},atrim=0:${durationSec}`,
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out,
    ]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

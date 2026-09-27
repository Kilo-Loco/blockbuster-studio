// Small previews an agent can look at (MCP clients cap tool content at about 1 MB): a contact sheet of
// evenly spaced frames for a video, a downscaled copy of an image. Cached next to the media.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR } from '../config';
import type { Asset } from '../../shared/types';
import { assetDiskPath } from './media';

const execFileAsync = promisify(execFile);
const CACHE_DIR = () => path.join(DATA_DIR, 'cache', 'review');

export interface ReviewImage {
  bytes: Buffer;
  /** Seconds into the clip of each tile, left to right, top to bottom (videos only). */
  times: number[];
  columns: number;
  rows: number;
}

export function reviewParams(nRaw: string | undefined, widthRaw: string | undefined) {
  const n = Math.max(1, Math.min(12, Math.round(Number(nRaw) || 6)));
  const width = Math.max(160, Math.min(640, Math.round(Number(widthRaw) || 320)));
  return { n, width };
}

async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error('Could not read the video length');
  return d;
}

/** One JPEG with `n` evenly spaced frames of a video (tile width `width`), or a downscaled image. */
export async function reviewImage(asset: Asset, n: number, width: number): Promise<ReviewImage> {
  const src = assetDiskPath(asset);
  const isVideo = asset.kind === 'video';
  const columns = isVideo ? Math.min(n, n <= 4 ? n : Math.ceil(n / 2)) : 1;
  const rows = isVideo ? Math.ceil(n / columns) : 1;
  const duration = isVideo ? (asset.durationSec && asset.durationSec > 0 ? asset.durationSec : await probeDuration(src)) : 0;
  // Frame centres of n equal slices, so the first and last tiles aren't black fades.
  const times = isVideo ? Array.from({ length: n }, (_, i) => Number((((i + 0.5) * duration) / n).toFixed(2))) : [];

  const out = path.join(CACHE_DIR(), `${asset.id}-${isVideo ? n : 1}-${width}.jpg`);
  try {
    return { bytes: await fs.readFile(out), times, columns, rows };
  } catch {
    // not cached yet
  }
  await fs.mkdir(CACHE_DIR(), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp.jpg`;
  const scale = `scale=${width}:-2`;
  const vf = isVideo
    ? `select='${times.map((t) => `lt(prev_t\\,${t})*gte(t\\,${t})`).join('+')}',${scale},tile=${columns}x${rows}`
    : `scale='min(${width * 3},iw)':-2`;
  const args = ['-y', '-loglevel', 'error', '-i', src, '-vf', vf, '-frames:v', '1', '-q:v', '5'];
  if (isVideo) args.splice(args.indexOf('-vf'), 0, '-fps_mode', 'vfr');
  await execFileAsync('ffmpeg', [...args, tmp]);
  await fs.rename(tmp, out);
  return { bytes: await fs.readFile(out), times, columns, rows };
}

// Shared helpers for job runners: saving ComfyUI outputs as assets, thumbnails, size probing.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR } from '../config';
import { assets as assetsRepo, loras as lorasRepo, newId } from '../db';
import { emit } from '../events';
import type { Asset, AssetKind, AssetOrigin, EngineId, ID, LoraRef } from '../../shared/types';
import type { ComfyClient, ComfyOutputFile } from '../comfy/client';
import type { LoraFile } from '../comfy/workflows';

const execFileAsync = promisify(execFile);

let ffmpegChecked: boolean | undefined;
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== undefined) return ffmpegChecked;
  try {
    await execFileAsync('ffmpeg', ['-version']);
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

/** Read PNG (IHDR) or JPEG (SOF marker) headers ourselves rather than pulling in an image library. */
export function probeImageSize(buf: Buffer): { width: number; height: number } {
  // PNG: 8-byte signature, then IHDR chunk with width/height as big-endian u32 at offset 16/20.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: scan markers for a SOFn (0xC0-0xCF, excluding C4/C8/CC) segment; height/width follow at +5/+7.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }
  return { width: 0, height: 0 };
}

/** Duration of a PCM WAV from its header (fmt + data chunks), or undefined for anything else. */
export function wavDurationSec(buf: Buffer): number | undefined {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return undefined;
  let byteRate = 0;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') return byteRate ? Math.round((Math.min(size, buf.length - off - 8) / byteRate) * 1000) / 1000 : undefined;
    off += 8 + size + (size % 2);
  }
  return undefined;
}

function monthDir(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function resolveSeed(seed?: number): number {
  return seed ?? Math.floor(Math.random() * 2 ** 31);
}

export interface SaveOutputOpts {
  kind: AssetKind;
  origin: AssetOrigin;
  ext: string; // 'png' | 'jpg' | 'mp4' | 'wav'
  bytes: Buffer;
  prompt?: string;
  engine?: EngineId;
  params?: Record<string, unknown>;
  jobId?: ID;
  projectId?: ID;
  shotId?: ID;
  fps?: number;
}

/** Write a media file under DATA_DIR/media/<yyyy-mm>/<id>.<ext>, probe dims, make a thumb for video, and record an Asset. */
export async function saveAsset(opts: SaveOutputOpts): Promise<Asset> {
  const id = newId();
  const dir = path.join(DATA_DIR, 'media', monthDir());
  await fs.mkdir(dir, { recursive: true });
  const relFile = path.join(monthDir(), `${id}.${opts.ext}`);
  await fs.writeFile(path.join(dir, `${id}.${opts.ext}`), opts.bytes);

  let width = 0;
  let height = 0;
  let thumb: string | undefined;
  let durationSec: number | undefined;
  let probedFps: number | undefined;

  if (opts.kind === 'image') {
    ({ width, height } = probeImageSize(opts.bytes));
    // Gallery thumbnail: 640px-wide JPEG (~60 KB vs ~1–2 MB PNG) so grids load fast over the proxy.
    if (await hasFfmpeg()) {
      try {
        await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, `${id}.${opts.ext}`), '-vf', "scale='min(640,iw)':-2", '-q:v', '4', path.join(dir, `${id}.thumb.jpg`)]);
        thumb = path.join(monthDir(), `${id}.thumb.jpg`);
      } catch {
        thumb = undefined;
      }
    }
  } else if (opts.kind === 'audio') {
    durationSec = wavDurationSec(opts.bytes);
  } else {
    // Video: probe via ffprobe if available, else fall back to 0 (still a valid asset).
    if (await hasFfmpeg()) {
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,duration,avg_frame_rate',
          '-of', 'json',
          path.join(dir, `${id}.${opts.ext}`),
        ]);
        const info = JSON.parse(stdout);
        const stream = info.streams?.[0];
        width = Number(stream?.width) || 0;
        height = Number(stream?.height) || 0;
        durationSec = Number(stream?.duration) || undefined;
        if (!opts.fps && typeof stream?.avg_frame_rate === 'string') {
          const [num, den] = stream.avg_frame_rate.split('/').map(Number);
          if (num && den) probedFps = Math.round((num / den) * 100) / 100;
        }
      } catch {
        // ffprobe missing or file not decodable (e.g. mock's placeholder bytes) — leave 0/undefined
      }
      // Poster thumbnail.
      try {
        const thumbRel = path.join(monthDir(), `${id}.jpg`);
        await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0', '-i', path.join(dir, `${id}.${opts.ext}`), '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', path.join(dir, `${id}.jpg`)]);
        thumb = thumbRel;
      } catch {
        thumb = undefined;
      }
    }
  }

  const asset = assetsRepo.create({
    id,
    kind: opts.kind,
    origin: opts.origin,
    file: relFile,
    thumb,
    width,
    height,
    durationSec,
    fps: opts.fps ?? probedFps,
    prompt: opts.prompt,
    engine: opts.engine,
    params: opts.params,
    jobId: opts.jobId,
    projectId: opts.projectId,
    shotId: opts.shotId,
    favorite: false,
  });
  emit({ type: 'asset', asset });
  return asset;
}

/** Download a ComfyUI output and save it as an Asset. */
export async function saveComfyOutput(
  comfy: ComfyClient,
  file: ComfyOutputFile,
  opts: Omit<SaveOutputOpts, 'kind' | 'ext' | 'bytes'>,
): Promise<Asset> {
  const bytes = await comfy.downloadOutput(file);
  const ext = file.isVideo ? 'mp4' : path.extname(file.filename).replace('.', '') || 'png';
  return saveAsset({ ...opts, kind: file.isVideo ? 'video' : 'image', ext, bytes, fps: file.isVideo ? opts.fps ?? 16 : undefined });
}

export function assetDiskPath(asset: Asset): string {
  return path.join(DATA_DIR, 'media', asset.file);
}

/** Resolve GenerateRequest/shot LoraRefs into the {filename, strength, expert} shape workflows.ts wants. */
export function toLoraFiles(refs: LoraRef[] | undefined): LoraFile[] {
  if (!refs?.length) return [];
  const files: LoraFile[] = [];
  for (const ref of refs) {
    const lora = lorasRepo.get(ref.loraId);
    if (!lora || lora.status !== 'ready') continue;
    files.push({ filename: lora.filename, strength: ref.strength, expert: ref.expert, family: lora.family });
  }
  return files;
}

/** Upload an existing asset's file to ComfyUI so it can be used as a LoadImage input. */
export async function uploadAssetToComfy(comfy: ComfyClient, asset: Asset): Promise<string> {
  const bytes = await fs.readFile(assetDiskPath(asset));
  const ext = path.extname(asset.file) || '.png';
  return comfy.uploadImage(bytes, `${asset.id}${ext}`);
}

/** Backfill gallery thumbnails for images saved before thumbnails existed (runs once at startup). */
export async function backfillImageThumbs(): Promise<number> {
  if (!(await hasFfmpeg())) return 0;
  let made = 0;
  for (const a of assetsRepo.listImagesWithoutThumb()) {
    const src = path.join(DATA_DIR, 'media', a.file);
    const rel = a.file.replace(/\.[a-z0-9]+$/i, '.thumb.jpg');
    try {
      await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='min(640,iw)':-2", '-q:v', '4', path.join(DATA_DIR, 'media', rel)]);
      assetsRepo.update(a.id, { thumb: rel });
      made++;
    } catch {
      // missing/corrupt source: leave it without a thumb
    }
  }
  return made;
}

/** Transcode an uploaded video to H.264/AAC MP4 (≤30 s, ≤1080p long side). Returns undefined without ffmpeg. */
export async function normalizeVideo(bytes: Buffer, ext: string): Promise<Buffer | undefined> {
  if (!(await hasFfmpeg())) return undefined;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-upload-'));
  const src = path.join(dir, `in.${ext || 'bin'}`);
  const dst = path.join(dir, 'out.mp4');
  try {
    await fs.writeFile(src, bytes);
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', src, '-t', '30',
      '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',fps='min(30,source_fps)'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dst,
    ]);
    return await fs.readFile(dst);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Normalize an uploaded voice clip (browser WebM/Opus, iPhone M4A, MP3, …) to what Qwen3-TTS clones from
 *  best: 24 kHz mono 16-bit WAV, at most 30 s. Undefined without ffmpeg. */
export async function normalizeAudio(bytes: Buffer, ext: string): Promise<Buffer | undefined> {
  if (!(await hasFfmpeg())) return undefined;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-audio-'));
  const src = path.join(dir, `in.${ext || 'bin'}`);
  const dst = path.join(dir, 'out.wav');
  try {
    await fs.writeFile(src, bytes);
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-t', '30', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', dst]);
    return await fs.readFile(dst);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Fit an image into width×height → PNG bytes. 'pad' letterboxes with neutral gray; 'crop' fills and center-crops. */
export async function fitImageToFrame(src: string, width: number, height: number, mode: 'pad' | 'crop' = 'pad'): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-fit-'));
  const out = path.join(dir, 'fit.png');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', src,
      '-vf',
      mode === 'pad'
        ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x808080`
        : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      '-frames:v', '1', out,
    ]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Composite 1..4 reference images side by side into one PNG at roughly width×height, for engines whose
 *  ComfyUI node takes only a single reference image (Wan VACE-Fun's WanVaceToVideo). Each image is scaled to
 *  fill its equal-width slot (cropping any excess) so every sheet stays fully legible; the target engine then
 *  rescales the whole composite to its exact render size. */
export async function compositeReferenceImages(srcs: string[], width: number, height: number): Promise<Buffer> {
  if (srcs.length === 1) return fitImageToFrame(srcs[0]!, width, height, 'crop');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-composite-'));
  const out = path.join(dir, 'composite.png');
  const n = Math.min(4, srcs.length);
  const slotW = Math.max(2, Math.floor(width / n));
  try {
    const inputs = srcs.slice(0, n).flatMap((s) => ['-i', s]);
    const scale = srcs
      .slice(0, n)
      .map((_, i) => `[${i}:v]scale=${slotW}:${height}:force_original_aspect_ratio=increase,crop=${slotW}:${height}[v${i}]`)
      .join(';');
    const stack = `${srcs
      .slice(0, n)
      .map((_, i) => `[v${i}]`)
      .join('')}hstack=inputs=${n}[out]`;
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${scale};${stack}`, '-map', '[out]', '-frames:v', '1', out]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** A control video for Wan Fun-Control / LTX-2.5 IC-control: re-timed to `fps`, scaled/cropped to
 *  width×height, exactly `frames` frames (the last frame is held if the source is shorter), no audio → MP4
 *  bytes. `startSec` (default 0) slices the source first — a scene previs sliced to one shot's window (see
 *  shot_video.ts's scene-previs branch); seeking after decode (not a fast `-ss` before `-i`) keeps it frame
 *  accurate on the short clips this is used for. */
export async function prepareControlVideo(src: string, opts: { fps: number; width: number; height: number; frames: number; startSec?: number }): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-ctl-'));
  const out = path.join(dir, 'control.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', src, ...(opts.startSec ? ['-ss', String(opts.startSec)] : []), '-an',
      '-vf', `fps=${opts.fps},scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase,crop=${opts.width}:${opts.height},tpad=stop_mode=clone:stop_duration=60`,
      '-frames:v', String(opts.frames),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', out,
    ]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** A reference video for MiniMax H3 Ref2VA: 24 fps, scaled to fit width×height (letterboxed, no crop, since the
 *  model reads it as a whole), at most `maxSec` seconds, no audio → MP4 bytes. `startSec` slices the source
 *  first (a scene previs sliced to one shot's window; see shot_video.ts's scene-previs branch). */
export async function prepareReferenceVideo(src: string, opts: { width: number; height: number; maxSec: number; startSec?: number }): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-ref-'));
  const out = path.join(dir, 'ref.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', src, ...(opts.startSec ? ['-ss', String(opts.startSec)] : []), '-an', '-t', String(opts.maxSec),
      '-vf', `fps=24,scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:color=0x000000`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', out,
    ]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** A static "reference sheet" video for LTX-2.5's Ingredients IC-LoRA: the still image held on every frame,
 *  scaled/cropped to width×height, at `fps`, for `frames` frames (or the model's trained minimum of 121,
 *  whichever is larger — the caller passes max(121, length)), no audio → MP4 bytes. */
export async function buildReferenceSheetVideo(src: string, opts: { fps: number; width: number; height: number; frames: number }): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-sheet-'));
  const out = path.join(dir, 'sheet.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-loop', '1', '-i', src, '-an',
      '-vf', `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase,crop=${opts.width}:${opts.height},fps=${opts.fps}`,
      '-frames:v', String(opts.frames),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', out,
    ]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Composite named panels onto one black canvas at exact pixel rects (a scene's Ingredients reference sheet:
 *  see reference_sheet.ts layoutReferenceSheet for the panel geometry). No text is drawn — the sheet is a pure
 *  image reference; the model card explicitly requires "no text". A panel with no source image (missing
 *  reference) is left as a black rectangle rather than failing the whole sheet. */
export async function composeReferenceSheetImage(panels: { path?: string; x: number; y: number; w: number; h: number }[], width: number, height: number): Promise<Buffer> {
  const withImage = panels.filter((p): p is { path: string; x: number; y: number; w: number; h: number } => Boolean(p.path));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-sheet-'));
  const out = path.join(dir, 'sheet.png');
  try {
    if (!withImage.length) {
      await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}`, '-frames:v', '1', out]);
      return await fs.readFile(out);
    }
    const inputs = withImage.flatMap((p) => ['-i', p.path]);
    const scales = withImage.map((p, i) => `[${i}:v]scale=${p.w}:${p.h}:force_original_aspect_ratio=increase,crop=${p.w}:${p.h}[p${i}]`).join(';');
    let overlays = '';
    let prev = 'bg0';
    withImage.forEach((p, i) => {
      const isLast = i === withImage.length - 1;
      const next = isLast ? 'out' : `bg${i + 1}`;
      overlays += `${overlays ? ';' : ''}[${prev}][p${i}]overlay=${p.x}:${p.y}[${next}]`;
      prev = next;
    });
    const filter = `color=c=black:s=${width}x${height}[bg0];${scales};${overlays}`;
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', out]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Re-time a video to `fps` (keeps audio) → MP4 bytes. */
export async function resampleVideo(src: string, fps: number): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-fps-'));
  const out = path.join(dir, 'out.mp4');
  try {
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `fps=${fps}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', out]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

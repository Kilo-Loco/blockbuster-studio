// 'project_export' job: ffmpeg-normalize every shot's video to the project's size, one frame rate
// (16 fps, or 24 when any shot came from MiniMax H3 or LTX-2.5), h264/yuv420p and a stereo AAC track (silence
// for clips without sound), then concat them in scene/shot order into one MP4. A silent clip whose line
// was rendered in the speaker's voice gets that line mixed in; clips with their own sound keep it.
// With project.upscale '4k', each normalized segment is then upscaled to 4K with SeedVR2 (see the "4K upscale"
// section below) before the concat/grade steps.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerRunner, type RunnerContext } from './queue';
import { assets as assetsRepo, characters as charactersRepo, projects as projectsRepo, shots as shotsRepo } from '../db';
import { DATA_DIR } from '../config';
import { VIDEO_SIZES } from '../../shared/presets';
import { assetDiskPath, hasFfmpeg, saveAsset } from './media';
import { LINE_START_SEC, lineState } from '../../shared/dialogue';
import { ROOM_FILTER, ROOM_TONE_SOURCE } from '../voice/room';
import { buildSeedVR2Upscale } from '../comfy/workflows';
import { isEngineAvailable } from '../system';
import type { AspectRatio, Character, Shot } from '../../shared/types';

const execFileAsync = promisify(execFile);

async function hasAudioStream(file: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export const LINE_OFFSET_MS = LINE_START_SEC * 1000;

/** Project.grade 'film': a subtle, conservative pass applied once to the concatenated film — warm midtones
 *  (curves), a gentle S-curve for contrast (eq), a touch more saturation (eq), and fine grain (noise). Kept
 *  mild on purpose: this runs on every export, not a single graded shot, and should read as "film stock", not
 *  a strong look. */
export const FILM_GRADE_FILTER =
  'curves=r=\'0/0 0.5/0.58 1/1\':b=\'0/0 0.5/0.44 1/0.95\',' +
  'eq=contrast=1.06:saturation=1.08,' +
  'noise=alls=6:allf=t';

/** ffmpeg arguments that normalize one shot's clip to the export's size, fps and stereo AAC track.
 *  `roomTone`: the film has lines, so silent shots get a quiet room-tone bed instead of digital silence. */
export function segmentArgs(p: {
  src: string;
  out: string;
  withAudio: boolean;
  line?: string;
  roomTone?: boolean;
  size: { width: number; height: number };
  fps: number;
  /** Cut the segment to this many seconds: the shot's planned length when the model rendered a longer clip
   *  (MiniMax H3 renders 4 s minimum, so a 2 s shot comes back as a 4 s take). */
  maxSec?: number;
}): string[] {
  const inputs = ['-i', p.src];
  let audio: string[];
  if (p.withAudio) {
    audio = ['-map', '0:a:0'];
  } else {
    // A stereo bed so every segment has the same streams (the concat demuxer needs that).
    if (p.roomTone) inputs.push('-f', 'lavfi', '-i', ROOM_TONE_SOURCE);
    else inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    const bed = p.roomTone ? '[1:a]aformat=sample_rates=48000:channel_layouts=stereo[bed]' : '';
    if (p.line) {
      // The rendered line, in the room, over the bed, starting LINE_OFFSET_MS in; -shortest ends it with the picture.
      inputs.push('-i', p.line);
      audio = [
        '-filter_complex',
        `${bed ? `${bed};` : ''}[2:a]${ROOM_FILTER},aformat=sample_rates=48000:channel_layouts=stereo,adelay=${LINE_OFFSET_MS}:all=1[line];${bed ? '[bed]' : '[1:a]'}[line]amix=inputs=2:duration=first:normalize=0[a]`,
        '-map', '[a]',
      ];
    } else if (bed) {
      audio = ['-filter_complex', bed, '-map', '[bed]'];
    } else {
      audio = ['-map', '1:a:0'];
    }
  }
  return [
    '-y',
    ...inputs,
    '-map', '0:v:0',
    ...audio,
    '-vf',
    `scale=${p.size.width}:${p.size.height}:force_original_aspect_ratio=increase,crop=${p.size.width}:${p.size.height},fps=${p.fps}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    ...(p.maxSec ? ['-t', String(p.maxSec)] : []),
    '-shortest',
    p.out,
  ];
}

/** The shot's rendered line, when it still matches the line and the speaker's voice. */
function currentLineFile(shot: Shot): string | undefined {
  const cast = shot.characterIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
  if (!shot.dialogueAudioAssetId || lineState(shot, cast) !== 'ready') return undefined;
  const line = assetsRepo.get(shot.dialogueAudioAssetId);
  return line ? assetDiskPath(line) : undefined;
}

/** The export size: HD when any clip was rendered at (or near) HD size, so HD shots aren't shrunk to 480p. */
export function exportSize(aspect: keyof typeof VIDEO_SIZES.fast, clips: { width?: number; height?: number }[]): { width: number; height: number } {
  const hd = VIDEO_SIZES.hd[aspect];
  const anyHd = clips.some((a) => Math.max(a.width ?? 0, a.height ?? 0) >= Math.max(hd.width, hd.height) * 0.9);
  return anyHd ? hd : VIDEO_SIZES.fast[aspect];
}

// ───────────────────────────── 4K upscale (project.upscale '4k') ─────────────────────────────

const ASPECT_RATIOS: Record<AspectRatio, [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '21:9': [21, 9],
};

const roundToEven = (n: number): number => Math.round(n / 2) * 2;

/** The 4K export size: the aspect fitted inside a 3840×2160 box (2160×3840 for a portrait aspect), rounded
 *  to even dimensions (e.g. 16:9 → 3840×2160, 9:16 → 2160×3840, 1:1 → 2160×2160, 4:3 → 2880×2160,
 *  21:9 → 3840×1646). */
export function uhdSize(aspect: AspectRatio): { width: number; height: number } {
  const [rw, rh] = ASPECT_RATIOS[aspect];
  const [boxW, boxH] = rw >= rh ? [3840, 2160] : [2160, 3840];
  const scale = Math.min(boxW / rw, boxH / rh);
  return { width: roundToEven(rw * scale), height: roundToEven(rh * scale) };
}

/** A segment's frame count, from its duration and the export fps. */
async function frameCount(file: string, fps: number): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Math.max(1, Math.round(Number(stdout.trim() || 0) * fps));
}

const MAX_UPSCALE_PIECE_FRAMES = 121; // ≈5 s at 24 fps

/** Splits a segment into (silent) pieces of at most MAX_UPSCALE_PIECE_FRAMES frames each, so a longer shot
 *  still renders through SeedVR2 in the sizes ComfyUI was validated against. Most shots are one piece. */
async function splitForUpscale(src: string, dir: string, frames: number, fps: number): Promise<{ path: string; frames: number }[]> {
  if (frames <= MAX_UPSCALE_PIECE_FRAMES) return [{ path: src, frames }];
  const pieceCount = Math.ceil(frames / MAX_UPSCALE_PIECE_FRAMES);
  const framesPerPiece = Math.ceil(frames / pieceCount);
  const pieces: { path: string; frames: number }[] = [];
  for (let i = 0; i * framesPerPiece < frames; i++) {
    const startFrame = i * framesPerPiece;
    const pieceFrames = Math.min(framesPerPiece, frames - startFrame);
    const out = path.join(dir, `up_${String(i).padStart(2, '0')}.mp4`);
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', src, '-ss', String(startFrame / fps), '-frames:v', String(pieceFrames), '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', out,
    ]);
    pieces.push({ path: out, frames: pieceFrames });
  }
  return pieces;
}

/** Renders one (silent) piece through buildSeedVR2Upscale and downloads the 4K result. */
async function upscalePiece(
  ctx: RunnerContext,
  piece: { path: string; frames: number },
  opts: { resolution: number; fps: number; label: string; framesDoneBefore: number; totalFrames: number },
  outDir: string,
  index: number,
): Promise<string> {
  const name = await ctx.comfy.uploadImage(await fs.readFile(piece.path), `upscale_${index}.mp4`);
  const workflow = buildSeedVR2Upscale({ video: name, resolution: opts.resolution, fps: opts.fps, seed: 42, filenamePrefix: 'studio/upscale_4k' });
  const promptId = await ctx.comfy.queuePrompt(workflow);
  await ctx.comfy.waitFor(promptId, workflow, (frac) => {
    const doneFrames = opts.framesDoneBefore + frac * piece.frames;
    ctx.setProgress(0.1 + (doneFrames / opts.totalFrames) * 0.8, opts.label);
  });
  const [file] = await ctx.comfy.getOutputs(promptId);
  if (!file) throw new Error('4K upscale produced no output');
  const outPath = path.join(outDir, `upscaled_${index}.mp4`);
  await fs.writeFile(outPath, await ctx.comfy.downloadOutput(file));
  return outPath;
}

/** Upscales every normalized segment to 4K (splitting long ones into pieces), remuxes each segment's original
 *  audio back on (SeedVR2 drops audio) and crops to the exact 4K size. Segments render one at a time, keeping
 *  only the current segment's pieces on disk. */
async function upscaleSegmentsTo4k(
  ctx: RunnerContext,
  normalized: string[],
  opts: { target: { width: number; height: number }; fps: number; tmpDir: string },
): Promise<string[]> {
  const resolution = Math.min(opts.target.width, opts.target.height);
  const perSegment = await Promise.all(normalized.map((f) => frameCount(f, opts.fps)));
  const totalFrames = perSegment.reduce((a, b) => a + b, 0) || 1;

  const out: string[] = [];
  let framesDoneBefore = 0;
  for (let i = 0; i < normalized.length; i++) {
    if (ctx.isCanceled()) return out;
    const segDir = path.join(opts.tmpDir, `up_seg_${i}`);
    await fs.mkdir(segDir, { recursive: true });
    const pieces = await splitForUpscale(normalized[i]!, segDir, perSegment[i]!, opts.fps);
    const upscaledPieces: string[] = [];
    for (let j = 0; j < pieces.length; j++) {
      if (ctx.isCanceled()) return out;
      const upscaled = await upscalePiece(
        ctx,
        pieces[j]!,
        { resolution, fps: opts.fps, label: `Upscaling to 4K ${i + 1}/${normalized.length}`, framesDoneBefore, totalFrames },
        segDir,
        j,
      );
      upscaledPieces.push(upscaled);
      framesDoneBefore += pieces[j]!.frames;
    }

    let upscaledVideo = upscaledPieces[0]!;
    if (upscaledPieces.length > 1) {
      const listFile = path.join(segDir, 'pieces.txt');
      await fs.writeFile(listFile, upscaledPieces.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
      upscaledVideo = path.join(segDir, 'concat.mp4');
      await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', upscaledVideo]);
    }

    // Remux the segment's original audio back on (SeedVR2 output has none) and crop to the exact 4K size.
    const finalSeg = path.join(opts.tmpDir, `${String(i).padStart(3, '0')}_4k.mp4`);
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', upscaledVideo, '-i', normalized[i]!,
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', `scale=${opts.target.width}:${opts.target.height}:force_original_aspect_ratio=increase,crop=${opts.target.width}:${opts.target.height}`,
      '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest',
      finalSeg,
    ]);
    out.push(finalSeg);
    await fs.rm(segDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return out;
}

registerRunner('project_export', async (job, ctx) => {
  const params = job.params as { projectId?: string };
  const projectId = String(params.projectId ?? '');
  const project = projectsRepo.get(projectId);
  if (!project) throw new Error('Project not found');
  if (!(await hasFfmpeg())) throw new Error('ffmpeg is required to export a project but was not found on PATH');
  const upscale4k = project.upscale === '4k';
  if (upscale4k && !(await isEngineAvailable(ctx.comfy, 'upscale_4k'))) {
    throw new Error('4K needs the 4K upscaler models. Set DOWNLOAD_UPSCALE_MODELS=true with Edit Pod in Runpod; they download on the next start.');
  }

  const shotRows = shotsRepo.listByProject(projectId).filter((s) => s.videoAssetId);
  if (!shotRows.length) throw new Error('No shots with a rendered video to export');

  const clips = shotRows.map((s) => assetsRepo.get(s.videoAssetId!)).filter((a): a is NonNullable<typeof a> => Boolean(a));
  const size = exportSize(project.aspect, clips);
  const fps = clips.some((a) => (a.fps ?? 16) > 16) ? 24 : 16;
  const tmpDir = path.join(DATA_DIR, 'export', job.id);
  await fs.mkdir(tmpDir, { recursive: true });

  // A film with recorded lines gets room tone under its silent shots, so the sound doesn't drop out between lines.
  const roomTone = shotRows.some((s) => Boolean(currentLineFile(s)));
  const normalized: string[] = [];
  for (let i = 0; i < shotRows.length; i++) {
    const shot = shotRows[i]!;
    const asset = assetsRepo.get(shot.videoAssetId!);
    if (!asset) continue;
    const src = assetDiskPath(asset);
    const out = path.join(tmpDir, `${String(i).padStart(3, '0')}.mp4`);
    const withAudio = await hasAudioStream(src);
    // A take longer than the shot's planned length is cut to it, so the edit keeps the storyboard's timing.
    const maxSec = asset.durationSec && shot.durationSec && asset.durationSec > shot.durationSec + 0.3 ? shot.durationSec : undefined;
    await execFileAsync('ffmpeg', segmentArgs({ src, out, withAudio, line: withAudio ? undefined : currentLineFile(shot), roomTone, size, fps, maxSec }));
    normalized.push(out);
    if (ctx.isCanceled()) return;
    ctx.setProgress(((i + 1) / shotRows.length) * (upscale4k ? 0.1 : 0.85), `Normalizing ${i + 1}/${shotRows.length}`);
  }
  if (!normalized.length) throw new Error('No exportable clips (source video files were missing)');

  let segments = normalized;
  let outSize = size;
  if (upscale4k) {
    outSize = uhdSize(project.aspect);
    segments = await upscaleSegmentsTo4k(ctx, normalized, { target: outSize, fps, tmpDir });
    if (ctx.isCanceled()) return;
  }

  const listFile = path.join(tmpDir, 'list.txt');
  await fs.writeFile(listFile, segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const concatFile = path.join(tmpDir, 'concat.mp4');
  ctx.setProgress(upscale4k ? 0.92 : 0.9, 'Concatenating');
  await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concatFile]);

  let outFile = concatFile;
  if (project.grade === 'film') {
    ctx.setProgress(upscale4k ? 0.96 : 0.95, 'Grading');
    outFile = path.join(tmpDir, 'export.mp4');
    await execFileAsync('ffmpeg', ['-y', '-i', concatFile, '-vf', FILM_GRADE_FILTER, '-c:v', 'libx264', ...(upscale4k ? ['-crf', '16'] : []), '-pix_fmt', 'yuv420p', '-c:a', 'copy', outFile]);
  }

  const bytes = await fs.readFile(outFile);
  const asset = await saveAsset({
    kind: 'video',
    origin: 'export',
    ext: 'mp4',
    bytes,
    params: { projectId, shotCount: shotRows.length, upscale: project.upscale },
    jobId: job.id,
    projectId,
    fps,
  });
  ctx.addOutput(asset.id);
  projectsRepo.update(projectId, { exportAssetId: asset.id });
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  ctx.setProgress(1, 'Done');
});

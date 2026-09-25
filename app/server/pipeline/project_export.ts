// 'project_export' job: ffmpeg-normalize every shot's video to the project's size, one frame rate
// (16 fps, or 24 when any shot came from MiniMax H3), h264/yuv420p and a stereo AAC track (silence
// for clips without sound), then concat them in scene/shot order into one MP4.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerRunner } from './queue';
import { assets as assetsRepo, projects as projectsRepo, shots as shotsRepo } from '../db';
import { DATA_DIR } from '../config';
import { VIDEO_SIZES } from '../../shared/presets';
import { assetDiskPath, hasFfmpeg, saveAsset } from './media';

const execFileAsync = promisify(execFile);

async function hasAudioStream(file: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

registerRunner('project_export', async (job, ctx) => {
  const params = job.params as { projectId?: string };
  const projectId = String(params.projectId ?? '');
  const project = projectsRepo.get(projectId);
  if (!project) throw new Error('Project not found');
  if (!(await hasFfmpeg())) throw new Error('ffmpeg is required to export a project but was not found on PATH');

  const shotRows = shotsRepo.listByProject(projectId).filter((s) => s.videoAssetId);
  if (!shotRows.length) throw new Error('No shots with a rendered video to export');

  const size = VIDEO_SIZES.fast[project.aspect];
  const clips = shotRows.map((s) => assetsRepo.get(s.videoAssetId!)).filter((a): a is NonNullable<typeof a> => Boolean(a));
  const fps = clips.some((a) => (a.fps ?? 16) > 16) ? 24 : 16;
  const tmpDir = path.join(DATA_DIR, 'export', job.id);
  await fs.mkdir(tmpDir, { recursive: true });

  const normalized: string[] = [];
  for (let i = 0; i < shotRows.length; i++) {
    const shot = shotRows[i]!;
    const asset = assetsRepo.get(shot.videoAssetId!);
    if (!asset) continue;
    const src = assetDiskPath(asset);
    const out = path.join(tmpDir, `${String(i).padStart(3, '0')}.mp4`);
    const withAudio = await hasAudioStream(src);
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', src,
      // Silent stereo bed so every segment has the same streams (the concat demuxer needs that).
      ...(withAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
      '-map', '0:v:0',
      '-map', withAudio ? '0:a:0' : '1:a:0',
      '-vf',
      `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2',
      '-shortest',
      out,
    ]);
    normalized.push(out);
    if (ctx.isCanceled()) return;
    ctx.setProgress(((i + 1) / shotRows.length) * 0.85, `Normalizing ${i + 1}/${shotRows.length}`);
  }
  if (!normalized.length) throw new Error('No exportable clips (source video files were missing)');

  const listFile = path.join(tmpDir, 'list.txt');
  await fs.writeFile(listFile, normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const outFile = path.join(tmpDir, 'export.mp4');
  ctx.setProgress(0.9, 'Concatenating');
  await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile]);

  const bytes = await fs.readFile(outFile);
  const asset = await saveAsset({
    kind: 'video',
    origin: 'export',
    ext: 'mp4',
    bytes,
    params: { projectId, shotCount: shotRows.length },
    jobId: job.id,
    projectId,
    fps,
  });
  ctx.addOutput(asset.id);
  projectsRepo.update(projectId, { exportAssetId: asset.id });
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  ctx.setProgress(1, 'Done');
});

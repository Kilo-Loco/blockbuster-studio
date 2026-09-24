// 'project_export' job: ffmpeg-normalize every shot's video to the project's size/16fps/h264/yuv420p
// then concat them in scene/shot order into one MP4.
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

registerRunner('project_export', async (job, ctx) => {
  const params = job.params as { projectId?: string };
  const projectId = String(params.projectId ?? '');
  const project = projectsRepo.get(projectId);
  if (!project) throw new Error('Project not found');
  if (!(await hasFfmpeg())) throw new Error('ffmpeg is required to export a project but was not found on PATH');

  const shotRows = shotsRepo.listByProject(projectId).filter((s) => s.videoAssetId);
  if (!shotRows.length) throw new Error('No shots with a rendered video to export');

  const size = VIDEO_SIZES.fast[project.aspect];
  const tmpDir = path.join(DATA_DIR, 'export', job.id);
  await fs.mkdir(tmpDir, { recursive: true });

  const normalized: string[] = [];
  for (let i = 0; i < shotRows.length; i++) {
    const shot = shotRows[i]!;
    const asset = assetsRepo.get(shot.videoAssetId!);
    if (!asset) continue;
    const src = assetDiskPath(asset);
    const out = path.join(tmpDir, `${String(i).padStart(3, '0')}.mp4`);
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', src,
      '-vf',
      `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,fps=16`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
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
    fps: 16,
  });
  ctx.addOutput(asset.id);
  projectsRepo.update(projectId, { exportAssetId: asset.id });
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  ctx.setProgress(1, 'Done');
});

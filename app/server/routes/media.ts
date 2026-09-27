import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { assets as assetsRepo, newId } from '../db';
import { DATA_DIR } from '../config';
import { emit } from '../events';
import { normalizeAudio, normalizeVideo, probeImageSize, saveAsset } from '../pipeline/media';
import { isAuthenticated } from '../auth';
import { reviewImage, reviewParams } from '../pipeline/review';
import { signedPath, verifyLink } from '../links';
import type { Context } from 'hono';

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.wav': 'audio/wav',
    }[ext] ?? 'application/octet-stream'
  );
}

export const mediaRoutes = new Hono();

// /media/* requires auth (checked manually here since this router is mounted before the global
// auth middleware's public-path allowlist, which excludes /media/*).
/** Stream a file under DATA_DIR/media, honouring Range requests (video scrubbing, resumable downloads). */
async function serveMediaFile(c: Context, rel: string, downloadName?: string) {
  const filePath = path.join(DATA_DIR, 'media', rel);
  if (!filePath.startsWith(path.join(DATA_DIR, 'media') + path.sep)) return c.json({ error: 'not found' }, 404);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return c.json({ error: 'not found' }, 404);
  }
  const contentType = contentTypeFor(filePath);
  if (downloadName) c.header('Content-Disposition', `attachment; filename="${downloadName.replace(/[^\w.-]/g, '_')}"`);
  const range = c.req.header('range');
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : stat.size - 1;
    const chunkSize = end - start + 1;
    const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream;
    c.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    c.header('Accept-Ranges', 'bytes');
    c.header('Content-Length', String(chunkSize));
    c.header('Content-Type', contentType);
    c.status(206);
    return c.body(stream);
  }
  c.header('Content-Length', String(stat.size));
  c.header('Content-Type', contentType);
  c.header('Accept-Ranges', 'bytes');
  const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
  return c.body(stream);
}

// /media/* requires auth (checked manually here since this router is mounted before the global
// auth middleware's public-path allowlist, which excludes /media/*).
mediaRoutes.get('/media/*', async (c) => {
  // Media paths are content-addressed by asset id and never rewritten, so let the browser keep them.
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  if (!isAuthenticated(c)) return c.json({ error: 'unauthorized' }, 401);
  return serveMediaFile(c, decodeURIComponent(c.req.path.replace(/^\/media\//, '')));
});

// Signed link (POST /api/assets/:id/link): no cookie or token, only a valid, unexpired signature.
mediaRoutes.get('/dl/:id/:exp/:sig/:name', async (c) => {
  const { id, exp, sig, name } = c.req.param();
  if (!verifyLink(id, exp, sig)) return c.json({ error: 'This link is invalid or has expired. Ask for a new one.' }, 403);
  const asset = assetsRepo.get(id);
  if (!asset) return c.json({ error: 'not found' }, 404);
  c.header('Cache-Control', 'private, no-store');
  return serveMediaFile(c, asset.file, name);
});

mediaRoutes.post('/api/assets/:id/link', (c) => {
  const asset = assetsRepo.get(c.req.param('id'));
  if (!asset) return c.json({ error: 'not found' }, 404);
  const { path: linkPath, expiresAt } = signedPath(asset.id, `${asset.kind === 'video' ? 'clip' : 'image'}-${asset.id}${path.extname(asset.file)}`);
  const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
  return c.json({ url: host ? `${proto}://${host}${linkPath}` : linkPath, path: linkPath, expiresAt, bytes: fs.statSync(path.join(DATA_DIR, 'media', asset.file), { throwIfNoEntry: false })?.size });
});

// A small JPEG for review: n evenly spaced frames of a video tiled into one image, or a downscaled image.
mediaRoutes.get('/api/assets/:id/frames', async (c) => {
  const asset = assetsRepo.get(c.req.param('id'));
  if (!asset) return c.json({ error: 'not found' }, 404);
  const { n, width } = reviewParams(c.req.query('n'), c.req.query('width'));
  try {
    const sheet = await reviewImage(asset, n, width);
    c.header('Content-Type', 'image/jpeg');
    c.header('Cache-Control', 'private, max-age=3600');
    c.header('X-Frame-Times', sheet.times.join(','));
    c.header('X-Grid', `${sheet.columns}x${sheet.rows}`);
    return c.body(new Uint8Array(sheet.bytes));
  } catch (err) {
    return c.json({ error: `Could not make the preview: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` }, 422);
  }
});

mediaRoutes.post('/api/uploads', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file too large' }, 400);
  const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  const isAudio = file.type.startsWith('audio/');
  if (!isVideo && !isImage && !isAudio) return c.json({ error: 'unsupported file type' }, 400);

  if (isAudio) {
    // Voice clips: always stored as 24 kHz mono WAV (what the voice engine clones from).
    const wav = await normalizeAudio(Buffer.from(await file.arrayBuffer()), path.extname(file.name).replace('.', '').toLowerCase());
    if (!wav) return c.json({ error: 'Could not read that audio file' }, 422);
    const asset = await saveAsset({ kind: 'audio', origin: 'upload', ext: 'wav', bytes: wav, projectId });
    return c.json(asset);
  }

  let buf: Buffer = Buffer.from(await file.arrayBuffer());
  let ext = (path.extname(file.name) || (isVideo ? '.mp4' : '.png')).replace('.', '').toLowerCase();
  if (isVideo) {
    // Normalize recordings (browser WebM, iPhone MOV/HEVC, …) to H.264/AAC MP4 so every browser can play
    // them and ComfyUI can read them. Caps: 30 s, 1080p on the long side.
    const converted = await normalizeVideo(buf, ext);
    if (converted) {
      buf = converted;
      ext = 'mp4';
    }
  }
  // saveAsset probes size/duration/fps and makes thumbnails (same path as generated media).
  const asset = await saveAsset({ kind: isVideo ? 'video' : 'image', origin: 'upload', ext, bytes: buf, projectId });
  emit({ type: 'asset', asset });
  return c.json(asset);
});

mediaRoutes.get('/api/assets', (c) => {
  const q = c.req.query();
  const result = assetsRepo.list({
    kind: q.kind,
    favorite: q.favorite === '1',
    projectId: q.projectId,
    shotId: q.shotId,
    q: q.q,
    cursor: q.cursor,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  return c.json(result);
});

mediaRoutes.get('/api/assets/:id', (c) => {
  const asset = assetsRepo.get(c.req.param('id'));
  if (!asset) return c.json({ error: 'not found' }, 404);
  return c.json(asset);
});

mediaRoutes.patch('/api/assets/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const updated = assetsRepo.update(c.req.param('id'), { favorite: Boolean(body.favorite) });
  if (!updated) return c.json({ error: 'not found' }, 404);
  emit({ type: 'asset', asset: updated });
  return c.json(updated);
});

mediaRoutes.delete('/api/assets/:id', async (c) => {
  const id = c.req.param('id');
  const asset = assetsRepo.get(id);
  if (!asset) return c.json({ error: 'not found' }, 404);
  const filePath = path.join(DATA_DIR, 'media', asset.file);
  await fsp.rm(filePath, { force: true }).catch(() => undefined);
  if (asset.thumb) await fsp.rm(path.join(DATA_DIR, 'media', asset.thumb), { force: true }).catch(() => undefined);
  assetsRepo.delete(id);
  emit({ type: 'asset_deleted', id });
  return c.json({ ok: true });
});

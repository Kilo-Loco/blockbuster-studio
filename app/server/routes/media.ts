import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { assets as assetsRepo, newId } from '../db';
import { DATA_DIR } from '../config';
import { emit } from '../events';
import { probeImageSize } from '../pipeline/media';
import { isAuthenticated } from '../auth';

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
    }[ext] ?? 'application/octet-stream'
  );
}

export const mediaRoutes = new Hono();

// /media/* requires auth (checked manually here since this router is mounted before the global
// auth middleware's public-path allowlist, which excludes /media/*).
mediaRoutes.get('/media/*', async (c) => {
  // Media paths are content-addressed by asset id and never rewritten, so let the browser keep them.
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  if (!isAuthenticated(c)) return c.json({ error: 'unauthorized' }, 401);
  const rel = decodeURIComponent(c.req.path.replace(/^\/media\//, ''));
  const filePath = path.join(DATA_DIR, 'media', rel);
  if (!filePath.startsWith(path.join(DATA_DIR, 'media'))) return c.json({ error: 'not found' }, 404);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return c.json({ error: 'not found' }, 404);
  }
  const contentType = contentTypeFor(filePath);
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
});

mediaRoutes.post('/api/uploads', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file too large' }, 400);
  const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) return c.json({ error: 'unsupported file type' }, 400);

  const buf = Buffer.from(await file.arrayBuffer());
  const id = newId();
  const d = new Date();
  const monthDir = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const ext = path.extname(file.name) || (isVideo ? '.mp4' : '.png');
  const dir = path.join(DATA_DIR, 'media', monthDir);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${id}${ext}`), buf);

  let width = 0;
  let height = 0;
  if (isImage) ({ width, height } = probeImageSize(buf));

  const asset = assetsRepo.create({
    id,
    kind: isVideo ? 'video' : 'image',
    origin: 'upload',
    file: path.join(monthDir, `${id}${ext}`),
    width,
    height,
    projectId,
    favorite: false,
  });
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

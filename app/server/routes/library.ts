import { Hono } from 'hono';
import { characters as charactersRepo, locations as locationsRepo, loras as lorasRepo, styles as stylesRepo } from '../db';
import { defaultLocationMap } from '../../shared/camera';
import { CHARACTER_COLORS } from '../../shared/presets';
import { emit } from '../events';
import { enqueue } from '../pipeline/queue';
import { assertPromptsAllowed } from '../pipeline/guard';
import { detectSourceFromUrl, parseImportUrl } from '../loras/import';
import type { LoraImportRequest, LoraTrainRequest } from '../../shared/types';

export const libraryRoutes = new Hono();

// ───────────────────────────── characters ─────────────────────────────

libraryRoutes.get('/api/characters', (c) => c.json(charactersRepo.list()));

libraryRoutes.post('/api/characters', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  assertPromptsAllowed(body.description);
  const existing = charactersRepo.list().length;
  const color = body.color ?? CHARACTER_COLORS[existing % CHARACTER_COLORS.length];
  const character = charactersRepo.create({ ...body, color });
  emit({ type: 'character', character });
  return c.json(character);
});

libraryRoutes.get('/api/characters/:id', (c) => {
  const character = charactersRepo.get(c.req.param('id'));
  if (!character) return c.json({ error: 'not found' }, 404);
  return c.json(character);
});

libraryRoutes.patch('/api/characters/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.description) assertPromptsAllowed(body.description);
  const updated = charactersRepo.update(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'not found' }, 404);
  emit({ type: 'character', character: updated });
  return c.json(updated);
});

libraryRoutes.delete('/api/characters/:id', (c) => {
  charactersRepo.delete(c.req.param('id'));
  return c.json({ ok: true });
});

libraryRoutes.post('/api/characters/:id/references', async (c) => {
  const id = c.req.param('id');
  const character = charactersRepo.get(id);
  if (!character) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const job = enqueue({
    type: 'character_refs',
    title: `Reference sheet: ${character.name}`,
    params: { characterId: id, count: body.count ?? 4, prompt: body.prompt, aspect: '1:1' },
  });
  return c.json(job);
});

// ───────────────────────────── locations ─────────────────────────────

libraryRoutes.get('/api/locations', (c) => c.json(locationsRepo.list()));

libraryRoutes.post('/api/locations', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  assertPromptsAllowed(body.description);
  const location = locationsRepo.create({ ...body, map: body.map ?? defaultLocationMap() });
  emit({ type: 'location', location });
  return c.json(location);
});

libraryRoutes.get('/api/locations/:id', (c) => {
  const location = locationsRepo.get(c.req.param('id'));
  if (!location) return c.json({ error: 'not found' }, 404);
  return c.json(location);
});

libraryRoutes.patch('/api/locations/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.description) assertPromptsAllowed(body.description);
  const updated = locationsRepo.update(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'not found' }, 404);
  emit({ type: 'location', location: updated });
  return c.json(updated);
});

libraryRoutes.delete('/api/locations/:id', (c) => {
  locationsRepo.delete(c.req.param('id'));
  return c.json({ ok: true });
});

libraryRoutes.post('/api/locations/:id/establishing', async (c) => {
  const id = c.req.param('id');
  const location = locationsRepo.get(id);
  if (!location) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const job = enqueue({
    type: 'location_establishing',
    title: `Establishing shot: ${location.name}`,
    params: { locationId: id, prompt: body.prompt, aspect: body.aspect ?? '16:9' },
  });
  return c.json(job);
});

libraryRoutes.post('/api/locations/:id/angles', async (c) => {
  const id = c.req.param('id');
  const location = locationsRepo.get(id);
  if (!location) return c.json({ error: 'not found' }, 404);
  if (!location.establishingAssetId) return c.json({ error: 'location has no establishing image' }, 400);
  const body = await c.req.json().catch(() => ({}));
  if (!body.angle) return c.json({ error: 'missing angle' }, 400);
  const job = enqueue({
    type: 'location_angle',
    title: `Angle view: ${location.name}`,
    params: { locationId: id, angle: body.angle },
  });
  return c.json(job);
});

// ───────────────────────────── styles ─────────────────────────────

libraryRoutes.get('/api/styles', (c) => c.json(stylesRepo.list()));

libraryRoutes.post('/api/styles', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const style = stylesRepo.create(body);
  return c.json(style);
});

libraryRoutes.get('/api/styles/:id', (c) => {
  const style = stylesRepo.get(c.req.param('id'));
  if (!style) return c.json({ error: 'not found' }, 404);
  return c.json(style);
});

libraryRoutes.patch('/api/styles/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const updated = stylesRepo.update(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

libraryRoutes.delete('/api/styles/:id', (c) => {
  stylesRepo.delete(c.req.param('id'));
  return c.json({ ok: true });
});

// ───────────────────────────── loras ─────────────────────────────

libraryRoutes.get('/api/loras', (c) => {
  const family = c.req.query('family');
  const all = lorasRepo.list(family);
  // Bundled speed LoRAs (lightning, angles) are not user-manageable; hide them.
  return c.json(all.filter((l) => l.source !== 'bundled'));
});

libraryRoutes.post('/api/loras/import', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as LoraImportRequest;
  if (!body.url) return c.json({ error: 'missing url' }, 400);
  // parseImportUrl only resolves the source + (for Civitai) which id the URL pins; the actual
  // baseModel → family mapping happens inside the lora_download runner once it has fetched the
  // Civitai/HF metadata, and patches the Lora row's family after the fact if it differs.
  parseImportUrl(body.url);
  const source = detectSourceFromUrl(body.url);
  const lora = lorasRepo.create({
    name: body.name ?? 'Imported LoRA',
    filename: '',
    family: body.family ?? 'zimage',
    kind: body.kind ?? 'other',
    source,
    sourceUrl: body.url,
    status: 'downloading',
  });
  emit({ type: 'lora', lora });
  enqueue({
    type: 'lora_download',
    title: `Download LoRA: ${lora.name}`,
    params: { loraId: lora.id, url: body.url, family: body.family, kind: body.kind },
  });
  return c.json(lora);
});

libraryRoutes.post('/api/loras/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);
  const { MODELS_DIR } = await import('../config');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const family = typeof body.family === 'string' ? body.family : 'zimage';
  const kind = typeof body.kind === 'string' ? body.kind : 'other';
  const name = typeof body.name === 'string' ? body.name : file.name;
  const triggerWord = typeof body.triggerWord === 'string' ? body.triggerWord : undefined;
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(MODELS_DIR, 'loras');
  await fs.mkdir(dir, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, safeName), buf);
  const lora = lorasRepo.create({
    name,
    filename: safeName,
    family: family as never,
    kind: kind as never,
    triggerWord,
    source: 'upload',
    status: 'ready',
    sizeBytes: buf.length,
  });
  emit({ type: 'lora', lora });
  return c.json(lora);
});

libraryRoutes.post('/api/loras/train', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as LoraTrainRequest;
  if (!body.name || !body.triggerWord || !body.assetIds?.length) return c.json({ error: 'missing required fields' }, 400);
  assertPromptsAllowed(body.description, body.triggerWord);
  const job = enqueue({ type: 'lora_train', title: `Train LoRA: ${body.name}`, params: { ...body } });
  return c.json(job);
});

libraryRoutes.patch('/api/loras/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const updated = lorasRepo.update(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'not found' }, 404);
  emit({ type: 'lora', lora: updated });
  return c.json(updated);
});

libraryRoutes.delete('/api/loras/:id', (c) => {
  lorasRepo.delete(c.req.param('id'));
  return c.json({ ok: true });
});

// Bulk downloads: stream a ZIP of gallery assets or a whole project straight from the pod.
//
// Flow: POST creates a short-lived token for the requested set (so the browser can then use a plain
// <a href download> and its native download manager), GET /api/downloads/:token streams the ZIP.
// Streaming starts immediately, so large archives never hit the Runpod proxy's ~100 s
// time-to-first-byte limit. Media is already compressed, so entries are stored, not deflated.

import fs from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { Hono } from 'hono';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import {
  assets as assetsRepo,
  characters as charactersRepo,
  locations as locationsRepo,
  projects as projectsRepo,
  scenes as scenesRepo,
  shots as shotsRepo,
  newId,
} from '../db';
import { DATA_DIR } from '../config';
import type { Asset, ID } from '../../shared/types';

interface ZipEntry {
  /** Absolute file on disk. */
  src?: string;
  /** Inline content (e.g. project.json). */
  content?: string;
  /** Path inside the archive. */
  name: string;
}

interface PendingDownload {
  filename: string;
  entries: ZipEntry[];
  expires: number;
}

const TOKEN_TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, PendingDownload>();

function prune() {
  const t = Date.now();
  for (const [k, v] of pending) if (v.expires < t) pending.delete(k);
}

const slug = (s: string, max = 40) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'untitled';

const pad2 = (n: number) => String(n).padStart(2, '0');
const ext = (a: Asset) => path.extname(a.file) || (a.kind === 'video' ? '.mp4' : '.png');
const diskPath = (a: Asset) => path.join(DATA_DIR, 'media', a.file);

/** Unique, human-readable names: 2026-09-24_zimage_neon-ramen-bar_AbC123.png */
function galleryName(a: Asset): string {
  const date = a.createdAt.slice(0, 10);
  const what = a.prompt ? slug(a.prompt) : a.origin;
  return `${date}_${a.engine ?? a.origin}_${what}_${a.id}${ext(a)}`;
}

function register(filename: string, entries: ZipEntry[]): string {
  prune();
  const token = newId() + newId();
  pending.set(token, { filename, entries, expires: Date.now() + TOKEN_TTL_MS });
  return `/api/downloads/${token}`;
}

function projectEntries(projectId: ID): { name: string; entries: ZipEntry[] } | undefined {
  const project = projectsRepo.get(projectId);
  if (!project) return undefined;
  const entries: ZipEntry[] = [];
  const seenAssets = new Set<ID>();
  const add = (id: ID | undefined, name: string) => {
    if (!id || seenAssets.has(`${id}:${name}`)) return;
    const a = assetsRepo.get(id);
    if (!a || !fs.existsSync(diskPath(a))) return;
    seenAssets.add(`${id}:${name}`);
    entries.push({ src: diskPath(a), name: `${name}${ext(a)}` });
  };

  if (project.exportAssetId) add(project.exportAssetId, `00-final-cut/${slug(project.name)}`);

  const scenes = scenesRepo.listByProject(projectId);
  const castIds = new Set<ID>();
  const locationIds = new Set<ID>();
  const storyboard = scenes.map((scene, si) => {
    const dir = `${pad2(si + 1)}-${slug(scene.title || `scene-${si + 1}`)}`;
    if (scene.locationId) locationIds.add(scene.locationId);
    const shots = shotsRepo.listByScene(scene.id);
    shots.forEach((shot, hi) => {
      const base = `${dir}/shot-${pad2(hi + 1)}`;
      add(shot.videoAssetId, base);
      add(shot.keyframeAssetId, `${base}-keyframe`);
      shot.characterIds.forEach((c) => castIds.add(c));
    });
    return { ...scene, shots };
  });

  for (const id of castIds) {
    const c = charactersRepo.get(id);
    if (!c) continue;
    c.referenceAssetIds.forEach((refId, i) => add(refId, `cast/${slug(c.name)}/reference-${pad2(i + 1)}`));
  }
  for (const id of locationIds) {
    const l = locationsRepo.get(id);
    if (!l) continue;
    add(l.establishingAssetId, `locations/${slug(l.name)}/establishing`);
    l.angleViews.forEach((v) => add(v.assetId, `locations/${slug(l.name)}/angle-${slug(v.key.replace(/\|/g, ' '))}`));
  }

  entries.push({
    name: 'project.json',
    content: JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        project,
        scenes: storyboard,
        characters: [...castIds].map((id) => charactersRepo.get(id)).filter(Boolean),
        locations: [...locationIds].map((id) => locationsRepo.get(id)).filter(Boolean),
      },
      null,
      2,
    ),
  });
  return { name: `${slug(project.name)}-backup`, entries };
}

export const downloadRoutes = new Hono();

/** Body: { assetIds } for a selection, or { all: true } for the whole library. */
downloadRoutes.post('/api/downloads', async (c) => {
  const body = z
    .object({ assetIds: z.array(z.string()).max(5000).optional(), all: z.boolean().optional() })
    .parse(await c.req.json().catch(() => ({})));
  let list: Asset[];
  if (body.all) {
    list = [];
    let cursor: string | undefined;
    do {
      const page = assetsRepo.list({ cursor, limit: 500 });
      list.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
  } else {
    list = (body.assetIds ?? []).map((id) => assetsRepo.get(id)).filter((a): a is Asset => Boolean(a));
  }
  const entries = list.filter((a) => fs.existsSync(diskPath(a))).map((a) => ({ src: diskPath(a), name: galleryName(a) }));
  if (!entries.length) return c.json({ error: 'Nothing to download.' }, 400);
  const stamp = new Date().toISOString().slice(0, 10);
  return c.json({ url: register(`blockbuster-${body.all ? 'library' : 'selection'}-${stamp}.zip`, entries), count: entries.length });
});

downloadRoutes.post('/api/projects/:id/backup', (c) => {
  const found = projectEntries(c.req.param('id'));
  if (!found) return c.json({ error: 'project not found' }, 404);
  return c.json({ url: register(`${found.name}.zip`, found.entries), count: found.entries.length });
});

downloadRoutes.get('/api/downloads/:token', (c) => {
  prune();
  const job = pending.get(c.req.param('token'));
  if (!job) return c.json({ error: 'This download link expired. Start the download again.' }, 404);
  pending.delete(c.req.param('token'));

  const archive = new ZipArchive({ store: true });
  const out = new PassThrough();
  archive.on('warning', (err: Error) => console.warn('[zip]', err.message));
  archive.on('error', (err: Error) => out.destroy(err));
  archive.pipe(out);
  for (const e of job.entries) {
    if (e.content !== undefined) archive.append(e.content, { name: e.name });
    else if (e.src) archive.file(e.src, { name: e.name });
  }
  void archive.finalize();

  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="${job.filename}"`);
  c.header('Cache-Control', 'no-store');
  return c.body(Readable.toWeb(out) as ReadableStream);
});

// SQLite storage (better-sqlite3, WAL). Nested objects are stored as JSON text columns.
// Small typed repo functions; migrations via PRAGMA user_version.
import path from 'node:path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { DATA_DIR } from './config';
import type {
  Asset,
  Character,
  ID,
  ISODate,
  Job,
  Location,
  Lora,
  Project,
  Scene,
  Settings,
  Shot,
  Style,
} from '../shared/types';

export const dbPath = path.join(DATA_DIR, 'studio.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const now = (): ISODate => new Date().toISOString();
export const newId = (): ID => nanoid(12);

const CURRENT_VERSION = 1;

function migrate() {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= CURRENT_VERSION) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL,
      file TEXT NOT NULL,
      thumb TEXT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      durationSec REAL,
      fps REAL,
      prompt TEXT,
      engine TEXT,
      params TEXT,
      jobId TEXT,
      projectId TEXT,
      shotId TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assets_createdAt ON assets(createdAt);
    CREATE INDEX IF NOT EXISTS idx_assets_projectId ON assets(projectId);
    CREATE INDEX IF NOT EXISTS idx_assets_shotId ON assets(shotId);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      stage TEXT,
      title TEXT NOT NULL,
      params TEXT NOT NULL,
      outputAssetIds TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      projectId TEXT,
      shotId TEXT,
      queuePosition INTEGER,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      finishedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_createdAt ON jobs(createdAt);

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      referenceAssetIds TEXT NOT NULL DEFAULT '[]',
      loraId TEXT,
      triggerWord TEXT,
      color TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      establishingAssetId TEXT,
      map TEXT NOT NULL,
      angleViews TEXT NOT NULL DEFAULT '[]',
      loraId TEXT,
      triggerWord TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS styles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      negativePrompt TEXT,
      loraId TEXT,
      loraStrength REAL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loras (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      family TEXT NOT NULL,
      kind TEXT NOT NULL,
      triggerWord TEXT,
      defaultStrength REAL NOT NULL DEFAULT 1,
      source TEXT NOT NULL,
      sourceUrl TEXT,
      previewAssetId TEXT,
      status TEXT NOT NULL,
      error TEXT,
      sizeBytes INTEGER,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logline TEXT NOT NULL DEFAULT '',
      aspect TEXT NOT NULL,
      styleId TEXT,
      script TEXT NOT NULL DEFAULT '',
      coverAssetId TEXT,
      exportAssetId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      locationId TEXT,
      timeOfDay TEXT NOT NULL,
      blocking TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scenes_projectId ON scenes(projectId);

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY,
      sceneId TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      action TEXT NOT NULL DEFAULT '',
      dialogue TEXT,
      shotSize TEXT NOT NULL,
      cameraMove TEXT NOT NULL,
      elevation TEXT,
      camera TEXT NOT NULL,
      characterIds TEXT NOT NULL DEFAULT '[]',
      blocking TEXT,
      durationSec REAL NOT NULL DEFAULT 5,
      keyframePrompt TEXT,
      motionPrompt TEXT,
      keyframeMode TEXT NOT NULL DEFAULT 'auto',
      loras TEXT,
      seed INTEGER,
      keyframeAssetId TEXT,
      keyframeCandidates TEXT NOT NULL DEFAULT '[]',
      videoAssetId TEXT,
      videoCandidates TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      error TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shots_sceneId ON shots(sceneId);

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.pragma(`user_version = ${CURRENT_VERSION}`);
}
migrate();

// ───────────────────────────── helpers ─────────────────────────────

const j = (v: unknown) => JSON.stringify(v ?? null);
const parseJ = <T>(s: string | null | undefined, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback);
const bool = (n: number) => n === 1;

// ───────────────────────────── assets ─────────────────────────────

function rowToAsset(r: any): Asset {
  return {
    id: r.id,
    kind: r.kind,
    origin: r.origin,
    file: r.file,
    thumb: r.thumb ?? undefined,
    width: r.width,
    height: r.height,
    durationSec: r.durationSec ?? undefined,
    fps: r.fps ?? undefined,
    prompt: r.prompt ?? undefined,
    engine: r.engine ?? undefined,
    params: r.params ? parseJ(r.params, {}) : undefined,
    jobId: r.jobId ?? undefined,
    projectId: r.projectId ?? undefined,
    shotId: r.shotId ?? undefined,
    favorite: bool(r.favorite),
    createdAt: r.createdAt,
  };
}

export const assets = {
  create(a: Omit<Asset, 'id' | 'createdAt' | 'favorite'> & { id?: ID; favorite?: boolean }): Asset {
    const id = a.id ?? newId();
    const createdAt = now();
    db.prepare(
      `INSERT INTO assets (id, kind, origin, file, thumb, width, height, durationSec, fps, prompt, engine, params, jobId, projectId, shotId, favorite, createdAt)
       VALUES (@id,@kind,@origin,@file,@thumb,@width,@height,@durationSec,@fps,@prompt,@engine,@params,@jobId,@projectId,@shotId,@favorite,@createdAt)`,
    ).run({
      id,
      kind: a.kind,
      origin: a.origin,
      file: a.file,
      thumb: a.thumb ?? null,
      width: a.width,
      height: a.height,
      durationSec: a.durationSec ?? null,
      fps: a.fps ?? null,
      prompt: a.prompt ?? null,
      engine: a.engine ?? null,
      params: j(a.params),
      jobId: a.jobId ?? null,
      projectId: a.projectId ?? null,
      shotId: a.shotId ?? null,
      favorite: a.favorite ? 1 : 0,
      createdAt,
    });
    return assets.get(id)!;
  },
  get(id: ID): Asset | undefined {
    const r = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    return r ? rowToAsset(r) : undefined;
  },
  update(id: ID, patch: Partial<Pick<Asset, 'favorite' | 'thumb'>>): Asset | undefined {
    if (patch.favorite !== undefined) {
      db.prepare('UPDATE assets SET favorite = ? WHERE id = ?').run(patch.favorite ? 1 : 0, id);
    }
    if (patch.thumb !== undefined) {
      db.prepare('UPDATE assets SET thumb = ? WHERE id = ?').run(patch.thumb, id);
    }
    return assets.get(id);
  },
  delete(id: ID) {
    db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  },
  listImagesWithoutThumb(limit = 500): Asset[] {
    return db.prepare("SELECT * FROM assets WHERE kind = 'image' AND thumb IS NULL LIMIT ?").all(limit).map(rowToAsset);
  },
  list(opts: { kind?: string; favorite?: boolean; projectId?: string; shotId?: string; q?: string; cursor?: string; limit?: number }): {
    items: Asset[];
    nextCursor?: string;
  } {
    const limit = opts.limit ?? 60;
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.kind) {
      where.push('kind = @kind');
      params.kind = opts.kind;
    }
    if (opts.favorite) {
      where.push('favorite = 1');
    }
    if (opts.projectId) {
      where.push('projectId = @projectId');
      params.projectId = opts.projectId;
    }
    if (opts.shotId) {
      where.push('shotId = @shotId');
      params.shotId = opts.shotId;
    }
    if (opts.q) {
      where.push('prompt LIKE @q');
      params.q = `%${opts.q}%`;
    }
    if (opts.cursor) {
      where.push('createdAt < @cursor');
      params.cursor = opts.cursor;
    }
    const sql = `SELECT * FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY createdAt DESC LIMIT @limit`;
    const rows = db.prepare(sql).all({ ...params, limit: limit + 1 }) as any[];
    const items = rows.slice(0, limit).map(rowToAsset);
    const nextCursor = rows.length > limit ? items[items.length - 1]?.createdAt : undefined;
    return { items, nextCursor };
  },
};

// ───────────────────────────── jobs ─────────────────────────────

function rowToJob(r: any): Job {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    progress: r.progress,
    stage: r.stage ?? undefined,
    title: r.title,
    params: parseJ(r.params, {}),
    outputAssetIds: parseJ(r.outputAssetIds, []),
    error: r.error ?? undefined,
    projectId: r.projectId ?? undefined,
    shotId: r.shotId ?? undefined,
    queuePosition: r.queuePosition ?? undefined,
    createdAt: r.createdAt,
    startedAt: r.startedAt ?? undefined,
    finishedAt: r.finishedAt ?? undefined,
  };
}

export const jobs = {
  create(j0: Omit<Job, 'id' | 'createdAt' | 'progress' | 'status' | 'outputAssetIds'> & Partial<Pick<Job, 'status' | 'progress' | 'outputAssetIds'>>): Job {
    const id = newId();
    const createdAt = now();
    db.prepare(
      `INSERT INTO jobs (id, type, status, progress, stage, title, params, outputAssetIds, error, projectId, shotId, queuePosition, createdAt, startedAt, finishedAt)
       VALUES (@id,@type,@status,@progress,@stage,@title,@params,@outputAssetIds,@error,@projectId,@shotId,@queuePosition,@createdAt,@startedAt,@finishedAt)`,
    ).run({
      id,
      type: j0.type,
      status: j0.status ?? 'queued',
      progress: j0.progress ?? 0,
      stage: j0.stage ?? null,
      title: j0.title,
      params: j(j0.params),
      outputAssetIds: j(j0.outputAssetIds ?? []),
      error: j0.error ?? null,
      projectId: j0.projectId ?? null,
      shotId: j0.shotId ?? null,
      queuePosition: j0.queuePosition ?? null,
      createdAt,
      startedAt: null,
      finishedAt: null,
    });
    return jobs.get(id)!;
  },
  get(id: ID): Job | undefined {
    const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return r ? rowToJob(r) : undefined;
  },
  update(id: ID, patch: Partial<Job>): Job | undefined {
    const cur = jobs.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    db.prepare(
      `UPDATE jobs SET status=@status, progress=@progress, stage=@stage, title=@title, params=@params, outputAssetIds=@outputAssetIds,
       error=@error, queuePosition=@queuePosition, startedAt=@startedAt, finishedAt=@finishedAt WHERE id=@id`,
    ).run({
      id,
      status: next.status,
      progress: next.progress,
      stage: next.stage ?? null,
      title: next.title,
      params: j(next.params),
      outputAssetIds: j(next.outputAssetIds),
      error: next.error ?? null,
      queuePosition: next.queuePosition ?? null,
      startedAt: next.startedAt ?? null,
      finishedAt: next.finishedAt ?? null,
    });
    return jobs.get(id);
  },
  list(opts: { active?: boolean; limit?: number }): Job[] {
    if (opts.active) {
      const rows = db.prepare(`SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY createdAt ASC`).all() as any[];
      return rows.map(rowToJob);
    }
    const limit = opts.limit ?? 100;
    const rows = db.prepare(`SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?`).all(limit) as any[];
    return rows.map(rowToJob);
  },
  listByStatus(status: string): Job[] {
    const rows = db.prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY createdAt ASC`).all(status) as any[];
    return rows.map(rowToJob);
  },
};

// ───────────────────────────── characters ─────────────────────────────

function rowToCharacter(r: any): Character {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    referenceAssetIds: parseJ(r.referenceAssetIds, []),
    loraId: r.loraId ?? undefined,
    triggerWord: r.triggerWord ?? undefined,
    color: r.color,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const characters = {
  create(c: Partial<Character>): Character {
    const id = c.id ?? newId();
    const t = now();
    db.prepare(
      `INSERT INTO characters (id,name,description,referenceAssetIds,loraId,triggerWord,color,createdAt,updatedAt)
       VALUES (@id,@name,@description,@referenceAssetIds,@loraId,@triggerWord,@color,@createdAt,@updatedAt)`,
    ).run({
      id,
      name: c.name ?? 'Unnamed',
      description: c.description ?? '',
      referenceAssetIds: j(c.referenceAssetIds ?? []),
      loraId: c.loraId ?? null,
      triggerWord: c.triggerWord ?? null,
      color: c.color ?? '#f5a524',
      createdAt: t,
      updatedAt: t,
    });
    return characters.get(id)!;
  },
  get(id: ID): Character | undefined {
    const r = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    return r ? rowToCharacter(r) : undefined;
  },
  list(): Character[] {
    return (db.prepare('SELECT * FROM characters ORDER BY createdAt ASC').all() as any[]).map(rowToCharacter);
  },
  update(id: ID, patch: Partial<Character>): Character | undefined {
    const cur = characters.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: now() };
    db.prepare(
      `UPDATE characters SET name=@name, description=@description, referenceAssetIds=@referenceAssetIds, loraId=@loraId, triggerWord=@triggerWord, color=@color, updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      name: next.name,
      description: next.description,
      referenceAssetIds: j(next.referenceAssetIds),
      loraId: next.loraId ?? null,
      triggerWord: next.triggerWord ?? null,
      color: next.color,
      updatedAt: next.updatedAt,
    });
    return characters.get(id);
  },
  delete(id: ID) {
    db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  },
};

// ───────────────────────────── locations ─────────────────────────────

function rowToLocation(r: any): Location {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    establishingAssetId: r.establishingAssetId ?? undefined,
    map: parseJ(r.map, {} as any),
    angleViews: parseJ(r.angleViews, []),
    loraId: r.loraId ?? undefined,
    triggerWord: r.triggerWord ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const locations = {
  create(l: Partial<Location> & { map: Location['map'] }): Location {
    const id = l.id ?? newId();
    const t = now();
    db.prepare(
      `INSERT INTO locations (id,name,description,establishingAssetId,map,angleViews,loraId,triggerWord,createdAt,updatedAt)
       VALUES (@id,@name,@description,@establishingAssetId,@map,@angleViews,@loraId,@triggerWord,@createdAt,@updatedAt)`,
    ).run({
      id,
      name: l.name ?? 'Unnamed location',
      description: l.description ?? '',
      establishingAssetId: l.establishingAssetId ?? null,
      map: j(l.map),
      angleViews: j(l.angleViews ?? []),
      loraId: l.loraId ?? null,
      triggerWord: l.triggerWord ?? null,
      createdAt: t,
      updatedAt: t,
    });
    return locations.get(id)!;
  },
  get(id: ID): Location | undefined {
    const r = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
    return r ? rowToLocation(r) : undefined;
  },
  list(): Location[] {
    return (db.prepare('SELECT * FROM locations ORDER BY createdAt ASC').all() as any[]).map(rowToLocation);
  },
  update(id: ID, patch: Partial<Location>): Location | undefined {
    const cur = locations.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: now() };
    db.prepare(
      `UPDATE locations SET name=@name, description=@description, establishingAssetId=@establishingAssetId, map=@map, angleViews=@angleViews, loraId=@loraId, triggerWord=@triggerWord, updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      name: next.name,
      description: next.description,
      establishingAssetId: next.establishingAssetId ?? null,
      map: j(next.map),
      angleViews: j(next.angleViews),
      loraId: next.loraId ?? null,
      triggerWord: next.triggerWord ?? null,
      updatedAt: next.updatedAt,
    });
    return locations.get(id);
  },
  delete(id: ID) {
    db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  },
};

// ───────────────────────────── styles ─────────────────────────────

function rowToStyle(r: any): Style {
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    negativePrompt: r.negativePrompt ?? undefined,
    loraId: r.loraId ?? undefined,
    loraStrength: r.loraStrength ?? undefined,
    createdAt: r.createdAt,
  };
}

export const styles = {
  create(s: Partial<Style>): Style {
    const id = s.id ?? newId();
    const t = now();
    db.prepare(
      `INSERT INTO styles (id,name,prompt,negativePrompt,loraId,loraStrength,createdAt) VALUES (@id,@name,@prompt,@negativePrompt,@loraId,@loraStrength,@createdAt)`,
    ).run({
      id,
      name: s.name ?? 'Untitled style',
      prompt: s.prompt ?? '',
      negativePrompt: s.negativePrompt ?? null,
      loraId: s.loraId ?? null,
      loraStrength: s.loraStrength ?? null,
      createdAt: t,
    });
    return styles.get(id)!;
  },
  get(id: ID): Style | undefined {
    const r = db.prepare('SELECT * FROM styles WHERE id = ?').get(id);
    return r ? rowToStyle(r) : undefined;
  },
  list(): Style[] {
    return (db.prepare('SELECT * FROM styles ORDER BY createdAt ASC').all() as any[]).map(rowToStyle);
  },
  update(id: ID, patch: Partial<Style>): Style | undefined {
    const cur = styles.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    db.prepare(
      `UPDATE styles SET name=@name, prompt=@prompt, negativePrompt=@negativePrompt, loraId=@loraId, loraStrength=@loraStrength WHERE id=@id`,
    ).run({
      id,
      name: next.name,
      prompt: next.prompt,
      negativePrompt: next.negativePrompt ?? null,
      loraId: next.loraId ?? null,
      loraStrength: next.loraStrength ?? null,
    });
    return styles.get(id);
  },
  delete(id: ID) {
    db.prepare('DELETE FROM styles WHERE id = ?').run(id);
  },
};

// ───────────────────────────── loras ─────────────────────────────

function rowToLora(r: any): Lora {
  return {
    id: r.id,
    name: r.name,
    filename: r.filename,
    family: r.family,
    kind: r.kind,
    triggerWord: r.triggerWord ?? undefined,
    defaultStrength: r.defaultStrength,
    source: r.source,
    sourceUrl: r.sourceUrl ?? undefined,
    previewAssetId: r.previewAssetId ?? undefined,
    status: r.status,
    error: r.error ?? undefined,
    sizeBytes: r.sizeBytes ?? undefined,
    createdAt: r.createdAt,
  };
}

export const loras = {
  create(l: Partial<Lora>): Lora {
    const id = l.id ?? newId();
    const t = now();
    db.prepare(
      `INSERT INTO loras (id,name,filename,family,kind,triggerWord,defaultStrength,source,sourceUrl,previewAssetId,status,error,sizeBytes,createdAt)
       VALUES (@id,@name,@filename,@family,@kind,@triggerWord,@defaultStrength,@source,@sourceUrl,@previewAssetId,@status,@error,@sizeBytes,@createdAt)`,
    ).run({
      id,
      name: l.name ?? 'Untitled LoRA',
      filename: l.filename ?? '',
      family: l.family ?? 'zimage',
      kind: l.kind ?? 'other',
      triggerWord: l.triggerWord ?? null,
      defaultStrength: l.defaultStrength ?? 1,
      source: l.source ?? 'upload',
      sourceUrl: l.sourceUrl ?? null,
      previewAssetId: l.previewAssetId ?? null,
      status: l.status ?? 'ready',
      error: l.error ?? null,
      sizeBytes: l.sizeBytes ?? null,
      createdAt: t,
    });
    return loras.get(id)!;
  },
  get(id: ID): Lora | undefined {
    const r = db.prepare('SELECT * FROM loras WHERE id = ?').get(id);
    return r ? rowToLora(r) : undefined;
  },
  list(family?: string): Lora[] {
    const rows = family
      ? (db.prepare('SELECT * FROM loras WHERE family = ? ORDER BY createdAt DESC').all(family) as any[])
      : (db.prepare('SELECT * FROM loras ORDER BY createdAt DESC').all() as any[]);
    return rows.map(rowToLora);
  },
  update(id: ID, patch: Partial<Lora>): Lora | undefined {
    const cur = loras.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    db.prepare(
      `UPDATE loras SET name=@name, filename=@filename, family=@family, kind=@kind, triggerWord=@triggerWord, defaultStrength=@defaultStrength,
       source=@source, sourceUrl=@sourceUrl, previewAssetId=@previewAssetId, status=@status, error=@error, sizeBytes=@sizeBytes WHERE id=@id`,
    ).run({
      id,
      name: next.name,
      filename: next.filename,
      family: next.family,
      kind: next.kind,
      triggerWord: next.triggerWord ?? null,
      defaultStrength: next.defaultStrength,
      source: next.source,
      sourceUrl: next.sourceUrl ?? null,
      previewAssetId: next.previewAssetId ?? null,
      status: next.status,
      error: next.error ?? null,
      sizeBytes: next.sizeBytes ?? null,
    });
    return loras.get(id);
  },
  delete(id: ID) {
    db.prepare('DELETE FROM loras WHERE id = ?').run(id);
  },
};

// ───────────────────────────── projects / scenes / shots ─────────────────────────────

function rowToProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    logline: r.logline,
    aspect: r.aspect,
    styleId: r.styleId ?? undefined,
    script: r.script,
    coverAssetId: r.coverAssetId ?? undefined,
    exportAssetId: r.exportAssetId ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const projects = {
  create(p: Partial<Project>): Project {
    const id = p.id ?? newId();
    const t = now();
    db.prepare(
      `INSERT INTO projects (id,name,logline,aspect,styleId,script,coverAssetId,exportAssetId,createdAt,updatedAt)
       VALUES (@id,@name,@logline,@aspect,@styleId,@script,@coverAssetId,@exportAssetId,@createdAt,@updatedAt)`,
    ).run({
      id,
      name: p.name ?? 'Untitled project',
      logline: p.logline ?? '',
      aspect: p.aspect ?? '16:9',
      styleId: p.styleId ?? null,
      script: p.script ?? '',
      coverAssetId: p.coverAssetId ?? null,
      exportAssetId: p.exportAssetId ?? null,
      createdAt: t,
      updatedAt: t,
    });
    return projects.get(id)!;
  },
  get(id: ID): Project | undefined {
    const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return r ? rowToProject(r) : undefined;
  },
  list(): Project[] {
    return (db.prepare('SELECT * FROM projects ORDER BY createdAt DESC').all() as any[]).map(rowToProject);
  },
  update(id: ID, patch: Partial<Project>): Project | undefined {
    const cur = projects.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: now() };
    db.prepare(
      `UPDATE projects SET name=@name, logline=@logline, aspect=@aspect, styleId=@styleId, script=@script, coverAssetId=@coverAssetId, exportAssetId=@exportAssetId, updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      name: next.name,
      logline: next.logline,
      aspect: next.aspect,
      styleId: next.styleId ?? null,
      script: next.script,
      coverAssetId: next.coverAssetId ?? null,
      exportAssetId: next.exportAssetId ?? null,
      updatedAt: next.updatedAt,
    });
    return projects.get(id);
  },
  delete(id: ID) {
    const sceneIds = (db.prepare('SELECT id FROM scenes WHERE projectId = ?').all(id) as any[]).map((r) => r.id);
    for (const sid of sceneIds) db.prepare('DELETE FROM shots WHERE sceneId = ?').run(sid);
    db.prepare('DELETE FROM scenes WHERE projectId = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  },
};

function rowToScene(r: any): Scene {
  return {
    id: r.id,
    projectId: r.projectId,
    order: r.order,
    title: r.title,
    description: r.description,
    locationId: r.locationId ?? undefined,
    timeOfDay: r.timeOfDay,
    blocking: parseJ(r.blocking, []),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const scenes = {
  create(s: Partial<Scene> & { projectId: ID }): Scene {
    const id = s.id ?? newId();
    const t = now();
    const maxOrder = (db.prepare('SELECT MAX("order") as m FROM scenes WHERE projectId = ?').get(s.projectId) as any)?.m ?? -1;
    db.prepare(
      `INSERT INTO scenes (id,projectId,"order",title,description,locationId,timeOfDay,blocking,createdAt,updatedAt)
       VALUES (@id,@projectId,@order,@title,@description,@locationId,@timeOfDay,@blocking,@createdAt,@updatedAt)`,
    ).run({
      id,
      projectId: s.projectId,
      order: s.order ?? maxOrder + 1,
      title: s.title ?? 'New scene',
      description: s.description ?? '',
      locationId: s.locationId ?? null,
      timeOfDay: s.timeOfDay ?? 'day',
      blocking: j(s.blocking ?? []),
      createdAt: t,
      updatedAt: t,
    });
    return scenes.get(id)!;
  },
  get(id: ID): Scene | undefined {
    const r = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id);
    return r ? rowToScene(r) : undefined;
  },
  listByProject(projectId: ID): Scene[] {
    return (db.prepare('SELECT * FROM scenes WHERE projectId = ? ORDER BY "order" ASC').all(projectId) as any[]).map(rowToScene);
  },
  update(id: ID, patch: Partial<Scene>): Scene | undefined {
    const cur = scenes.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: now() };
    db.prepare(
      `UPDATE scenes SET "order"=@order, title=@title, description=@description, locationId=@locationId, timeOfDay=@timeOfDay, blocking=@blocking, updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      order: next.order,
      title: next.title,
      description: next.description,
      locationId: next.locationId ?? null,
      timeOfDay: next.timeOfDay,
      blocking: j(next.blocking),
      updatedAt: next.updatedAt,
    });
    return scenes.get(id);
  },
  delete(id: ID) {
    db.prepare('DELETE FROM shots WHERE sceneId = ?').run(id);
    db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
  },
  reorder(projectId: ID, sceneIds: ID[]) {
    const stmt = db.prepare('UPDATE scenes SET "order" = ? WHERE id = ? AND projectId = ?');
    sceneIds.forEach((id, i) => stmt.run(i, id, projectId));
  },
};

function rowToShot(r: any): Shot {
  return {
    id: r.id,
    sceneId: r.sceneId,
    order: r.order,
    action: r.action,
    dialogue: r.dialogue ?? undefined,
    shotSize: r.shotSize,
    cameraMove: r.cameraMove,
    elevation: r.elevation ?? undefined,
    camera: parseJ(r.camera, {} as any),
    characterIds: parseJ(r.characterIds, []),
    blocking: r.blocking ? parseJ(r.blocking, undefined) : undefined,
    durationSec: r.durationSec,
    keyframePrompt: r.keyframePrompt ?? undefined,
    motionPrompt: r.motionPrompt ?? undefined,
    keyframeMode: r.keyframeMode,
    loras: r.loras ? parseJ(r.loras, undefined) : undefined,
    seed: r.seed ?? undefined,
    keyframeAssetId: r.keyframeAssetId ?? undefined,
    keyframeCandidates: parseJ(r.keyframeCandidates, []),
    videoAssetId: r.videoAssetId ?? undefined,
    videoCandidates: parseJ(r.videoCandidates, []),
    status: r.status,
    error: r.error ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const shots = {
  create(s: Partial<Shot> & { sceneId: ID; camera: Shot['camera'] }): Shot {
    const id = s.id ?? newId();
    const t = now();
    const maxOrder = (db.prepare('SELECT MAX("order") as m FROM shots WHERE sceneId = ?').get(s.sceneId) as any)?.m ?? -1;
    db.prepare(
      `INSERT INTO shots (id,sceneId,"order",action,dialogue,shotSize,cameraMove,elevation,camera,characterIds,blocking,durationSec,keyframePrompt,motionPrompt,keyframeMode,loras,seed,keyframeAssetId,keyframeCandidates,videoAssetId,videoCandidates,status,error,createdAt,updatedAt)
       VALUES (@id,@sceneId,@order,@action,@dialogue,@shotSize,@cameraMove,@elevation,@camera,@characterIds,@blocking,@durationSec,@keyframePrompt,@motionPrompt,@keyframeMode,@loras,@seed,@keyframeAssetId,@keyframeCandidates,@videoAssetId,@videoCandidates,@status,@error,@createdAt,@updatedAt)`,
    ).run({
      id,
      sceneId: s.sceneId,
      order: s.order ?? maxOrder + 1,
      action: s.action ?? '',
      dialogue: s.dialogue ?? null,
      shotSize: s.shotSize ?? 'MS',
      cameraMove: s.cameraMove ?? 'static',
      elevation: s.elevation ?? null,
      camera: j(s.camera),
      characterIds: j(s.characterIds ?? []),
      blocking: s.blocking ? j(s.blocking) : null,
      durationSec: s.durationSec ?? 5,
      keyframePrompt: s.keyframePrompt ?? null,
      motionPrompt: s.motionPrompt ?? null,
      keyframeMode: s.keyframeMode ?? 'auto',
      loras: s.loras ? j(s.loras) : null,
      seed: s.seed ?? null,
      keyframeAssetId: s.keyframeAssetId ?? null,
      keyframeCandidates: j(s.keyframeCandidates ?? []),
      videoAssetId: s.videoAssetId ?? null,
      videoCandidates: j(s.videoCandidates ?? []),
      status: s.status ?? 'draft',
      error: s.error ?? null,
      createdAt: t,
      updatedAt: t,
    });
    return shots.get(id)!;
  },
  get(id: ID): Shot | undefined {
    const r = db.prepare('SELECT * FROM shots WHERE id = ?').get(id);
    return r ? rowToShot(r) : undefined;
  },
  listByScene(sceneId: ID): Shot[] {
    return (db.prepare('SELECT * FROM shots WHERE sceneId = ? ORDER BY "order" ASC').all(sceneId) as any[]).map(rowToShot);
  },
  listByProject(projectId: ID): Shot[] {
    const rows = db
      .prepare(
        `SELECT shots.* FROM shots JOIN scenes ON shots.sceneId = scenes.id WHERE scenes.projectId = ? ORDER BY scenes."order" ASC, shots."order" ASC`,
      )
      .all(projectId) as any[];
    return rows.map(rowToShot);
  },
  update(id: ID, patch: Partial<Shot>): Shot | undefined {
    const cur = shots.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: now() };
    db.prepare(
      `UPDATE shots SET "order"=@order, action=@action, dialogue=@dialogue, shotSize=@shotSize, cameraMove=@cameraMove, elevation=@elevation, camera=@camera,
       characterIds=@characterIds, blocking=@blocking, durationSec=@durationSec, keyframePrompt=@keyframePrompt, motionPrompt=@motionPrompt, keyframeMode=@keyframeMode,
       loras=@loras, seed=@seed, keyframeAssetId=@keyframeAssetId, keyframeCandidates=@keyframeCandidates, videoAssetId=@videoAssetId, videoCandidates=@videoCandidates,
       status=@status, error=@error, updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      order: next.order,
      action: next.action,
      dialogue: next.dialogue ?? null,
      shotSize: next.shotSize,
      cameraMove: next.cameraMove,
      elevation: next.elevation ?? null,
      camera: j(next.camera),
      characterIds: j(next.characterIds),
      blocking: next.blocking ? j(next.blocking) : null,
      durationSec: next.durationSec,
      keyframePrompt: next.keyframePrompt ?? null,
      motionPrompt: next.motionPrompt ?? null,
      keyframeMode: next.keyframeMode,
      loras: next.loras ? j(next.loras) : null,
      seed: next.seed ?? null,
      keyframeAssetId: next.keyframeAssetId ?? null,
      keyframeCandidates: j(next.keyframeCandidates),
      videoAssetId: next.videoAssetId ?? null,
      videoCandidates: j(next.videoCandidates),
      status: next.status,
      error: next.error ?? null,
      updatedAt: next.updatedAt,
    });
    return shots.get(id);
  },
  delete(id: ID) {
    db.prepare('DELETE FROM shots WHERE id = ?').run(id);
  },
  reorder(sceneId: ID, shotIds: ID[]) {
    const stmt = db.prepare('UPDATE shots SET "order" = ? WHERE id = ? AND sceneId = ?');
    shotIds.forEach((id, i) => stmt.run(i, id, sceneId));
  },
};

// ───────────────────────────── kv (settings + secrets) ─────────────────────────────

export const kv = {
  get<T = unknown>(key: string): T | undefined {
    const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : undefined;
  },
  set(key: string, value: unknown) {
    db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
  },
};

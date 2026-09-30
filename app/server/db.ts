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

const CURRENT_VERSION = 9;

function migrate() {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= CURRENT_VERSION) return;
  if (version < 1) createSchema();
  // v2: who queued a job (a person or an agent with the token).
  if (version < 2) db.exec('ALTER TABLE jobs ADD COLUMN actor TEXT');
  // v3: character voices (Qwen3-TTS) and each shot's line rendered in its speaker's voice.
  if (version < 3) {
    db.exec(`
      ALTER TABLE characters ADD COLUMN voice TEXT;
      ALTER TABLE characters ADD COLUMN voiceHint TEXT;
      ALTER TABLE shots ADD COLUMN dialogueSpeakerId TEXT;
      ALTER TABLE shots ADD COLUMN dialogueAudioAssetId TEXT;
      ALTER TABLE shots ADD COLUMN dialogueAudioKey TEXT;
    `);
  }
  // v4: a shot's optional end frame (first/last-frame clips) and its video model choice.
  if (version < 4) {
    db.exec(`
      ALTER TABLE shots ADD COLUMN endKeyframeAssetId TEXT;
      ALTER TABLE shots ADD COLUMN videoModel TEXT;
    `);
  }
  // v5: a shot's clip quality (fast / hd).
  if (version < 5) db.exec('ALTER TABLE shots ADD COLUMN quality TEXT');
  // v6: a shot's control video (Wan 2.2 Fun-Control).
  if (version < 6) db.exec('ALTER TABLE shots ADD COLUMN controlVideoAssetId TEXT');
  // v7: reference sheets and a reference video per shot (MiniMax H3 reference-to-video).
  if (version < 7) db.exec('ALTER TABLE shots ADD COLUMN referenceAssetIds TEXT; ALTER TABLE shots ADD COLUMN referenceVideoAssetId TEXT');
  // v8: the Blender-previs + Ingredients-sheet workflow (character kinds/sheet assets, scene reference sheets,
  // scene previs, per-shot control strength/keyframe pinning, project export grade).
  if (version < 8) {
    db.exec(`
      ALTER TABLE characters ADD COLUMN kind TEXT;
      ALTER TABLE characters ADD COLUMN sheetAssets TEXT;
      ALTER TABLE scenes ADD COLUMN referenceSheetAssetId TEXT;
      ALTER TABLE scenes ADD COLUMN referenceSheetText TEXT;
      ALTER TABLE scenes ADD COLUMN previsAssetId TEXT;
      ALTER TABLE scenes ADD COLUMN previsDepthAssetId TEXT;
      ALTER TABLE scenes ADD COLUMN previsCuts TEXT;
      ALTER TABLE shots ADD COLUMN controlStrength REAL;
      ALTER TABLE shots ADD COLUMN pinKeyframe INTEGER;
      ALTER TABLE projects ADD COLUMN grade TEXT;
    `);
  }
  // v9: opt-in 4K upscale (SeedVR2) at export time.
  if (version < 9) db.exec('ALTER TABLE projects ADD COLUMN upscale TEXT');
  db.pragma(`user_version = ${CURRENT_VERSION}`);
}

function createSchema() {

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
    } else {
      // Voice clips and rendered lines live with their character or shot, not in the image/video gallery.
      where.push("kind != 'audio'");
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
    actor: r.actor ?? undefined,
  };
}

export const jobs = {
  create(j0: Omit<Job, 'id' | 'createdAt' | 'progress' | 'status' | 'outputAssetIds'> & Partial<Pick<Job, 'status' | 'progress' | 'outputAssetIds'>>): Job {
    const id = newId();
    const createdAt = now();
    db.prepare(
      `INSERT INTO jobs (id, type, status, progress, stage, title, params, outputAssetIds, error, projectId, shotId, queuePosition, createdAt, startedAt, finishedAt, actor)
       VALUES (@id,@type,@status,@progress,@stage,@title,@params,@outputAssetIds,@error,@projectId,@shotId,@queuePosition,@createdAt,@startedAt,@finishedAt,@actor)`,
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
      actor: j0.actor ?? null,
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
    kind: r.kind ?? undefined,
    loraId: r.loraId ?? undefined,
    triggerWord: r.triggerWord ?? undefined,
    voice: r.voice ? parseJ(r.voice, undefined) : undefined,
    voiceHint: r.voiceHint ?? undefined,
    sheetAssets: r.sheetAssets ? parseJ(r.sheetAssets, undefined) : undefined,
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
      `INSERT INTO characters (id,name,description,referenceAssetIds,kind,loraId,triggerWord,voice,voiceHint,sheetAssets,color,createdAt,updatedAt)
       VALUES (@id,@name,@description,@referenceAssetIds,@kind,@loraId,@triggerWord,@voice,@voiceHint,@sheetAssets,@color,@createdAt,@updatedAt)`,
    ).run({
      id,
      name: c.name ?? 'Unnamed',
      description: c.description ?? '',
      referenceAssetIds: j(c.referenceAssetIds ?? []),
      kind: c.kind ?? null,
      loraId: c.loraId ?? null,
      triggerWord: c.triggerWord ?? null,
      voice: c.voice ? j(c.voice) : null,
      voiceHint: c.voiceHint ?? null,
      sheetAssets: c.sheetAssets ? j(c.sheetAssets) : null,
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
      `UPDATE characters SET name=@name, description=@description, referenceAssetIds=@referenceAssetIds, kind=@kind, loraId=@loraId, triggerWord=@triggerWord, voice=@voice, voiceHint=@voiceHint, sheetAssets=@sheetAssets, color=@color, updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      name: next.name,
      description: next.description,
      referenceAssetIds: j(next.referenceAssetIds),
      kind: next.kind ?? null,
      loraId: next.loraId ?? null,
      triggerWord: next.triggerWord ?? null,
      voice: next.voice ? j(next.voice) : null,
      voiceHint: next.voiceHint ?? null,
      sheetAssets: next.sheetAssets ? j(next.sheetAssets) : null,
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
    grade: r.grade ?? undefined,
    upscale: r.upscale ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const projects = {
  create(p: Partial<Project>): Project {
    const id = p.id ?? newId();
    const t = now();
    db.prepare(
      `INSERT INTO projects (id,name,logline,aspect,styleId,script,coverAssetId,exportAssetId,grade,upscale,createdAt,updatedAt)
       VALUES (@id,@name,@logline,@aspect,@styleId,@script,@coverAssetId,@exportAssetId,@grade,@upscale,@createdAt,@updatedAt)`,
    ).run({
      id,
      name: p.name ?? 'Untitled project',
      logline: p.logline ?? '',
      aspect: p.aspect ?? '16:9',
      styleId: p.styleId ?? null,
      script: p.script ?? '',
      coverAssetId: p.coverAssetId ?? null,
      exportAssetId: p.exportAssetId ?? null,
      grade: p.grade ?? null,
      upscale: p.upscale ?? null,
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
      `UPDATE projects SET name=@name, logline=@logline, aspect=@aspect, styleId=@styleId, script=@script, coverAssetId=@coverAssetId, exportAssetId=@exportAssetId, grade=@grade, upscale=@upscale, updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      name: next.name,
      logline: next.logline,
      aspect: next.aspect,
      styleId: next.styleId ?? null,
      script: next.script,
      coverAssetId: next.coverAssetId ?? null,
      exportAssetId: next.exportAssetId ?? null,
      grade: next.grade ?? null,
      upscale: next.upscale ?? null,
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
    referenceSheetAssetId: r.referenceSheetAssetId ?? undefined,
    referenceSheetText: r.referenceSheetText ?? undefined,
    previsAssetId: r.previsAssetId ?? undefined,
    previsDepthAssetId: r.previsDepthAssetId ?? undefined,
    previsCuts: r.previsCuts ? parseJ(r.previsCuts, undefined) : undefined,
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
      `INSERT INTO scenes (id,projectId,"order",title,description,locationId,timeOfDay,blocking,referenceSheetAssetId,referenceSheetText,previsAssetId,previsDepthAssetId,previsCuts,createdAt,updatedAt)
       VALUES (@id,@projectId,@order,@title,@description,@locationId,@timeOfDay,@blocking,@referenceSheetAssetId,@referenceSheetText,@previsAssetId,@previsDepthAssetId,@previsCuts,@createdAt,@updatedAt)`,
    ).run({
      id,
      projectId: s.projectId,
      order: s.order ?? maxOrder + 1,
      title: s.title ?? 'New scene',
      description: s.description ?? '',
      locationId: s.locationId ?? null,
      timeOfDay: s.timeOfDay ?? 'day',
      blocking: j(s.blocking ?? []),
      referenceSheetAssetId: s.referenceSheetAssetId ?? null,
      referenceSheetText: s.referenceSheetText ?? null,
      previsAssetId: s.previsAssetId ?? null,
      previsDepthAssetId: s.previsDepthAssetId ?? null,
      previsCuts: s.previsCuts ? j(s.previsCuts) : null,
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
      `UPDATE scenes SET "order"=@order, title=@title, description=@description, locationId=@locationId, timeOfDay=@timeOfDay, blocking=@blocking,
       referenceSheetAssetId=@referenceSheetAssetId, referenceSheetText=@referenceSheetText, previsAssetId=@previsAssetId, previsDepthAssetId=@previsDepthAssetId, previsCuts=@previsCuts,
       updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      order: next.order,
      title: next.title,
      description: next.description,
      locationId: next.locationId ?? null,
      timeOfDay: next.timeOfDay,
      blocking: j(next.blocking),
      referenceSheetAssetId: next.referenceSheetAssetId ?? null,
      referenceSheetText: next.referenceSheetText ?? null,
      previsAssetId: next.previsAssetId ?? null,
      previsDepthAssetId: next.previsDepthAssetId ?? null,
      previsCuts: next.previsCuts ? j(next.previsCuts) : null,
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
    dialogueSpeakerId: r.dialogueSpeakerId ?? undefined,
    dialogueAudioAssetId: r.dialogueAudioAssetId ?? undefined,
    dialogueAudioKey: r.dialogueAudioKey ?? undefined,
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
    endKeyframeAssetId: r.endKeyframeAssetId ?? undefined,
    videoModel: r.videoModel ?? undefined,
    quality: r.quality ?? undefined,
    controlVideoAssetId: r.controlVideoAssetId ?? undefined,
    referenceAssetIds: r.referenceAssetIds ? parseJ(r.referenceAssetIds, undefined) : undefined,
    referenceVideoAssetId: r.referenceVideoAssetId ?? undefined,
    controlStrength: r.controlStrength ?? undefined,
    pinKeyframe: r.pinKeyframe === null || r.pinKeyframe === undefined ? undefined : bool(r.pinKeyframe),
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
      `INSERT INTO shots (id,sceneId,"order",action,dialogue,dialogueSpeakerId,dialogueAudioAssetId,dialogueAudioKey,shotSize,cameraMove,elevation,camera,characterIds,blocking,durationSec,keyframePrompt,motionPrompt,keyframeMode,loras,seed,keyframeAssetId,keyframeCandidates,endKeyframeAssetId,videoModel,quality,controlVideoAssetId,referenceAssetIds,referenceVideoAssetId,controlStrength,pinKeyframe,videoAssetId,videoCandidates,status,error,createdAt,updatedAt)
       VALUES (@id,@sceneId,@order,@action,@dialogue,@dialogueSpeakerId,@dialogueAudioAssetId,@dialogueAudioKey,@shotSize,@cameraMove,@elevation,@camera,@characterIds,@blocking,@durationSec,@keyframePrompt,@motionPrompt,@keyframeMode,@loras,@seed,@keyframeAssetId,@keyframeCandidates,@endKeyframeAssetId,@videoModel,@quality,@controlVideoAssetId,@referenceAssetIds,@referenceVideoAssetId,@controlStrength,@pinKeyframe,@videoAssetId,@videoCandidates,@status,@error,@createdAt,@updatedAt)`,
    ).run({
      id,
      sceneId: s.sceneId,
      order: s.order ?? maxOrder + 1,
      action: s.action ?? '',
      dialogue: s.dialogue ?? null,
      dialogueSpeakerId: s.dialogueSpeakerId ?? null,
      dialogueAudioAssetId: s.dialogueAudioAssetId ?? null,
      dialogueAudioKey: s.dialogueAudioKey ?? null,
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
      endKeyframeAssetId: s.endKeyframeAssetId ?? null,
      videoModel: s.videoModel ?? null,
      quality: s.quality ?? null,
      controlVideoAssetId: s.controlVideoAssetId ?? null,
      referenceAssetIds: s.referenceAssetIds ? j(s.referenceAssetIds) : null,
      referenceVideoAssetId: s.referenceVideoAssetId ?? null,
      controlStrength: s.controlStrength ?? null,
      pinKeyframe: s.pinKeyframe ? 1 : s.pinKeyframe === false ? 0 : null,
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
      `UPDATE shots SET "order"=@order, action=@action, dialogue=@dialogue, dialogueSpeakerId=@dialogueSpeakerId, dialogueAudioAssetId=@dialogueAudioAssetId, dialogueAudioKey=@dialogueAudioKey, shotSize=@shotSize, cameraMove=@cameraMove, elevation=@elevation, camera=@camera,
       characterIds=@characterIds, blocking=@blocking, durationSec=@durationSec, keyframePrompt=@keyframePrompt, motionPrompt=@motionPrompt, keyframeMode=@keyframeMode,
       loras=@loras, seed=@seed, keyframeAssetId=@keyframeAssetId, keyframeCandidates=@keyframeCandidates, endKeyframeAssetId=@endKeyframeAssetId, videoModel=@videoModel, quality=@quality, controlVideoAssetId=@controlVideoAssetId, referenceAssetIds=@referenceAssetIds, referenceVideoAssetId=@referenceVideoAssetId, controlStrength=@controlStrength, pinKeyframe=@pinKeyframe, videoAssetId=@videoAssetId, videoCandidates=@videoCandidates,
       status=@status, error=@error, updatedAt=@updatedAt WHERE id=@id`,
    ).run({
      id,
      order: next.order,
      action: next.action,
      dialogue: next.dialogue ?? null,
      dialogueSpeakerId: next.dialogueSpeakerId ?? null,
      dialogueAudioAssetId: next.dialogueAudioAssetId ?? null,
      dialogueAudioKey: next.dialogueAudioKey ?? null,
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
      endKeyframeAssetId: next.endKeyframeAssetId ?? null,
      videoModel: next.videoModel ?? null,
      quality: next.quality ?? null,
      controlVideoAssetId: next.controlVideoAssetId ?? null,
      referenceAssetIds: next.referenceAssetIds ? j(next.referenceAssetIds) : null,
      referenceVideoAssetId: next.referenceVideoAssetId ?? null,
      controlStrength: next.controlStrength ?? null,
      pinKeyframe: next.pinKeyframe ? 1 : next.pinKeyframe === false ? 0 : null,
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

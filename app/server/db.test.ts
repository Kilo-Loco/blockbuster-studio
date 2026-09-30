// Migration tests through CURRENT_VERSION 10 (the Blender-previs + Ingredients-sheet workflow, the opt-in 4K
// upscale column, then the guided previs flow's project.mode / scene.castIds): a fresh install gets the new
// columns straight from createSchema + migrate(), and an existing v7 install is upgraded in place without
// losing data. Each test gets its own DATA_DIR and a fresh import of '../db' (module-level singletons open the
// sqlite file at import time), via vi.resetModules().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let dataDir: string;
const prevDataDir = process.env.DATA_DIR;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-db-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
  vi.resetModules();
});

/** The v7 schema (createSchema + migrations 2-7 from db.ts, frozen here as the upgrade fixture) — a v7
 *  install this test upgrades in place, independent of whatever db.ts's migrate() does today. */
function createV7Database(file: string) {
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, origin TEXT NOT NULL, file TEXT NOT NULL, thumb TEXT,
      width INTEGER NOT NULL, height INTEGER NOT NULL, durationSec REAL, fps REAL, prompt TEXT, engine TEXT,
      params TEXT, jobId TEXT, projectId TEXT, shotId TEXT, favorite INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, stage TEXT,
      title TEXT NOT NULL, params TEXT NOT NULL, outputAssetIds TEXT NOT NULL DEFAULT '[]', error TEXT,
      projectId TEXT, shotId TEXT, queuePosition INTEGER, createdAt TEXT NOT NULL, startedAt TEXT, finishedAt TEXT, actor TEXT
    );
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, referenceAssetIds TEXT NOT NULL DEFAULT '[]',
      loraId TEXT, triggerWord TEXT, voice TEXT, voiceHint TEXT, color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, establishingAssetId TEXT, map TEXT NOT NULL,
      angleViews TEXT NOT NULL DEFAULT '[]', loraId TEXT, triggerWord TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS styles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, negativePrompt TEXT, loraId TEXT, loraStrength REAL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loras (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, filename TEXT NOT NULL, family TEXT NOT NULL, kind TEXT NOT NULL,
      triggerWord TEXT, defaultStrength REAL NOT NULL DEFAULT 1, source TEXT NOT NULL, sourceUrl TEXT, previewAssetId TEXT,
      status TEXT NOT NULL, error TEXT, sizeBytes INTEGER, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, logline TEXT NOT NULL DEFAULT '', aspect TEXT NOT NULL, styleId TEXT,
      script TEXT NOT NULL DEFAULT '', coverAssetId TEXT, exportAssetId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL, "order" INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      locationId TEXT, timeOfDay TEXT NOT NULL, blocking TEXT NOT NULL DEFAULT '[]', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY, sceneId TEXT NOT NULL, "order" INTEGER NOT NULL, action TEXT NOT NULL DEFAULT '', dialogue TEXT,
      dialogueSpeakerId TEXT, dialogueAudioAssetId TEXT, dialogueAudioKey TEXT, shotSize TEXT NOT NULL, cameraMove TEXT NOT NULL,
      elevation TEXT, camera TEXT NOT NULL, characterIds TEXT NOT NULL DEFAULT '[]', blocking TEXT, durationSec REAL NOT NULL DEFAULT 5,
      keyframePrompt TEXT, motionPrompt TEXT, keyframeMode TEXT NOT NULL DEFAULT 'auto', loras TEXT, seed INTEGER,
      keyframeAssetId TEXT, keyframeCandidates TEXT NOT NULL DEFAULT '[]', endKeyframeAssetId TEXT, videoModel TEXT, quality TEXT,
      controlVideoAssetId TEXT, referenceAssetIds TEXT, referenceVideoAssetId TEXT,
      videoAssetId TEXT, videoCandidates TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', error TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  raw.pragma('user_version = 7');

  const t = new Date().toISOString();
  raw.prepare(`INSERT INTO projects (id,name,logline,aspect,script,createdAt,updatedAt) VALUES ('p1','Old Project','',(?),'', ?, ?)`).run('16:9', t, t);
  raw.prepare(`INSERT INTO characters (id,name,description,referenceAssetIds,color,createdAt,updatedAt) VALUES ('c1','Mara','a woman','[]','#f5a524',?,?)`).run(t, t);
  raw.prepare(`INSERT INTO scenes (id,projectId,"order",title,description,timeOfDay,blocking,createdAt,updatedAt) VALUES ('s1','p1',0,'INT. BAR','','day','[]',?,?)`).run(t, t);
  raw
    .prepare(
      `INSERT INTO shots (id,sceneId,"order",action,shotSize,cameraMove,camera,characterIds,durationSec,keyframeMode,keyframeCandidates,videoCandidates,status,createdAt,updatedAt)
       VALUES ('sh1','s1',0,'Mara walks in','MS','static','{}','["c1"]',5,'auto','[]','[]','draft',?,?)`,
    )
    .run(t, t);
  raw.close();
}

describe('db migration to v10 (Blender previs + Ingredients sheet, 4K upscale, guided previs flow)', () => {
  it('a fresh install gets every new column at CURRENT_VERSION 10', async () => {
    const dbMod = await import('./db');
    expect(dbMod.db.pragma('user_version', { simple: true })).toBe(10);

    const project = dbMod.projects.create({ name: 'New Project', aspect: '16:9' });
    expect(project.grade).toBeUndefined();
    const graded = dbMod.projects.update(project.id, { grade: 'film' });
    expect(graded?.grade).toBe('film');
    expect(project.upscale).toBeUndefined();
    const upscaled = dbMod.projects.update(project.id, { upscale: '4k' });
    expect(upscaled?.upscale).toBe('4k');

    const character = dbMod.characters.create({ name: 'Rex', description: 'a car', kind: 'prop' });
    expect(character.kind).toBe('prop');
    const withSheet = dbMod.characters.update(character.id, { sheetAssets: { face: 'a1', turnaround: 'a2' } });
    expect(withSheet?.sheetAssets).toEqual({ face: 'a1', turnaround: 'a2' });

    const scene = dbMod.scenes.create({ projectId: project.id, title: 'INT. GARAGE' });
    expect(scene.previsAssetId).toBeUndefined();
    expect(scene.castIds).toBeUndefined();
    const withPrevis = dbMod.scenes.update(scene.id, {
      previsAssetId: 'v1',
      previsDepthAssetId: 'v2',
      previsCuts: [3, 5.5],
      referenceSheetAssetId: 'img1',
      referenceSheetText: 'Top row left: Rex.',
      castIds: [character.id],
    });
    expect(withPrevis?.previsCuts).toEqual([3, 5.5]);
    expect(withPrevis?.referenceSheetText).toBe('Top row left: Rex.');
    expect(withPrevis?.castIds).toEqual([character.id]);

    expect(project.mode).toBeUndefined();
    const modeSet = dbMod.projects.update(project.id, { mode: 'previs' });
    expect(modeSet?.mode).toBe('previs');

    const shot = dbMod.shots.create({ sceneId: scene.id, camera: { pos: { x: 0, y: 0 }, heightM: 1.6 } });
    expect(shot.controlStrength).toBeUndefined();
    expect(shot.pinKeyframe).toBeUndefined();
    const withControl = dbMod.shots.update(shot.id, { controlStrength: 0.6, pinKeyframe: true });
    expect(withControl?.controlStrength).toBe(0.6);
    expect(withControl?.pinKeyframe).toBe(true);
    const unpinned = dbMod.shots.update(shot.id, { pinKeyframe: false });
    expect(unpinned?.pinKeyframe).toBe(false);
  });

  it('upgrades an existing v7 database in place, keeping its data, and adds the new columns as null/undefined', async () => {
    createV7Database(path.join(dataDir, 'studio.db'));
    const dbMod = await import('./db');
    expect(dbMod.db.pragma('user_version', { simple: true })).toBe(10);

    const project = dbMod.projects.get('p1');
    expect(project?.name).toBe('Old Project');
    expect(project?.grade).toBeUndefined();
    expect(project?.upscale).toBeUndefined();
    expect(project?.mode).toBeUndefined();

    const character = dbMod.characters.get('c1');
    expect(character?.name).toBe('Mara');
    expect(character?.kind).toBeUndefined();
    expect(character?.sheetAssets).toBeUndefined();

    const scene = dbMod.scenes.get('s1');
    expect(scene?.title).toBe('INT. BAR');
    expect(scene?.previsAssetId).toBeUndefined();
    expect(scene?.previsCuts).toBeUndefined();
    expect(scene?.castIds).toBeUndefined();

    const shot = dbMod.shots.get('sh1');
    expect(shot?.action).toBe('Mara walks in');
    expect(shot?.controlStrength).toBeUndefined();
    expect(shot?.pinKeyframe).toBeUndefined();

    // The upgraded columns work going forward.
    const updated = dbMod.shots.update('sh1', { controlStrength: 0.7, pinKeyframe: true });
    expect(updated?.controlStrength).toBe(0.7);
    const castSet = dbMod.scenes.update('s1', { castIds: ['c1'] });
    expect(castSet?.castIds).toEqual(['c1']);
    const modeSet = dbMod.projects.update('p1', { mode: 'script' });
    expect(modeSet?.mode).toBe('script');
    expect(updated?.pinKeyframe).toBe(true);
  });
});

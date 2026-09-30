import path from 'node:path';
import { Hono } from 'hono';
import {
  assets as assetsRepo,
  characters as charactersRepo,
  jobs as jobsRepo,
  locations as locationsRepo,
  projects as projectsRepo,
  scenes as scenesRepo,
  shots as shotsRepo,
  styles as stylesRepo,
} from '../db';
import { emit } from '../events';
import { enqueue } from '../pipeline/queue';
import { withStatusUrl } from '../pipeline/wait';
import { checkStoryboard, rememberResponse, rememberedResponse, storyboardEnvFrom, writeStoryboard, type StoryboardEnv } from '../storyboard';

import { buildShotPlan, type ShotContext } from '../pipeline/prompts';
import { currentVideoModel, getSystemInfo, isEngineAvailable, isVoiceReady } from '../system';
import { queueLine, queueProjectVoices } from '../voice/lines';
import { aimCamera, completeBlocking, defaultLocationMap, placeCamera } from '../../shared/camera';
import { generateBreakdown, applyBreakdown } from '../ai/breakdown';
import { previsShotDurations } from '../pipeline/previs';
import { sceneCastIds } from '../pipeline/reference_sheet';
import { parsePrevisSequences, previsCutsFromShots } from '../../shared/previs';
import type { ComfyClient } from '../comfy/client';
import type { BreakdownDraft, Character, ID, Job, Project, ProjectDetail, Scene, Shot } from '../../shared/types';

/** Recomputes and persists every shot's durationSec from the scene's previsCuts (see docs on Scene.previsCuts):
 *  the scene's previsCuts must already be set to the value being applied. Used by both PATCH /api/scenes/:id
 *  (when previsCuts changes by hand) and POST /api/scenes/:id/previs/import (after import sets it). Emits a
 *  'shot' event for each shot whose durationSec actually changes. */
function applyPrevisCuts(scene: Scene) {
  if (!Array.isArray(scene.previsCuts)) return;
  const sceneShots = shotsRepo.listByScene(scene.id);
  if (scene.previsCuts.length !== sceneShots.length - 1) return;
  const previsAsset = scene.previsAssetId ? assetsRepo.get(scene.previsAssetId) : undefined;
  const durations = previsShotDurations(sceneShots, scene.previsCuts, previsAsset?.durationSec);
  sceneShots.forEach((shot, i) => {
    if (shot.durationSec !== durations[i]) emit({ type: 'shot', shot: shotsRepo.update(shot.id, { durationSec: durations[i] })! });
  });
}

/** "scene 2, shot 1": shot numbers restart in every scene, so the queue needs both. */
function shotLabel(shot: Shot): string {
  const scene = scenesRepo.get(shot.sceneId);
  return scene ? `scene ${scene.order + 1}, shot ${shot.order + 1}` : `shot ${shot.order + 1}`;
}

/** Re-aim a studio-placed camera at the shot's cast after its cast, size, blocking or location changed.
 *  Cameras moved by hand (auto unset) stay where the user put them. */
function reaimed(shot: Shot, sceneBlocking: Scene['blocking'], locationId: ID | undefined): Shot['camera'] | undefined {
  if (!shot.camera.auto) return undefined;
  const map = (locationId ? locationsRepo.get(locationId)?.map : undefined) ?? defaultLocationMap();
  return aimCamera(shot.camera, completeBlocking(shot.blocking ?? sceneBlocking, shot.characterIds, map), shot.shotSize, map);
}

/** Jobs that give keyframes consistent faces and places: a reference sheet for each character in these
 *  shots and an establishing image for each location, when missing and not already queued. Keyframes
 *  only use them when Qwen-Image-Edit can compose (see computeMode in prompts.ts). */
function enqueueMissingReferences(project: Project, shots: Shot[]): Job[] {
  const active = jobsRepo.list({ active: true });
  const queued = (type: Job['type'], key: string, id: ID) => active.some((j) => j.type === type && j.params[key] === id);
  const jobs: Job[] = [];
  for (const id of new Set(shots.flatMap((s) => s.characterIds))) {
    const c = charactersRepo.get(id);
    if (!c || c.referenceAssetIds.length > 0 || queued('character_refs', 'characterId', id)) continue;
    jobs.push(enqueue({ type: 'character_refs', title: `Reference sheet: ${c.name}`, params: { characterId: id, count: 2, aspect: '1:1' }, projectId: project.id }));
  }
  const sceneIds = new Set(shots.map((s) => s.sceneId));
  const locationIds = scenesRepo.listByProject(project.id).filter((s) => sceneIds.has(s.id) && s.locationId).map((s) => s.locationId!);
  for (const id of new Set(locationIds)) {
    const l = locationsRepo.get(id);
    if (!l || l.establishingAssetId || queued('location_establishing', 'locationId', id)) continue;
    jobs.push(enqueue({ type: 'location_establishing', title: `Establishing shot: ${l.name}`, params: { locationId: id, aspect: project.aspect }, projectId: project.id }));
  }
  return jobs;
}

function projectDetail(projectId: ID): ProjectDetail | undefined {
  const project = projectsRepo.get(projectId);
  if (!project) return undefined;
  const scenes = scenesRepo.listByProject(projectId).map((s) => ({ ...s, shots: shotsRepo.listByScene(s.id) }));
  return { project, scenes };
}

async function shotContextFor(shot: Shot, comfy: ComfyClient): Promise<ShotContext> {
  const scene = scenesRepo.get(shot.sceneId);
  if (!scene) throw new Error('Scene not found');
  const project = projectsRepo.get(scene.projectId);
  if (!project) throw new Error('Project not found');
  const location = scene.locationId ? locationsRepo.get(scene.locationId) : undefined;
  // Matches shot_video.ts's scene-previs branch: a previs shot with no characterIds of its own falls back to
  // the scene's cast (people only), so the preview shows the same "who's in frame" wording as the render.
  const characterIds = shot.characterIds.length
    ? shot.characterIds
    : sceneCastIds(scene, shotsRepo.listByScene(scene.id)).filter((id) => (charactersRepo.get(id)?.kind ?? 'person') !== 'prop');
  const characters = characterIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
  const style = project.styleId ? stylesRepo.get(project.styleId) : undefined;
  const editEngineAvailable = await isEngineAvailable(comfy, 'qwen_edit');
  return { project, scene, shot, location, characters, castNames: charactersRepo.list().map((c) => c.name), style, editEngineAvailable };
}

export function projectsRoutes(comfy: ComfyClient) {
  const app = new Hono();

  app.get('/api/projects', (c) => c.json(projectsRepo.list()));

  app.post('/api/projects', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.name) return c.json({ error: 'missing name' }, 400);
    if (body.mode !== undefined && body.mode !== 'previs' && body.mode !== 'script') {
      return c.json({ error: `mode must be "previs" or "script" (got ${JSON.stringify(body.mode)})` }, 400);
    }
    const project = projectsRepo.create(body);
    return c.json(project);
  });

  app.get('/api/projects/:id', (c) => {
    const detail = projectDetail(c.req.param('id'));
    if (!detail) return c.json({ error: 'not found' }, 404);
    return c.json(detail);
  });

  app.patch('/api/projects/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.grade !== undefined && body.grade !== 'none' && body.grade !== 'film') {
      return c.json({ error: `grade must be "none" or "film" (got ${JSON.stringify(body.grade)})` }, 400);
    }
    if (body.upscale !== undefined && body.upscale !== 'none' && body.upscale !== '4k') {
      return c.json({ error: `upscale must be "none" or "4k" (got ${JSON.stringify(body.upscale)})` }, 400);
    }
    if (body.mode !== undefined && body.mode !== 'previs' && body.mode !== 'script') {
      return c.json({ error: `mode must be "previs" or "script" (got ${JSON.stringify(body.mode)})` }, 400);
    }
    const updated = projectsRepo.update(c.req.param('id'), body);
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json(updated);
  });

  app.delete('/api/projects/:id', (c) => {
    projectsRepo.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/projects/:id/scenes', async (c) => {
    const projectId = c.req.param('id');
    if (!projectsRepo.get(projectId)) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const scene = scenesRepo.create({ ...body, projectId });
    return c.json(scene);
  });

  app.patch('/api/scenes/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    for (const field of ['previsAssetId', 'previsDepthAssetId', 'referenceSheetAssetId', 'referenceSheetText'] as const) {
      if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
        return c.json({ error: `${field} must be a string (got ${JSON.stringify(body[field])})` }, 400);
      }
    }
    if (body.previsCuts !== undefined && body.previsCuts !== null) {
      if (!Array.isArray(body.previsCuts) || body.previsCuts.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
        return c.json({ error: 'previsCuts must be an array of non-negative numbers (seconds)' }, 400);
      }
      const sorted = [...body.previsCuts].every((n, i, arr) => i === 0 || arr[i - 1] <= n);
      if (!sorted) return c.json({ error: 'previsCuts must be non-decreasing' }, 400);
    }
    if (body.castIds !== undefined && body.castIds !== null) {
      if (!Array.isArray(body.castIds) || body.castIds.some((id: unknown) => typeof id !== 'string')) {
        return c.json({ error: 'castIds must be an array of character ids' }, 400);
      }
      const unknown = body.castIds.filter((id: ID) => !charactersRepo.get(id));
      if (unknown.length) return c.json({ error: `Unknown character id(s): ${unknown.join(', ')}` }, 400);
    }
    const updated = scenesRepo.update(c.req.param('id'), body);
    if (!updated) return c.json({ error: 'not found' }, 404);
    if ('blocking' in body || 'locationId' in body) {
      for (const shot of shotsRepo.listByScene(updated.id)) {
        const camera = reaimed(shot, updated.blocking, updated.locationId);
        if (camera) emit({ type: 'shot', shot: shotsRepo.update(shot.id, { camera })! });
      }
    }
    // A scene's previsCuts define each shot's start/duration in the previs (see docs on Scene.previsCuts);
    // recompute and persist durationSec so the storyboard, exporter and MCP tools agree on shot length.
    if ('previsCuts' in body) applyPrevisCuts(updated);
    emit({ type: 'scene', scene: updated });
    return c.json(updated);
  });

  app.delete('/api/scenes/:id', (c) => {
    scenesRepo.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  // Imports a Blender previs skill's sequences.json into the scene's shots: makes the shots match the chosen
  // sequence 1:1 (creating any missing ones at the end; an existing empty action is filled from the file's
  // beat/name), then sets previsCuts from the file's cut points (recomputing every shot's durationSec, same
  // as the PATCH does). See "Data model + API contract" in the guided previs flow spec.
  app.post('/api/scenes/:id/previs/import', async (c) => {
    const scene = scenesRepo.get(c.req.param('id'));
    if (!scene) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const sequences = parsePrevisSequences(body.sequences);
    if (!sequences) return c.json({ error: 'Could not read that sequences.json' }, 400);

    let sequenceIndex: number;
    if (body.sequence !== undefined) {
      if (typeof body.sequence !== 'number' || !Number.isInteger(body.sequence) || body.sequence < 0 || body.sequence >= sequences.length) {
        return c.json({ error: `sequence must be an integer between 0 and ${sequences.length - 1}` }, 400);
      }
      sequenceIndex = body.sequence;
    } else {
      // Default: the sequence whose file matches the scene's previs asset's original filename, when known.
      const previsAsset = scene.previsAssetId ? assetsRepo.get(scene.previsAssetId) : undefined;
      const previsName = previsAsset ? path.basename(previsAsset.file) : undefined;
      const matched = previsName ? sequences.findIndex((seq) => seq.file && path.basename(seq.file) === previsName) : -1;
      sequenceIndex = matched >= 0 ? matched : 0;
    }
    const chosen = sequences[sequenceIndex]!;

    const existingShots = shotsRepo.listByScene(scene.id);
    if (existingShots.length > chosen.shots.length) {
      return c.json(
        { error: `This scene has ${existingShots.length} shots but the previs has ${chosen.shots.length}. Delete the extra shots first.` },
        409,
      );
    }

    const map = (scene.locationId ? locationsRepo.get(scene.locationId)?.map : undefined) ?? defaultLocationMap();
    chosen.shots.forEach((seqShot, i) => {
      const durationSec = Math.max(0.5, Math.round((seqShot.endSec - seqShot.startSec) * 100) / 100);
      const actionFromFile = seqShot.beat || seqShot.name || '';
      const existing = existingShots[i];
      if (existing) {
        const patch: Partial<Shot> = { durationSec };
        if (!existing.action) patch.action = actionFromFile;
        const updated = shotsRepo.update(existing.id, patch);
        if (updated) emit({ type: 'shot', shot: updated });
      } else {
        const camera = aimCamera(placeCamera(map, map.subject, 'front', 'MS'), completeBlocking(scene.blocking, [], map), 'MS', map);
        const created = shotsRepo.create({ sceneId: scene.id, action: actionFromFile, durationSec, camera });
        emit({ type: 'shot', shot: created });
      }
    });

    // The file's interior cut points (undefined for a single-shot sequence — nothing to cut).
    const previsCuts = previsCutsFromShots(chosen.shots);
    let updatedScene = scene;
    if (previsCuts) {
      updatedScene = scenesRepo.update(scene.id, { previsCuts }) ?? scene;
      applyPrevisCuts(updatedScene);
    }
    emit({ type: 'scene', scene: updatedScene });
    return c.json({ scene: updatedScene, shots: shotsRepo.listByScene(scene.id) });
  });

  /** Build (or rebuild) the scene's Ingredients reference sheet from its cast + location. */
  app.post('/api/scenes/:id/reference-sheet', (c) => {
    const scene = scenesRepo.get(c.req.param('id'));
    if (!scene) return c.json({ error: 'not found' }, 404);
    const job = enqueue({ type: 'scene_reference_sheet', title: `Reference sheet: ${scene.title}`, params: { sceneId: scene.id }, projectId: scene.projectId });
    return c.json(withStatusUrl(job), 202);
  });

  app.post('/api/projects/:id/scenes/reorder', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    scenesRepo.reorder(projectId, body.sceneIds ?? []);
    const detail = projectDetail(projectId);
    if (!detail) return c.json({ error: 'not found' }, 404);
    return c.json(detail);
  });

  app.post('/api/scenes/:id/shots', async (c) => {
    const sceneId = c.req.param('id');
    const scene = scenesRepo.get(sceneId);
    if (!scene) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    let camera = body.camera;
    if (!camera) {
      const map = (scene.locationId ? locationsRepo.get(scene.locationId)?.map : undefined) ?? defaultLocationMap();
      const size = body.shotSize ?? 'MS';
      const marks = completeBlocking(body.blocking ?? scene.blocking, body.characterIds ?? [], map);
      camera = aimCamera(placeCamera(map, map.subject, 'front', size), marks, size, map);
    }
    const shot = shotsRepo.create({ ...body, sceneId, camera });
    return c.json(shot);
  });

  app.patch('/api/shots/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.controlStrength !== undefined && body.controlStrength !== null && (typeof body.controlStrength !== 'number' || !Number.isFinite(body.controlStrength) || body.controlStrength < 0 || body.controlStrength > 1.5)) {
      return c.json({ error: `controlStrength must be between 0 and 1.5 (got ${JSON.stringify(body.controlStrength)})` }, 400);
    }
    if (body.pinKeyframe !== undefined && typeof body.pinKeyframe !== 'boolean') {
      return c.json({ error: `pinKeyframe must be a boolean (got ${JSON.stringify(body.pinKeyframe)})` }, 400);
    }
    let updated = shotsRepo.update(c.req.param('id'), body);
    if (!updated) return c.json({ error: 'not found' }, 404);
    if (!body.camera && ('characterIds' in body || 'shotSize' in body || 'blocking' in body)) {
      const scene = scenesRepo.get(updated.sceneId);
      const camera = scene ? reaimed(updated, scene.blocking, scene.locationId) : undefined;
      if (camera) updated = shotsRepo.update(updated.id, { camera }) ?? updated;
    }
    emit({ type: 'shot', shot: updated });
    // A new line or speaker is heard in the speaker's voice as soon as the voice engine can render it.
    if (('dialogue' in body || 'dialogueSpeakerId' in body || 'characterIds' in body) && (await isVoiceReady())) queueLine(updated);
    return c.json(updated);
  });

  /** Render (or re-render) the shot's line in its speaker's voice. */
  app.post('/api/shots/:id/line', async (c) => {
    const shot = shotsRepo.get(c.req.param('id'));
    if (!shot) return c.json({ error: 'not found' }, 404);
    if (!(await isVoiceReady())) return c.json({ error: 'The voice engine is still downloading' }, 409);
    const job = queueLine(shot, { force: true });
    if (!job) return c.json({ error: 'This shot has no line, no speaker, or a speaker without a voice' }, 400);
    return c.json(withStatusUrl(job), 202);
  });

  /** Voices for the project's speakers that have a voice description, then every missing or stale line. */
  app.post('/api/projects/:id/voices', async (c) => {
    const project = projectsRepo.get(c.req.param('id'));
    if (!project) return c.json({ error: 'not found' }, 404);
    if (!(await isVoiceReady())) return c.json({ error: 'The voice engine is still downloading' }, 409);
    const { voiceJobs, lineJobs, needsVoice } = queueProjectVoices(project.id);
    return c.json({ jobIds: [...voiceJobs, ...lineJobs].map((j) => j.id), voiceJobs: voiceJobs.length, lineJobs: lineJobs.length, needsVoice }, 202);
  });

  app.delete('/api/shots/:id', (c) => {
    shotsRepo.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/scenes/:id/shots/reorder', async (c) => {
    const sceneId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    shotsRepo.reorder(sceneId, body.shotIds ?? []);
    const scene = scenesRepo.get(sceneId);
    const detail = scene ? projectDetail(scene.projectId) : undefined;
    if (!detail) return c.json({ error: 'not found' }, 404);
    return c.json(detail);
  });

  app.post('/api/shots/:id/duplicate', (c) => {
    const shot = shotsRepo.get(c.req.param('id'));
    if (!shot) return c.json({ error: 'not found' }, 404);
    const { id, createdAt, updatedAt, keyframeAssetId, keyframeCandidates, videoAssetId, videoCandidates, status, ...rest } = shot;
    const copy = shotsRepo.create({ ...rest, sceneId: shot.sceneId });
    return c.json(copy);
  });

  app.get('/api/shots/:id/preview', async (c) => {
    const shot = shotsRepo.get(c.req.param('id'));
    if (!shot) return c.json({ error: 'not found' }, 404);
    try {
      const ctx = await shotContextFor(shot, comfy);
      const plan = buildShotPlan(ctx);
      return c.json({
        angle: plan.angle,
        placements: plan.placements,
        keyframePrompt: plan.keyframePrompt,
        motionPrompt: plan.motionPrompt,
        mode: plan.mode,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post('/api/shots/:id/keyframe', (c) => {
    const shot = shotsRepo.get(c.req.param('id'));
    if (!shot) return c.json({ error: 'not found' }, 404);
    const scene = scenesRepo.get(shot.sceneId)!;
    const updated = shotsRepo.update(shot.id, { status: 'keyframe_queued' });
    if (updated) emit({ type: 'shot', shot: updated });
    const job = enqueue({
      type: 'shot_keyframe',
      title: `Keyframe: ${shotLabel(shot)}`,
      params: { shotId: shot.id },
      projectId: scene.projectId,
      shotId: shot.id,
    });
    return c.json(withStatusUrl(job), 202);
  });

  app.post('/api/shots/:id/video', (c) => {
    const shot = shotsRepo.get(c.req.param('id'));
    if (!shot) return c.json({ error: 'not found' }, 404);
    const scene = scenesRepo.get(shot.sceneId)!;
    // A scene previs + reference sheet stands in for a keyframe (see shot_video.ts's scene-previs branch).
    const hasScenePrevis = Boolean(scene?.previsAssetId && scene?.referenceSheetAssetId);
    if (!shot.keyframeAssetId && !shot.referenceAssetIds?.length && !shot.referenceVideoAssetId && !hasScenePrevis) {
      return c.json({ error: 'shot has no keyframe' }, 400);
    }
    const updated = shotsRepo.update(shot.id, { status: 'video_queued' });
    if (updated) emit({ type: 'shot', shot: updated });
    const job = enqueue({
      type: 'shot_video',
      title: `Video: ${shotLabel(shot)}`,
      params: { shotId: shot.id },
      projectId: scene.projectId,
      shotId: shot.id,
    });
    return c.json(withStatusUrl(job), 202);
  });

  app.post('/api/shots/:id/select', async (c) => {
    const shot = shotsRepo.get(c.req.param('id'));
    if (!shot) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const patch: Partial<Shot> = {};
    if (body.keyframeAssetId) {
      const others = shot.keyframeCandidates.filter((a) => a !== body.keyframeAssetId);
      if (shot.keyframeAssetId && shot.keyframeAssetId !== body.keyframeAssetId) others.push(shot.keyframeAssetId);
      patch.keyframeAssetId = body.keyframeAssetId;
      patch.keyframeCandidates = others;
    }
    if ('endKeyframeAssetId' in body) patch.endKeyframeAssetId = body.endKeyframeAssetId || undefined;
    if ('controlVideoAssetId' in body) patch.controlVideoAssetId = body.controlVideoAssetId || undefined;
    if ('referenceVideoAssetId' in body) patch.referenceVideoAssetId = body.referenceVideoAssetId || undefined;
    if (Array.isArray(body.referenceAssetIds)) patch.referenceAssetIds = body.referenceAssetIds.length ? body.referenceAssetIds.slice(0, 9) : undefined;
    if (body.addReferenceAssetId) patch.referenceAssetIds = [...(shot.referenceAssetIds ?? []).filter((a) => a !== body.addReferenceAssetId), body.addReferenceAssetId].slice(-9);
    if (body.videoAssetId) {
      const others = shot.videoCandidates.filter((a) => a !== body.videoAssetId);
      if (shot.videoAssetId && shot.videoAssetId !== body.videoAssetId) others.push(shot.videoAssetId);
      patch.videoAssetId = body.videoAssetId;
      patch.videoCandidates = others;
    }
    const updated = shotsRepo.update(shot.id, patch);
    if (!updated) return c.json({ error: 'not found' }, 404);
    emit({ type: 'shot', shot: updated });
    return c.json(updated);
  });

  app.post('/api/projects/:id/render', async (c) => {
    const projectId = c.req.param('id');
    const project = projectsRepo.get(projectId);
    if (!project) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const what: 'keyframes' | 'videos' | 'all' = body.what ?? 'all';
    const onlyMissing = Boolean(body.onlyMissing);
    const sceneId: ID | undefined = typeof body.sceneId === 'string' ? body.sceneId : undefined;
    // Shots that already have a frame or clip on the way keep that job; never queue a duplicate.
    let allShots = shotsRepo.listByProject(projectId).filter((s) => s.status !== 'keyframe_queued' && s.status !== 'video_queued');
    if (sceneId) allShots = allShots.filter((s) => s.sceneId === sceneId);
    const scenesById = new Map(scenesRepo.listByProject(projectId).map((s) => [s.id, s]));
    // A scene with a previs + reference sheet renders its shots straight from those (see shot_video.ts's
    // scene-previs branch), so those shots need no keyframe of their own to be queued for video.
    const scenePrevisReady = (shot: Shot) => {
      const scene = scenesById.get(shot.sceneId);
      return Boolean(scene?.previsAssetId && scene?.referenceSheetAssetId);
    };
    const jobs: Job[] = [];
    if (what === 'keyframes' || what === 'all') {
      const needKeyframes = allShots.filter((s) => !(onlyMissing && s.keyframeAssetId));
      // The queue runs in order, so references finish before the keyframes that use them.
      if (needKeyframes.length && (await isEngineAvailable(comfy, 'qwen_edit'))) jobs.push(...enqueueMissingReferences(project, needKeyframes));
      for (const shot of allShots) {
        if (onlyMissing && shot.keyframeAssetId) continue;
        shotsRepo.update(shot.id, { status: 'keyframe_queued' });
        jobs.push(enqueue({ type: 'shot_keyframe', title: `Keyframe: ${shotLabel(shot)}`, params: { shotId: shot.id }, projectId, shotId: shot.id }));
      }
    }
    if (what === 'videos' || what === 'all') {
      for (const shot of allShots) {
        if (onlyMissing && shot.videoAssetId) continue;
        if (!shot.keyframeAssetId && what === 'videos' && !scenePrevisReady(shot)) continue; // can't render video without a keyframe (or a scene previs) yet
        shotsRepo.update(shot.id, { status: 'video_queued' });
        jobs.push(enqueue({ type: 'shot_video', title: `Video: ${shotLabel(shot)}`, params: { shotId: shot.id }, projectId, shotId: shot.id }));
      }
    }
    return c.json(jobs.map(withStatusUrl), 202);
  });

  app.post('/api/projects/:id/export', (c) => {
    const projectId = c.req.param('id');
    const project = projectsRepo.get(projectId);
    if (!project) return c.json({ error: 'not found' }, 404);
    const job = enqueue({ type: 'project_export', title: `Export: ${project.name}`, params: { projectId }, projectId });
    return c.json(withStatusUrl(job), 202);
  });

  // The whole storyboard in one request (agents): ?validate=1 checks it and returns shot previews without
  // writing; otherwise it is appended to the project. An Idempotency-Key makes retries safe for 24 h.
  app.post('/api/projects/:id/storyboard', async (c) => {
    const project = projectsRepo.get(c.req.param('id'));
    if (!project) return c.json({ error: 'not found' }, 404);
    const validateOnly = c.req.query('validate') === '1';
    const key = c.req.header('idempotency-key')?.slice(0, 200);
    if (key && !validateOnly) {
      const hit = rememberedResponse(project.id, key);
      if (hit) return c.json(hit.body as object, hit.status as 200);
    }
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: 'body must be JSON' }, 400);
    const check = checkStoryboard(project, body, await storyboardEnv());
    const { plan, resolved, ...report } = check;
    if (!check.ok || validateOnly || !plan || !resolved) return c.json(report, check.ok ? 200 : 422);
    const detail = writeStoryboard(project, plan, resolved);
    const response = { ...report, project: detail };
    if (key) rememberResponse(project.id, key, 201, response);
    return c.json(response, 201);
  });

  async function storyboardEnv(): Promise<StoryboardEnv> {
    return storyboardEnvFrom(await getSystemInfo(comfy));
  }

  app.post('/api/projects/:id/breakdown', async (c) => {
    const projectId = c.req.param('id');
    const project = projectsRepo.get(projectId);
    if (!project) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (!body.script) return c.json({ error: 'missing script' }, 400);
    try {
      const draft: BreakdownDraft = await generateBreakdown({
        script: body.script,
        existingCharacters: charactersRepo.list().map((ch) => ({ name: ch.name, description: ch.description })),
        existingLocations: locationsRepo.list().map((l) => ({ name: l.name, description: l.description })),
        videoModel: await currentVideoModel(comfy),
      });
      return c.json(draft);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'LLM not configured' ? 400 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.post('/api/projects/:id/breakdown/apply', async (c) => {
    const projectId = c.req.param('id');
    if (!projectsRepo.get(projectId)) return c.json({ error: 'not found' }, 404);
    const draft = (await c.req.json().catch(() => ({}))) as BreakdownDraft;
    try {
      const detail = applyBreakdown(projectId, draft);
      return c.json(detail);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  return app;
}

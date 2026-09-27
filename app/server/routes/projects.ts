import { Hono } from 'hono';
import {
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
import { buildShotPlan, type ShotContext } from '../pipeline/prompts';
import { currentVideoModel, isEngineAvailable } from '../system';
import { aimCamera, completeBlocking, defaultLocationMap, placeCamera } from '../../shared/camera';
import { generateBreakdown, applyBreakdown } from '../ai/breakdown';
import type { ComfyClient } from '../comfy/client';
import type { BreakdownDraft, Character, ID, Job, Project, ProjectDetail, Scene, Shot } from '../../shared/types';

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
  const characters = shot.characterIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
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
    const updated = scenesRepo.update(c.req.param('id'), body);
    if (!updated) return c.json({ error: 'not found' }, 404);
    if ('blocking' in body || 'locationId' in body) {
      for (const shot of shotsRepo.listByScene(updated.id)) {
        const camera = reaimed(shot, updated.blocking, updated.locationId);
        if (camera) emit({ type: 'shot', shot: shotsRepo.update(shot.id, { camera })! });
      }
    }
    return c.json(updated);
  });

  app.delete('/api/scenes/:id', (c) => {
    scenesRepo.delete(c.req.param('id'));
    return c.json({ ok: true });
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
    let updated = shotsRepo.update(c.req.param('id'), body);
    if (!updated) return c.json({ error: 'not found' }, 404);
    if (!body.camera && ('characterIds' in body || 'shotSize' in body || 'blocking' in body)) {
      const scene = scenesRepo.get(updated.sceneId);
      const camera = scene ? reaimed(updated, scene.blocking, scene.locationId) : undefined;
      if (camera) updated = shotsRepo.update(updated.id, { camera }) ?? updated;
    }
    emit({ type: 'shot', shot: updated });
    return c.json(updated);
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
    return c.json(job);
  });

  app.post('/api/shots/:id/video', (c) => {
    const shot = shotsRepo.get(c.req.param('id'));
    if (!shot) return c.json({ error: 'not found' }, 404);
    if (!shot.keyframeAssetId) return c.json({ error: 'shot has no keyframe' }, 400);
    const scene = scenesRepo.get(shot.sceneId)!;
    const updated = shotsRepo.update(shot.id, { status: 'video_queued' });
    if (updated) emit({ type: 'shot', shot: updated });
    const job = enqueue({
      type: 'shot_video',
      title: `Video: ${shotLabel(shot)}`,
      params: { shotId: shot.id },
      projectId: scene.projectId,
      shotId: shot.id,
    });
    return c.json(job);
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
    // Shots that already have a frame or clip on the way keep that job; never queue a duplicate.
    const allShots = shotsRepo.listByProject(projectId).filter((s) => s.status !== 'keyframe_queued' && s.status !== 'video_queued');
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
        if (!shot.keyframeAssetId && what === 'videos') continue; // can't render video without a keyframe yet
        shotsRepo.update(shot.id, { status: 'video_queued' });
        jobs.push(enqueue({ type: 'shot_video', title: `Video: ${shotLabel(shot)}`, params: { shotId: shot.id }, projectId, shotId: shot.id }));
      }
    }
    return c.json(jobs);
  });

  app.post('/api/projects/:id/export', (c) => {
    const projectId = c.req.param('id');
    const project = projectsRepo.get(projectId);
    if (!project) return c.json({ error: 'not found' }, 404);
    const job = enqueue({ type: 'project_export', title: `Export: ${project.name}`, params: { projectId }, projectId });
    return c.json(job);
  });

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

// 'shot_keyframe' job: renders (or composes) a shot's keyframe still per the shot pipeline
// (see docs/ARCHITECTURE.md "The shot pipeline" and prompts.ts).
import { registerRunner } from './queue';
import {
  assets as assetsRepo,
  characters as charactersRepo,
  locations as locationsRepo,
  loras as lorasRepo,
  projects as projectsRepo,
  scenes as scenesRepo,
  shots as shotsRepo,
  styles as stylesRepo,
} from '../db';
import { emit } from '../events';
import { buildQwenEdit, buildZImage } from '../comfy/workflows';
import { angleKey } from '../../shared/camera';
import { IMAGE_SIZES } from '../../shared/presets';
import { resolveSeed, saveComfyOutput, toLoraFiles, uploadAssetToComfy } from './media';
import { isEngineAvailable } from '../system';
import { buildShotPlan, resolveComposeLoras, resolveGenerateLoras, type ShotContext } from './prompts';
import type { Character, ID, Lora } from '../../shared/types';

function loadShotContext(shotId: ID): { ctx: ShotContext; shotId: ID } {
  const shot = shotsRepo.get(shotId);
  if (!shot) throw new Error('Shot not found');
  const scene = scenesRepo.get(shot.sceneId);
  if (!scene) throw new Error('Scene not found');
  const project = projectsRepo.get(scene.projectId);
  if (!project) throw new Error('Project not found');
  const location = scene.locationId ? locationsRepo.get(scene.locationId) : undefined;
  const characters = shot.characterIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
  const style = project.styleId ? stylesRepo.get(project.styleId) : undefined;
  return { ctx: { project, scene, shot, location, characters, castNames: charactersRepo.list().map((c) => c.name), style, editEngineAvailable: false }, shotId };
}

registerRunner('shot_keyframe', async (job, ctx) => {
  const params = job.params as { shotId?: string };
  const shotId = String(params.shotId ?? '');
  const { ctx: shotCtx } = loadShotContext(shotId);
  shotCtx.editEngineAvailable = await isEngineAvailable(ctx.comfy, 'qwen_edit');

  try {
    const plan = buildShotPlan(shotCtx);
    const loraLookup = new Map<ID, Lora>(lorasRepo.list().map((l) => [l.id, l]));

    let keyframeAssetId: ID;

    if (plan.mode === 'compose') {
      const location = shotCtx.location!;
      let plateAssetId: ID;
      if (plan.usesEstablishingDirectly) {
        plateAssetId = location.establishingAssetId!;
        ctx.setProgress(0.3, 'Using establishing plate');
      } else if (plan.cachedAngleAssetId) {
        plateAssetId = plan.cachedAngleAssetId;
        ctx.setProgress(0.3, 'Using cached angle plate');
      } else {
        const establishing = assetsRepo.get(location.establishingAssetId!);
        if (!establishing) throw new Error('Establishing asset is missing on disk');
        const imageName = await uploadAssetToComfy(ctx.comfy, establishing);
        const seed = resolveSeed(shotCtx.shot.seed);
        const workflow = buildQwenEdit({ images: [imageName], prompt: plan.anglePlatePrompt, seed, angles: true });
        const promptId = await ctx.comfy.queuePrompt(workflow);
        await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac * 0.4, 'Rendering angle plate'));
        const outputs = await ctx.comfy.getOutputs(promptId);
        const file = outputs[0];
        if (!file) throw new Error('No angle plate produced');
        const plateAsset = await saveComfyOutput(ctx.comfy, file, {
          origin: 'generated',
          prompt: plan.anglePlatePrompt,
          engine: 'qwen_angle',
          params: { locationId: location.id, angle: plan.angle, seed },
          jobId: job.id,
        });
        ctx.addOutput(plateAsset.id);
        plateAssetId = plateAsset.id;
        const key = angleKey(plan.angle);
        const updatedLocation = locationsRepo.update(location.id, {
          angleViews: [...location.angleViews.filter((v) => v.key !== key), { key, assetId: plateAssetId }],
        });
        if (updatedLocation) emit({ type: 'location', location: updatedLocation });
      }

      const plate = assetsRepo.get(plateAssetId);
      if (!plate) throw new Error('Angle plate asset is missing on disk');
      const plateImageName = await uploadAssetToComfy(ctx.comfy, plate);
      const refImageNames: string[] = [];
      for (const c of plan.composeReferenceCharacters) {
        const refAssetId = c.referenceAssetIds[0];
        const refAsset = refAssetId ? assetsRepo.get(refAssetId) : undefined;
        if (refAsset) refImageNames.push(await uploadAssetToComfy(ctx.comfy, refAsset));
      }
      const images = [plateImageName, ...refImageNames].slice(0, 3);
      const seed = resolveSeed(shotCtx.shot.seed);
      const composeLoras = toLoraFiles(resolveComposeLoras(shotCtx, loraLookup));
      const workflow = buildQwenEdit({ images, prompt: plan.keyframePrompt, seed, loras: composeLoras });
      const promptId = await ctx.comfy.queuePrompt(workflow);
      await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(0.4 + frac * 0.6, 'Composing keyframe'));
      const outputs = await ctx.comfy.getOutputs(promptId);
      const file = outputs[0];
      if (!file) throw new Error('No keyframe produced');
      const keyframeAsset = await saveComfyOutput(ctx.comfy, file, {
        origin: 'generated',
        prompt: plan.keyframePrompt,
        engine: 'qwen_edit',
        params: { shotId, seed },
        jobId: job.id,
        projectId: shotCtx.project.id,
        shotId,
      });
      ctx.addOutput(keyframeAsset.id);
      keyframeAssetId = keyframeAsset.id;
    } else {
      const size = IMAGE_SIZES[shotCtx.project.aspect];
      const seed = resolveSeed(shotCtx.shot.seed);
      const genLoras = toLoraFiles(resolveGenerateLoras(shotCtx, loraLookup));
      const workflow = buildZImage({ prompt: plan.keyframePrompt, width: size.width, height: size.height, seed, batch: 1, loras: genLoras });
      const promptId = await ctx.comfy.queuePrompt(workflow);
      await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Rendering keyframe'));
      const outputs = await ctx.comfy.getOutputs(promptId);
      const file = outputs[0];
      if (!file) throw new Error('No keyframe produced');
      const keyframeAsset = await saveComfyOutput(ctx.comfy, file, {
        origin: 'generated',
        prompt: plan.keyframePrompt,
        engine: 'zimage',
        params: { shotId, seed },
        jobId: job.id,
        projectId: shotCtx.project.id,
        shotId,
      });
      ctx.addOutput(keyframeAsset.id);
      keyframeAssetId = keyframeAsset.id;
    }

    const shot = shotsRepo.get(shotId)!;
    const prevKeyframe = shot.keyframeAssetId;
    const candidates = prevKeyframe ? [prevKeyframe, ...shot.keyframeCandidates].slice(0, 10) : shot.keyframeCandidates;
    const updated = shotsRepo.update(shotId, {
      keyframeAssetId,
      keyframeCandidates: candidates,
      status: 'keyframe_ready',
      error: undefined,
    })!;
    emit({ type: 'shot', shot: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== 'canceled') {
      const updated = shotsRepo.update(shotId, { status: 'error', error: message });
      if (updated) emit({ type: 'shot', shot: updated });
    }
    throw err;
  }
});

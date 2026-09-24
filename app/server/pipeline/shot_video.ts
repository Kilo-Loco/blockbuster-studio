// 'shot_video' job: Wan 2.2 I2V motion pass from the shot's keyframe.
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
import { buildWanI2V } from '../comfy/workflows';
import { VIDEO_SIZES, WAN_NEGATIVE, framesForDuration } from '../../shared/presets';
import { assertPromptsAllowed } from './guard';
import { resolveSeed, saveComfyOutput, toLoraFiles, uploadAssetToComfy } from './media';
import { isEngineAvailable } from '../system';
import { buildShotPlan, resolveMotionLoras, type ShotContext } from './prompts';
import type { Character, ID, Lora } from '../../shared/types';

registerRunner('shot_video', async (job, ctx) => {
  const params = job.params as { shotId?: string };
  const shotId = String(params.shotId ?? '');
  const shot = shotsRepo.get(shotId);
  if (!shot) throw new Error('Shot not found');
  if (!shot.keyframeAssetId) throw new Error('Shot has no keyframe');
  const scene = scenesRepo.get(shot.sceneId);
  if (!scene) throw new Error('Scene not found');
  const project = projectsRepo.get(scene.projectId);
  if (!project) throw new Error('Project not found');
  const location = scene.locationId ? locationsRepo.get(scene.locationId) : undefined;
  const characters = shot.characterIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
  const style = project.styleId ? stylesRepo.get(project.styleId) : undefined;
  const editEngineAvailable = await isEngineAvailable(ctx.comfy, 'qwen_edit');
  const shotCtx: ShotContext = { project, scene, shot, location, characters, style, editEngineAvailable };

  try {
    const plan = buildShotPlan(shotCtx);
    assertPromptsAllowed(plan.motionPrompt);
    const loraLookup = new Map<ID, Lora>(lorasRepo.list().map((l) => [l.id, l]));
    const motionLoras = toLoraFiles(resolveMotionLoras(shotCtx, loraLookup));

    const keyframeAsset = assetsRepo.get(shot.keyframeAssetId);
    if (!keyframeAsset) throw new Error('Keyframe asset is missing on disk');
    const startImage = await uploadAssetToComfy(ctx.comfy, keyframeAsset);
    // Studio composer offers 'fast'/'hd' quality; shots default to 'fast' (see ARCHITECTURE.md GPU policy).
    const size = VIDEO_SIZES.fast[project.aspect];
    const length = framesForDuration(shot.durationSec);
    const seed = resolveSeed(shot.seed);
    const workflow = buildWanI2V({
      prompt: plan.motionPrompt,
      negativePrompt: WAN_NEGATIVE,
      width: size.width,
      height: size.height,
      length,
      fps: 16,
      seed,
      startImage,
      loras: motionLoras,
    });
    const promptId = await ctx.comfy.queuePrompt(workflow);
    await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Animating'));
    const outputs = await ctx.comfy.getOutputs(promptId);
    const file = outputs[0];
    if (!file) throw new Error('No video produced');
    const videoAsset = await saveComfyOutput(ctx.comfy, file, {
      origin: 'generated',
      prompt: plan.motionPrompt,
      engine: 'wan_i2v',
      params: { shotId, seed },
      jobId: job.id,
      projectId: project.id,
      shotId,
      fps: 16,
    });
    ctx.addOutput(videoAsset.id);

    const current = shotsRepo.get(shotId)!;
    const prevVideo = current.videoAssetId;
    const candidates = prevVideo ? [prevVideo, ...current.videoCandidates].slice(0, 10) : current.videoCandidates;
    const updated = shotsRepo.update(shotId, {
      videoAssetId: videoAsset.id,
      videoCandidates: candidates,
      status: 'video_ready',
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

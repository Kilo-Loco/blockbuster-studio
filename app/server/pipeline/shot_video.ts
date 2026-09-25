// 'shot_video' job: image-to-video motion pass from the shot's keyframe (Wan 2.2, or MiniMax H3 when installed).
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
import { WAN_NEGATIVE } from '../../shared/presets';
import { pickVideoModel, renderClip } from './video_backend';
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
  const shotCtx: ShotContext = { project, scene, shot, location, characters, castNames: charactersRepo.list().map((c) => c.name), style, editEngineAvailable };

  try {
    const plan = buildShotPlan(shotCtx);
    assertPromptsAllowed(plan.motionPrompt);
    const loraLookup = new Map<ID, Lora>(lorasRepo.list().map((l) => [l.id, l]));
    const motionLoras = toLoraFiles(resolveMotionLoras(shotCtx, loraLookup));

    const keyframeAsset = assetsRepo.get(shot.keyframeAssetId);
    if (!keyframeAsset) throw new Error('Keyframe asset is missing on disk');
    const startImage = await uploadAssetToComfy(ctx.comfy, keyframeAsset);
    const seed = resolveSeed(shot.seed);
    const model = await pickVideoModel(ctx.comfy, { loras: motionLoras, textOnly: false });
    if (!model) throw new Error('No video model is installed on this pod');
    // Studio composer offers 'fast'/'hd' quality; shots default to 'fast' (see ARCHITECTURE.md GPU policy).
    const clip = await renderClip(
      ctx.comfy,
      model,
      {
        prompt: plan.motionPrompt,
        negativePrompt: WAN_NEGATIVE,
        aspect: project.aspect,
        quality: 'fast',
        durationSec: shot.durationSec,
        seed,
        startImage,
        loras: motionLoras,
      },
      (frac) => ctx.setProgress(frac, 'Animating'),
    );
    const file = clip.files[0];
    if (!file) throw new Error('No video produced');
    const videoAsset = await saveComfyOutput(ctx.comfy, file, {
      origin: 'generated',
      prompt: plan.motionPrompt,
      engine: 'wan_i2v',
      params: { shotId, seed, videoModel: clip.model },
      jobId: job.id,
      projectId: project.id,
      shotId,
      fps: clip.fps,
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

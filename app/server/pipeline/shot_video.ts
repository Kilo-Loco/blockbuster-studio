// 'shot_video' job: image-to-video motion pass from the shot's keyframe (Wan 2.2, or MiniMax H3 / LTX-2.5 when installed).
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
import { WAN_NEGATIVE, clampDuration } from '../../shared/presets';
import { lineState } from '../../shared/dialogue';
import { pickVideoModel, renderClip } from './video_backend';
import { assetDiskPath, hasFfmpeg, resolveSeed, saveComfyOutput, toLoraFiles, uploadAssetToComfy } from './media';
import { lineForClip } from '../voice/room';
import { LTX_FPS, ltxFramesForDuration } from '../comfy/workflows';
import type { ComfyClient } from '../comfy/client';
import type { Shot } from '../../shared/types';
import { isEngineAvailable } from '../system';
import { buildShotPlan, resolveMotionLoras, type ShotContext } from './prompts';
import type { Character, ID, Lora } from '../../shared/types';

/** LTX-2.5 lip sync: the shot's current recorded line as a clip-length WAV in ComfyUI's input folder, or
 *  undefined (no line, out of date, or no ffmpeg), in which case LTX voices the line itself. */
async function lineAudioForLtx(comfy: ComfyClient, shot: Shot, cast: Character[]): Promise<string | undefined> {
  if (!shot.dialogueAudioAssetId || lineState(shot, cast) !== 'ready' || !(await hasFfmpeg())) return undefined;
  const line = assetsRepo.get(shot.dialogueAudioAssetId);
  if (!line) return undefined;
  // Lip-synced shots render in HD (see below); LTX-2.5 has no HD length cap, so this is the shot's length.
  const clipSec = ltxFramesForDuration(clampDuration(shot.durationSec, 'ltx_2_5', { quality: 'hd' })) / LTX_FPS;
  const wav = await lineForClip(assetDiskPath(line), clipSec);
  return comfy.uploadImage(wav, `line_${shot.id}.wav`);
}

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
    const loraLookup = new Map<ID, Lora>(lorasRepo.list().map((l) => [l.id, l]));
    const motionLoras = toLoraFiles(resolveMotionLoras(shotCtx, loraLookup));

    const keyframeAsset = assetsRepo.get(shot.keyframeAssetId);
    if (!keyframeAsset) throw new Error('Keyframe asset is missing on disk');
    const startImage = await uploadAssetToComfy(ctx.comfy, keyframeAsset);
    const seed = resolveSeed(shot.seed);
    const model = await pickVideoModel(ctx.comfy, { loras: motionLoras, textOnly: false });
    if (!model) throw new Error('No video model is installed on this pod');
    const audioFile = model === 'ltx_2_5' ? await lineAudioForLtx(ctx.comfy, shot, characters) : undefined;
    // Shots render at 'fast' (see ARCHITECTURE.md GPU policy), except lip-synced ones: the mouth is where
    // lip sync is judged, and at 832x512 it's a few pixels wide (HD looked clearly better on a 4090 close-up).
    const quality = audioFile ? 'hd' : 'fast';
    const clip = await renderClip(
      ctx.comfy,
      model,
      {
        prompt: plan.motionPrompt,
        negativePrompt: WAN_NEGATIVE,
        aspect: project.aspect,
        quality,
        durationSec: shot.durationSec,
        seed,
        startImage,
        loras: motionLoras,
        audioFile,
      },
      (frac) => ctx.setProgress(frac, 'Animating'),
    );
    const file = clip.files[0];
    if (!file) throw new Error('No video produced');
    const videoAsset = await saveComfyOutput(ctx.comfy, file, {
      origin: 'generated',
      prompt: plan.motionPrompt,
      engine: 'wan_i2v',
      params: { shotId, seed, videoModel: clip.model, ...(audioFile ? { lipSync: true } : {}) },
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

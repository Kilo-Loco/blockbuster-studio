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
import { VIDEO_SIZES, WAN_FPS, WAN_NEGATIVE, clampDuration, framesForDuration } from '../../shared/presets';
import { lineState } from '../../shared/dialogue';
import { pickVideoModel, renderClip } from './video_backend';
import { assetDiskPath, compositeReferenceImages, fitImageToFrame, hasFfmpeg, prepareControlVideo, prepareReferenceVideo, resolveSeed, saveComfyOutput, toLoraFiles, uploadAssetToComfy } from './media';
import { formatH3RefPrompt } from './h3_prompt';
import { formatLtxPrompt } from './ltx_prompt';
import { gridSize } from './video_backend';
import { lineForClip } from '../voice/room';
import { H3_FPS, LTX_FPS, buildLtxIc, buildMiniMaxH3Ref, buildWanFunControl, buildWanVace, h3FramesForDuration, ltxFramesForDuration } from '../comfy/workflows';
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
  if (!shot.keyframeAssetId && !shot.referenceAssetIds?.length && !shot.referenceVideoAssetId) throw new Error('Shot has no keyframe');
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

    const seedForClip = resolveSeed(shot.seed);
    if (shot.controlVideoAssetId && shot.referenceAssetIds?.length) {
      // Control video + reference sheets together (Wan 2.2 VACE-Fun): the sheets carry identity (composited
      // into one image, WanVaceToVideo's own limit), the control video carries motion; the keyframe is not used.
      if (!(await isEngineAvailable(ctx.comfy, 'wan_vace'))) throw new Error('This shot has a control video and reference sheets but the VACE model (DOWNLOAD_WAN_VACE_MODELS) is not installed');
      const controlAsset = assetsRepo.get(shot.controlVideoAssetId);
      if (!controlAsset) throw new Error('Control video asset is missing on disk');
      const quality = shot.quality ?? 'fast';
      const size = VIDEO_SIZES[quality][project.aspect];
      const length = framesForDuration(Math.min(shot.durationSec, Math.max(1, controlAsset.durationSec ?? shot.durationSec)));
      const controlName = await ctx.comfy.uploadImage(
        await prepareControlVideo(assetDiskPath(controlAsset), { fps: WAN_FPS, width: size.width, height: size.height, frames: length }),
        `${controlAsset.id}_control.mp4`,
      );
      const refAssets = (shot.referenceAssetIds ?? []).slice(0, 4).map((id) => {
        const a = assetsRepo.get(id);
        if (!a) throw new Error(`Reference asset ${id} is missing on disk`);
        return a;
      });
      const refName = await ctx.comfy.uploadImage(await compositeReferenceImages(refAssets.map((a) => assetDiskPath(a)), size.width, size.height), `${controlAsset.id}_vace_ref.png`);
      const workflow = buildWanVace({
        prompt: plan.motionPrompt,
        negativePrompt: WAN_NEGATIVE,
        width: size.width,
        height: size.height,
        length,
        fps: WAN_FPS,
        seed: seedForClip,
        loras: motionLoras.filter((l) => (l.family ?? 'wan22') === 'wan22'),
        controlVideo: controlName,
        refImage: refName,
        preprocess: shot.controlPreprocess ?? 'canny',
      });
      const promptId = await ctx.comfy.queuePrompt(workflow);
      await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Animating (control video + references)'));
      const [file] = await ctx.comfy.getOutputs(promptId);
      if (!file) throw new Error('No video produced');
      const videoAsset = await saveComfyOutput(ctx.comfy, file, {
        origin: 'generated',
        prompt: plan.motionPrompt,
        engine: 'wan_vace',
        params: { shotId, seed: seedForClip, videoModel: 'wan', quality, controlVideoAssetId: controlAsset.id, controlPreprocess: shot.controlPreprocess ?? 'canny', referenceAssetIds: shot.referenceAssetIds },
        jobId: job.id,
        projectId: project.id,
        shotId,
        fps: WAN_FPS,
      });
      ctx.addOutput(videoAsset.id);
      const cur = shotsRepo.get(shotId)!;
      const prev = cur.videoAssetId;
      const updatedShot = shotsRepo.update(shotId, { videoAssetId: videoAsset.id, videoCandidates: prev ? [prev, ...cur.videoCandidates].slice(0, 10) : cur.videoCandidates, status: 'video_ready', error: undefined })!;
      emit({ type: 'shot', shot: updatedShot });
      return;
    }
    if (shot.referenceAssetIds?.length || shot.referenceVideoAssetId) {
      // Reference-to-video (MiniMax H3 Ref2VA): the sheets carry identity, the reference video carries camera and
      // timing, the prompt carries the action; the keyframe is not used.
      if (!(await isEngineAvailable(ctx.comfy, 'h3_ref'))) throw new Error('This shot has references but the reference model (DOWNLOAD_MINIMAX_REF_MODELS) is not installed');
      const quality = shot.quality ?? 'fast';
      const size = gridSize(quality, project.aspect, 32);
      const length = h3FramesForDuration(clampDuration(shot.durationSec, 'minimax_h3', { quality }));
      const refAssets = (shot.referenceAssetIds ?? []).slice(0, 9).map((id) => {
        const a = assetsRepo.get(id);
        if (!a) throw new Error(`Reference asset ${id} is missing on disk`);
        return a;
      });
      const refImages: string[] = [];
      for (const a of refAssets) refImages.push(await uploadAssetToComfy(ctx.comfy, a));
      const refVideos: string[] = [];
      if (shot.referenceVideoAssetId) {
        const v = assetsRepo.get(shot.referenceVideoAssetId);
        if (!v) throw new Error('Reference video asset is missing on disk');
        refVideos.push(await ctx.comfy.uploadImage(await prepareReferenceVideo(assetDiskPath(v), { width: size.width, height: size.height, maxSec: 15 }), `${v.id}_ref24.mp4`));
      }
      // Labels: the character whose reference sheet this is, else the asset's own prompt.
      const labels = refAssets.map((a, i) => {
        const owner = characters.find((c) => c.referenceAssetIds.includes(a.id));
        return owner ? `${owner.name} (${owner.description})` : a.prompt?.slice(0, 80) || `reference image ${i + 1}`;
      });
      const prompt = formatH3RefPrompt(plan.motionPrompt, { imageLabels: labels, videoLabels: refVideos.length ? ['the reference video for this shot'] : [] });
      const workflow = buildMiniMaxH3Ref({ prompt, width: size.width, height: size.height, length, seed: seedForClip, refImages, refVideos, loras: motionLoras.filter((l) => l.family === 'minimax_h3') });
      const promptId = await ctx.comfy.queuePrompt(workflow);
      await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Animating (references)'));
      const [file] = await ctx.comfy.getOutputs(promptId);
      if (!file) throw new Error('No video produced');
      const videoAsset = await saveComfyOutput(ctx.comfy, file, { origin: 'generated', prompt, engine: 'h3_ref', params: { shotId, seed: seedForClip, videoModel: 'minimax_h3', quality, referenceAssetIds: shot.referenceAssetIds, referenceVideoAssetId: shot.referenceVideoAssetId }, jobId: job.id, projectId: project.id, shotId, fps: H3_FPS });
      ctx.addOutput(videoAsset.id);
      const cur = shotsRepo.get(shotId)!;
      const prev = cur.videoAssetId;
      const updatedShot = shotsRepo.update(shotId, { videoAssetId: videoAsset.id, videoCandidates: prev ? [prev, ...cur.videoCandidates].slice(0, 10) : cur.videoCandidates, status: 'video_ready', error: undefined })!;
      emit({ type: 'shot', shot: updatedShot });
      return;
    }
    const keyframeAsset = shot.keyframeAssetId ? assetsRepo.get(shot.keyframeAssetId) : undefined;
    if (!keyframeAsset) throw new Error('Keyframe asset is missing on disk');
    const controlAsset = shot.controlVideoAssetId ? assetsRepo.get(shot.controlVideoAssetId) : undefined;
    if (shot.controlVideoAssetId && !controlAsset) throw new Error('Control video asset is missing on disk');
    if (controlAsset && shot.videoModel === 'ltx_2_5' && (await isEngineAvailable(ctx.comfy, 'ltx_ic'))) {
      // Control video, rendered by LTX-2.5's IC-LoRA union control instead of Wan Fun-Control (the shot's
      // videoModel picked LTX-2.5): the keyframe is the reference for identity and look, with sound.
      const quality = shot.quality ?? 'fast';
      const size = gridSize(quality, project.aspect, 64);
      const sec = Math.min(clampDuration(shot.durationSec, 'ltx_2_5', { quality }), Math.max(1, controlAsset.durationSec ?? shot.durationSec));
      const length = ltxFramesForDuration(sec);
      const controlName = await ctx.comfy.uploadImage(
        await prepareControlVideo(assetDiskPath(controlAsset), { fps: LTX_FPS, width: size.width, height: size.height, frames: length }),
        `${controlAsset.id}_control.mp4`,
      );
      const refName = await ctx.comfy.uploadImage(await fitImageToFrame(assetDiskPath(keyframeAsset), size.width, size.height, 'crop'), `${keyframeAsset.id}_ref.png`);
      const prompt = formatLtxPrompt(plan.motionPrompt, { firstFrame: true });
      const workflow = buildLtxIc({
        prompt,
        width: size.width,
        height: size.height,
        length,
        seed: seedForClip,
        controlVideo: controlName,
        refImage: refName,
        preprocess: shot.controlPreprocess ?? 'canny',
        loras: motionLoras.filter((l) => l.family === 'ltx2'),
      });
      const promptId = await ctx.comfy.queuePrompt(workflow);
      await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Animating (control video)'));
      const [file] = await ctx.comfy.getOutputs(promptId);
      if (!file) throw new Error('No video produced');
      const videoAsset = await saveComfyOutput(ctx.comfy, file, {
        origin: 'generated',
        prompt,
        engine: 'ltx_ic',
        params: { shotId, seed: seedForClip, videoModel: 'ltx_2_5', quality, controlVideoAssetId: controlAsset.id, controlPreprocess: shot.controlPreprocess ?? 'canny' },
        jobId: job.id,
        projectId: project.id,
        shotId,
        fps: LTX_FPS,
      });
      ctx.addOutput(videoAsset.id);
      const cur = shotsRepo.get(shotId)!;
      const prev = cur.videoAssetId;
      const updatedShot = shotsRepo.update(shotId, {
        videoAssetId: videoAsset.id,
        videoCandidates: prev ? [prev, ...cur.videoCandidates].slice(0, 10) : cur.videoCandidates,
        status: 'video_ready',
        error: undefined,
      })!;
      emit({ type: 'shot', shot: updatedShot });
      return;
    }
    if (controlAsset) {
      // Control video: the clip follows its motion frame by frame (Wan 2.2 Fun-Control); the keyframe is the
      // reference for identity and look. Renders at the shot's quality.
      if (!(await isEngineAvailable(ctx.comfy, 'wan_control'))) throw new Error('This shot has a control video but the control model (DOWNLOAD_CONTROL_MODELS) is not installed');
      const quality = shot.quality ?? 'fast';
      const size = VIDEO_SIZES[quality][project.aspect];
      const length = framesForDuration(Math.min(shot.durationSec, Math.max(1, controlAsset.durationSec ?? shot.durationSec)));
      const controlName = await ctx.comfy.uploadImage(
        await prepareControlVideo(assetDiskPath(controlAsset), { fps: WAN_FPS, width: size.width, height: size.height, frames: length }),
        `${controlAsset.id}_control.mp4`,
      );
      const refName = await ctx.comfy.uploadImage(await fitImageToFrame(assetDiskPath(keyframeAsset), size.width, size.height, 'crop'), `${keyframeAsset.id}_ref.png`);
      const workflow = buildWanFunControl({
        prompt: plan.motionPrompt,
        negativePrompt: WAN_NEGATIVE,
        width: size.width,
        height: size.height,
        length,
        fps: WAN_FPS,
        seed: seedForClip,
        loras: motionLoras.filter((l) => (l.family ?? 'wan22') === 'wan22'),
        controlVideo: controlName,
        refImage: refName,
        preprocess: shot.controlPreprocess ?? 'canny',
      });
      const promptId = await ctx.comfy.queuePrompt(workflow);
      await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Animating (control video)'));
      const [file] = await ctx.comfy.getOutputs(promptId);
      if (!file) throw new Error('No video produced');
      const videoAsset = await saveComfyOutput(ctx.comfy, file, {
        origin: 'generated',
        prompt: plan.motionPrompt,
        engine: 'wan_control',
        params: { shotId, seed: seedForClip, videoModel: 'wan', quality, controlVideoAssetId: controlAsset.id, controlPreprocess: shot.controlPreprocess ?? 'canny' },
        jobId: job.id,
        projectId: project.id,
        shotId,
        fps: WAN_FPS,
      });
      ctx.addOutput(videoAsset.id);
      const cur = shotsRepo.get(shotId)!;
      const prev = cur.videoAssetId;
      const updatedShot = shotsRepo.update(shotId, {
        videoAssetId: videoAsset.id,
        videoCandidates: prev ? [prev, ...cur.videoCandidates].slice(0, 10) : cur.videoCandidates,
        status: 'video_ready',
        error: undefined,
      })!;
      emit({ type: 'shot', shot: updatedShot });
      return;
    }
    const startImage = await uploadAssetToComfy(ctx.comfy, keyframeAsset);
    // An end frame (a second keyframe or a previs render) turns the clip into first/last-frame mode on every model.
    const endAsset = shot.endKeyframeAssetId ? assetsRepo.get(shot.endKeyframeAssetId) : undefined;
    if (shot.endKeyframeAssetId && !endAsset) throw new Error('End frame asset is missing on disk');
    const endImage = endAsset ? await uploadAssetToComfy(ctx.comfy, endAsset) : undefined;
    const seed = seedForClip;
    const model = await pickVideoModel(ctx.comfy, { loras: motionLoras, textOnly: false, prefer: shot.videoModel });
    if (!model) throw new Error('No video model is installed on this pod');
    const audioFile = model === 'ltx_2_5' ? await lineAudioForLtx(ctx.comfy, shot, characters) : undefined;
    // Shots render at 'fast' (see ARCHITECTURE.md GPU policy), except lip-synced ones: the mouth is where
    // lip sync is judged, and at 832x512 it's a few pixels wide (HD looked clearly better on a 4090 close-up).
    const quality = audioFile ? 'hd' : (shot.quality ?? 'fast');
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
        endImage,
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
      params: { shotId, seed, videoModel: clip.model, quality, ...(endImage ? { endKeyframeAssetId: shot.endKeyframeAssetId } : {}), ...(audioFile ? { lipSync: true } : {}) },
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

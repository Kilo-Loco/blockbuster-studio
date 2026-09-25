// The 'generate' job type: the Studio composer's free-form request across all engines.
// See docs/API.md "Engine semantics for POST /api/generate".
import type { Job, GenerateRequest } from '../../shared/types';
import { registerRunner, type RunnerContext } from './queue';
import { assets as assetsRepo } from '../db';
import { buildQwenEdit, buildWanAnimate2, buildZImage, type LoraFile } from '../comfy/workflows';
import { CAMERA_MOVE_BY_ID, IMAGE_SIZES, VIDEO_SIZES, WAN_FPS, WAN_NEGATIVE, framesForDuration } from '../../shared/presets';
import { pickVideoModel, renderClip, type ClipRequest, type ClipResult } from './video_backend';
import { assertPromptsAllowed } from './guard';
import { assetDiskPath, fitImageToFrame, resampleVideo, resolveSeed, saveComfyOutput, toLoraFiles, uploadAssetToComfy } from './media';
import { computeFileAvailability, isEngineAvailable } from '../system';

function requireAsset(id: string) {
  const asset = assetsRepo.get(id);
  if (!asset) throw new Error(`Input asset ${id} not found`);
  return asset;
}

async function uploadInputs(ctx: RunnerContext, ids: string[] | undefined): Promise<string[]> {
  const list = ids ?? [];
  const names: string[] = [];
  for (const id of list) names.push(await uploadAssetToComfy(ctx.comfy, requireAsset(id)));
  return names;
}

function clipRequest(req: GenerateRequest, prompt: string, seed: number, loras: LoraFile[], startImage?: string): ClipRequest {
  return {
    prompt,
    negativePrompt: req.negativePrompt || WAN_NEGATIVE,
    aspect: req.aspect,
    quality: req.quality ?? 'fast',
    durationSec: req.durationSec ?? 5,
    seed,
    startImage,
    loras,
  };
}

async function saveClip(ctx: RunnerContext, job: Job, req: GenerateRequest, clip: ClipResult, prompt: string, engine: 'wan_i2v' | 'wan_t2v', seed: number) {
  for (const file of clip.files) {
    const asset = await saveComfyOutput(ctx.comfy, file, {
      origin: 'generated',
      prompt,
      engine,
      params: { ...req, seed, videoModel: clip.model },
      jobId: job.id,
      projectId: req.projectId,
      shotId: req.shotId,
      fps: clip.fps,
    });
    ctx.addOutput(asset.id);
  }
}

export function registerGenerateRunner() {
  registerRunner('generate', async (job: Job, ctx: RunnerContext) => {
    const req = job.params as unknown as GenerateRequest;
    assertPromptsAllowed(req.prompt, req.negativePrompt);
    const count = Math.max(1, Math.min(4, req.count ?? 1));
    const loras = toLoraFiles(req.loras);

    switch (req.engine) {
      case 'zimage': {
        const size = IMAGE_SIZES[req.aspect];
        const seed = resolveSeed(req.seed);
        const workflow = buildZImage({ prompt: req.prompt, width: size.width, height: size.height, seed, batch: count, loras });
        const promptId = await ctx.comfy.queuePrompt(workflow);
        await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Rendering'));
        const outputs = await ctx.comfy.getOutputs(promptId);
        for (const file of outputs) {
          const asset = await saveComfyOutput(ctx.comfy, file, {
            origin: 'generated',
            prompt: req.prompt,
            engine: 'zimage',
            params: { ...req, seed },
            jobId: job.id,
            projectId: req.projectId,
            shotId: req.shotId,
          });
          ctx.addOutput(asset.id);
        }
        break;
      }
      case 'qwen_edit': {
        const images = await uploadInputs(ctx, req.inputAssetIds);
        if (images.length < 1 || images.length > 3) throw new Error('qwen_edit needs 1-3 input images');
        for (let i = 0; i < count; i++) {
          const seed = req.seed !== undefined ? req.seed + i : resolveSeed();
          const workflow = buildQwenEdit({ images, prompt: req.prompt, seed, loras });
          const promptId = await ctx.comfy.queuePrompt(workflow);
          await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress((i + frac) / count, `Editing ${i + 1}/${count}`));
          const outputs = await ctx.comfy.getOutputs(promptId);
          for (const file of outputs) {
            const asset = await saveComfyOutput(ctx.comfy, file, {
              origin: 'generated',
              prompt: req.prompt,
              engine: 'qwen_edit',
              params: { ...req, seed },
              jobId: job.id,
              projectId: req.projectId,
              shotId: req.shotId,
            });
            ctx.addOutput(asset.id);
          }
          if (ctx.isCanceled()) return;
        }
        break;
      }
      case 'qwen_angle': {
        if (!req.angle) throw new Error('qwen_angle requires an angle');
        const images = await uploadInputs(ctx, req.inputAssetIds?.slice(0, 1));
        if (images.length !== 1) throw new Error('qwen_angle needs exactly 1 input image');
        const { anglePrompt } = await import('../../shared/camera');
        const prompt = req.prompt ? `${anglePrompt(req.angle)} ${req.prompt}` : anglePrompt(req.angle);
        for (let i = 0; i < count; i++) {
          const seed = req.seed !== undefined ? req.seed + i : resolveSeed();
          const workflow = buildQwenEdit({ images, prompt, seed, angles: true, loras });
          const promptId = await ctx.comfy.queuePrompt(workflow);
          await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress((i + frac) / count, `Rendering angle ${i + 1}/${count}`));
          const outputs = await ctx.comfy.getOutputs(promptId);
          for (const file of outputs) {
            const asset = await saveComfyOutput(ctx.comfy, file, {
              origin: 'generated',
              prompt,
              engine: 'qwen_angle',
              params: { ...req, seed },
              jobId: job.id,
              projectId: req.projectId,
              shotId: req.shotId,
            });
            ctx.addOutput(asset.id);
          }
          if (ctx.isCanceled()) return;
        }
        break;
      }
      case 'wan_i2v': {
        const movePhrase = CAMERA_MOVE_BY_ID[req.cameraMove ?? 'static']?.phrase ?? '';
        const prompt = [req.prompt, movePhrase].filter(Boolean).join(' ');
        const images = await uploadInputs(ctx, req.inputAssetIds?.slice(0, 1));
        if (images.length !== 1) throw new Error('wan_i2v needs exactly 1 input image');
        const model = await pickVideoModel(ctx.comfy, { loras, textOnly: false });
        if (!model) throw new Error('No video model is installed on this pod');
        const videoCount = Math.max(1, Math.min(2, count));
        for (let i = 0; i < videoCount; i++) {
          const seed = req.seed !== undefined ? req.seed + i : resolveSeed();
          const clip = await renderClip(ctx.comfy, model, clipRequest(req, prompt, seed, loras, images[0]), (frac) =>
            ctx.setProgress((i + frac) / videoCount, `Animating ${i + 1}/${videoCount}`),
          );
          await saveClip(ctx, job, req, clip, prompt, 'wan_i2v', seed);
          if (ctx.isCanceled()) return;
        }
        break;
      }
      case 'wan_t2v': {
        const movePhrase = CAMERA_MOVE_BY_ID[req.cameraMove ?? 'static']?.phrase ?? '';
        const prompt = [req.prompt, movePhrase].filter(Boolean).join(' ');
        const videoCount = Math.max(1, Math.min(2, count));
        const model = await pickVideoModel(ctx.comfy, { loras, textOnly: true });
        if (!model) throw new Error('No video model is installed on this pod');
        // H3 and Wan T2V render straight from text; otherwise Z-Image keyframe → Wan I2V.
        const direct = model === 'minimax_h3' || (await computeFileAvailability(ctx.comfy)).wan_t2v;
        for (let i = 0; i < videoCount; i++) {
          const seed = req.seed !== undefined ? req.seed + i : resolveSeed();
          if (direct) {
            const clip = await renderClip(ctx.comfy, model, clipRequest(req, prompt, seed, loras), (frac) =>
              ctx.setProgress((i + frac) / videoCount, `Animating ${i + 1}/${videoCount}`),
            );
            await saveClip(ctx, job, req, clip, prompt, 'wan_t2v', seed);
          } else {
            // Weight the (cheap) keyframe stage at 20%.
            const imgSize = IMAGE_SIZES[req.aspect];
            const kfWorkflow = buildZImage({ prompt: req.prompt, width: imgSize.width, height: imgSize.height, seed, batch: 1 });
            const kfPromptId = await ctx.comfy.queuePrompt(kfWorkflow);
            await ctx.comfy.waitFor(kfPromptId, kfWorkflow, (frac) => ctx.setProgress((i + frac * 0.2) / videoCount, `Keyframe ${i + 1}/${videoCount}`));
            const kfOutputs = await ctx.comfy.getOutputs(kfPromptId);
            const kfFile = kfOutputs[0];
            if (!kfFile) throw new Error('wan_t2v fallback: no keyframe produced');
            const kfAsset = await saveComfyOutput(ctx.comfy, kfFile, {
              origin: 'generated',
              prompt: req.prompt,
              engine: 'zimage',
              params: { ...req, seed },
              jobId: job.id,
              projectId: req.projectId,
              shotId: req.shotId,
            });
            ctx.addOutput(kfAsset.id);
            const kfName = await uploadAssetToComfy(ctx.comfy, kfAsset);
            const clip = await renderClip(ctx.comfy, 'wan', clipRequest(req, prompt, seed, loras, kfName), (frac) =>
              ctx.setProgress((i + 0.2 + frac * 0.8) / videoCount, `Animating ${i + 1}/${videoCount}`),
            );
            await saveClip(ctx, job, req, clip, prompt, 'wan_t2v', seed);
          }
          if (ctx.isCanceled()) return;
        }
        break;
      }
      case 'wan_animate': {
        // Perform: [character image, driving video] → the character performing the recording.
        const [refId, videoId] = req.inputAssetIds ?? [];
        const ref = refId ? requireAsset(refId) : undefined;
        const drive = videoId ? requireAsset(videoId) : undefined;
        if (!ref || ref.kind !== 'image' || !drive || drive.kind !== 'video') {
          throw Object.assign(new Error('Perform needs a character image and a video of the performance.'), { status: 400 });
        }
        assertPromptsAllowed(req.motionPrompt, req.characterPrompt);
        const size = VIDEO_SIZES.fast[req.aspect];
        // Each segment consumes 81 frames of the recording (~4 min on a 4090). Wan works at 16 fps, so a
        // 30 fps phone clip is resampled to 16 fps first: same motion and audio, about half the render time.
        const fps = WAN_FPS;
        const frames = Math.round((drive.durationSec ?? 5) * fps);
        // Segment 1 renders 81 frames; each continuation adds 80 (its first frame overlaps the previous one).
        const segments = Math.max(1, Math.min(8, 1 + Math.ceil(Math.max(0, frames - 81) / 80)));
        // Fit (don't crop) the character into the output frame: a center-crop of a full-body portrait to
        // 16:9 keeps only the torso, and the model then has no face or feet to animate.
        let refName = await ctx.comfy.uploadImage(await fitImageToFrame(assetDiskPath(ref), size.width, size.height), `${ref.id}_fit.png`);
        // Animate 2 copies the reference image almost literally, background and padding included, and
        // barely follows the background text. So when a scene is described (and Qwen-Image-Edit is
        // installed), first stage the character in that scene at the output aspect, then animate that.
        const scene = req.prompt?.trim();
        if (scene && (await isEngineAvailable(ctx.comfy, 'qwen_edit'))) {
          const stagePrompt =
            `Replace the gray bars and the entire background with: ${scene}. ` +
            'Keep the person exactly the same: face, hair, body, clothing, proportions and pose. Show them full body, ' +
            'centered, natural lighting that matches the new scene. Photorealistic, cinematic.';
          const stageWf = buildQwenEdit({ images: [refName], prompt: stagePrompt, seed: resolveSeed() });
          const stageId = await ctx.comfy.queuePrompt(stageWf);
          await ctx.comfy.waitFor(stageId, stageWf, (frac) => ctx.setProgress(frac * 0.15, 'Placing your character in the scene'));
          const [staged] = await ctx.comfy.getOutputs(stageId);
          if (staged) {
            const stagedAsset = await saveComfyOutput(ctx.comfy, staged, { origin: 'generated', prompt: stagePrompt, engine: 'qwen_edit', jobId: job.id, projectId: req.projectId });
            refName = await ctx.comfy.uploadImage(await fitImageToFrame(assetDiskPath(stagedAsset), size.width, size.height, 'crop'), `${stagedAsset.id}_ref.png`);
          }
        }
        const videoName =
          (drive.fps ?? 30) > WAN_FPS + 0.5
            ? await ctx.comfy.uploadImage(await resampleVideo(assetDiskPath(drive), WAN_FPS), `${drive.id}_16fps.mp4`)
            : (await uploadInputs(ctx, [drive.id]))[0]!;
        const seed = req.seed ?? resolveSeed();
        const workflow = buildWanAnimate2({
          referenceImage: refName!,
          drivingVideo: videoName!,
          // Official Animate 2 prompt format: character appearance + background, on separate lines.
          prompt: [
            `Character appearance description: ${req.characterPrompt?.trim() || 'the character exactly as shown in the reference image'}.`,
            `Background description: ${req.prompt?.trim() || 'a simple, softly lit studio'}.`,
          ].join('\n'),
          motionPrompt: req.motionPrompt || 'A person moving naturally, performing to the camera.',
          negativePrompt: req.negativePrompt || WAN_NEGATIVE,
          width: size.width,
          height: size.height,
          segments,
          seed,
        });
        const promptId = await ctx.comfy.queuePrompt(workflow);
        // Progress is weighted per sampler (one per segment), so frac maps to the current part.
        await ctx.comfy.waitFor(promptId, workflow, (frac) =>
          ctx.setProgress(0.15 + frac * 0.85, segments > 1 ? `Performing · part ${Math.min(segments, Math.floor(frac * segments) + 1)} of ${segments}` : 'Performing'),
        );
        for (const file of await ctx.comfy.getOutputs(promptId)) {
          const asset = await saveComfyOutput(ctx.comfy, file, {
            origin: 'generated',
            prompt: req.prompt,
            engine: 'wan_animate',
            params: { ...req, seed, segments },
            jobId: job.id,
            projectId: req.projectId,
            shotId: req.shotId,
            fps,
          });
          ctx.addOutput(asset.id);
        }
        break;
      }
      default:
        throw new Error(`Unknown engine "${req.engine}"`);
    }
  });
}

registerGenerateRunner();

// The 'generate' job type: the Studio composer's free-form request across all engines.
// See docs/API.md "Engine semantics for POST /api/generate".
import type { Job, GenerateRequest } from '../../shared/types';
import { registerRunner, type RunnerContext } from './queue';
import { assets as assetsRepo } from '../db';
import { buildQwenEdit, buildWanI2V, buildWanT2V, buildZImage } from '../comfy/workflows';
import { CAMERA_MOVE_BY_ID, IMAGE_SIZES, VIDEO_SIZES, WAN_NEGATIVE, framesForDuration } from '../../shared/presets';
import { assertPromptsAllowed } from './guard';
import { resolveSeed, saveComfyOutput, toLoraFiles, uploadAssetToComfy } from './media';
import { isEngineAvailable } from '../system';

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
        const quality = req.quality ?? 'fast';
        const size = VIDEO_SIZES[quality][req.aspect];
        const length = framesForDuration(req.durationSec ?? 5);
        const movePhrase = CAMERA_MOVE_BY_ID[req.cameraMove ?? 'static']?.phrase ?? '';
        const prompt = [req.prompt, movePhrase].filter(Boolean).join(' ');
        const images = await uploadInputs(ctx, req.inputAssetIds?.slice(0, 1));
        if (images.length !== 1) throw new Error('wan_i2v needs exactly 1 input image');
        const videoCount = Math.max(1, Math.min(2, count));
        for (let i = 0; i < videoCount; i++) {
          const seed = req.seed !== undefined ? req.seed + i : resolveSeed();
          const workflow = buildWanI2V({
            prompt,
            negativePrompt: req.negativePrompt || WAN_NEGATIVE,
            width: size.width,
            height: size.height,
            length,
            fps: 16,
            seed,
            startImage: images[0]!,
            loras,
          });
          const promptId = await ctx.comfy.queuePrompt(workflow);
          await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress((i + frac) / videoCount, `Animating ${i + 1}/${videoCount}`));
          const outputs = await ctx.comfy.getOutputs(promptId);
          for (const file of outputs) {
            const asset = await saveComfyOutput(ctx.comfy, file, {
              origin: 'generated',
              prompt,
              engine: 'wan_i2v',
              params: { ...req, seed },
              jobId: job.id,
              projectId: req.projectId,
              shotId: req.shotId,
              fps: 16,
            });
            ctx.addOutput(asset.id);
          }
          if (ctx.isCanceled()) return;
        }
        break;
      }
      case 'wan_t2v': {
        const quality = req.quality ?? 'fast';
        const size = VIDEO_SIZES[quality][req.aspect];
        const length = framesForDuration(req.durationSec ?? 5);
        const movePhrase = CAMERA_MOVE_BY_ID[req.cameraMove ?? 'static']?.phrase ?? '';
        const prompt = [req.prompt, movePhrase].filter(Boolean).join(' ');
        const videoCount = Math.max(1, Math.min(2, count));
        const t2vReady = await isEngineAvailable(ctx.comfy, 'wan_t2v');
        for (let i = 0; i < videoCount; i++) {
          const seed = req.seed !== undefined ? req.seed + i : resolveSeed();
          if (t2vReady) {
            const workflow = buildWanT2V({
              prompt,
              negativePrompt: req.negativePrompt || WAN_NEGATIVE,
              width: size.width,
              height: size.height,
              length,
              fps: 16,
              seed,
              loras,
            });
            const promptId = await ctx.comfy.queuePrompt(workflow);
            await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress((i + frac) / videoCount, `Animating ${i + 1}/${videoCount}`));
            const outputs = await ctx.comfy.getOutputs(promptId);
            for (const file of outputs) {
              const asset = await saveComfyOutput(ctx.comfy, file, {
                origin: 'generated',
                prompt,
                engine: 'wan_t2v',
                params: { ...req, seed },
                jobId: job.id,
                projectId: req.projectId,
                shotId: req.shotId,
                fps: 16,
              });
              ctx.addOutput(asset.id);
            }
          } else {
            // Fallback: Z-Image keyframe → Wan I2V. Weight the (cheap) keyframe stage at 20%.
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
            const vidSize = VIDEO_SIZES[quality][req.aspect];
            const vidWorkflow = buildWanI2V({
              prompt,
              negativePrompt: req.negativePrompt || WAN_NEGATIVE,
              width: vidSize.width,
              height: vidSize.height,
              length,
              fps: 16,
              seed,
              startImage: kfName,
              loras,
            });
            const vidPromptId = await ctx.comfy.queuePrompt(vidWorkflow);
            await ctx.comfy.waitFor(vidPromptId, vidWorkflow, (frac) => ctx.setProgress((i + 0.2 + frac * 0.8) / videoCount, `Animating ${i + 1}/${videoCount}`));
            const vidOutputs = await ctx.comfy.getOutputs(vidPromptId);
            for (const file of vidOutputs) {
              const asset = await saveComfyOutput(ctx.comfy, file, {
                origin: 'generated',
                prompt,
                engine: 'wan_t2v',
                params: { ...req, seed },
                jobId: job.id,
                projectId: req.projectId,
                shotId: req.shotId,
                fps: 16,
              });
              ctx.addOutput(asset.id);
            }
          }
          if (ctx.isCanceled()) return;
        }
        break;
      }
      default:
        throw new Error(`Unknown engine "${req.engine}"`);
    }
  });
}

registerGenerateRunner();

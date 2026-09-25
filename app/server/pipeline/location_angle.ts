// 'location_angle' job: Qwen-Image-Edit + Multiple-Angles LoRA re-render of the establishing image.
// Result is cached in location.angleViews, keyed by angleKey().
import { registerRunner } from './queue';
import { assets as assetsRepo, locations as locationsRepo } from '../db';
import { emit } from '../events';
import { buildQwenEdit } from '../comfy/workflows';
import { angleKey, anglePrompt } from '../../shared/camera';
import { resolveSeed, saveComfyOutput, uploadAssetToComfy } from './media';
import type { AngleSpec } from '../../shared/types';

registerRunner('location_angle', async (job, ctx) => {
  const params = job.params as { locationId?: string; angle?: AngleSpec };
  const locationId = String(params.locationId ?? '');
  const location = locationsRepo.get(locationId);
  if (!location) throw new Error('Location not found');
  if (!location.establishingAssetId) throw new Error('Location has no establishing image');
  if (!params.angle) throw new Error('Missing angle');
  const establishing = assetsRepo.get(location.establishingAssetId);
  if (!establishing) throw new Error('Establishing asset is missing on disk');

  const prompt = anglePrompt(params.angle);
  const imageName = await uploadAssetToComfy(ctx.comfy, establishing);
  const seed = resolveSeed();
  const workflow = buildQwenEdit({ images: [imageName], prompt, seed, angles: true });
  const promptId = await ctx.comfy.queuePrompt(workflow);
  await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Rendering angle'));
  const outputs = await ctx.comfy.getOutputs(promptId);
  const file = outputs[0];
  if (!file) throw new Error('No angle image produced');
  const asset = await saveComfyOutput(ctx.comfy, file, {
    origin: 'generated',
    prompt,
    engine: 'qwen_angle',
    params: { locationId, angle: params.angle, seed },
    jobId: job.id,
  });
  ctx.addOutput(asset.id);

  const key = angleKey(params.angle);
  const angleViews = [...location.angleViews.filter((v) => v.key !== key), { key, assetId: asset.id }];
  const updated = locationsRepo.update(locationId, { angleViews });
  if (updated) emit({ type: 'location', location: updated });
});

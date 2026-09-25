// 'location_establishing' job: Z-Image establishing shot from the location description.
import { registerRunner } from './queue';
import { locations as locationsRepo } from '../db';
import { emit } from '../events';
import { buildZImage } from '../comfy/workflows';
import { IMAGE_SIZES } from '../../shared/presets';
import { resolveSeed, saveComfyOutput } from './media';
import type { AspectRatio } from '../../shared/types';

registerRunner('location_establishing', async (job, ctx) => {
  const params = job.params as { locationId?: string; prompt?: string; aspect?: AspectRatio };
  const locationId = String(params.locationId ?? '');
  const location = locationsRepo.get(locationId);
  if (!location) throw new Error('Location not found');
  const prompt = params.prompt ?? location.description;
  const size = IMAGE_SIZES[params.aspect ?? '16:9'];
  const seed = resolveSeed();
  const workflow = buildZImage({ prompt, width: size.width, height: size.height, seed, batch: 1 });
  const promptId = await ctx.comfy.queuePrompt(workflow);
  await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Rendering establishing shot'));
  const outputs = await ctx.comfy.getOutputs(promptId);
  const file = outputs[0];
  if (!file) throw new Error('No establishing image produced');
  const asset = await saveComfyOutput(ctx.comfy, file, {
    origin: 'generated',
    prompt,
    engine: 'zimage',
    params: { locationId, seed },
    jobId: job.id,
  });
  ctx.addOutput(asset.id);
  const updated = locationsRepo.update(locationId, { establishingAssetId: asset.id });
  if (updated) emit({ type: 'location', location: updated });
});

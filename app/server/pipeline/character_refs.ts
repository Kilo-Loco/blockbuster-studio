// 'character_refs' job: Z-Image "character sheet" images generated from the description.
import { registerRunner } from './queue';
import { characters as charactersRepo } from '../db';
import { emit } from '../events';
import { buildZImage } from '../comfy/workflows';
import { IMAGE_SIZES } from '../../shared/presets';
import { resolveSeed, saveComfyOutput } from './media';
import { SHEET_BACKDROP } from './character_sheets';
import type { AspectRatio } from '../../shared/types';

registerRunner('character_refs', async (job, ctx) => {
  // attach:false (the character builder's candidate looks): the images stay in the job's outputs only, and the
  // one the user picks is attached by the build; nothing else lands in the character's references.
  const params = job.params as { characterId?: string; count?: number; prompt?: string; aspect?: AspectRatio; attach?: boolean };
  const characterId = String(params.characterId ?? '');
  const character = charactersRepo.get(characterId);
  if (!character) throw new Error('Character not found');
  const prompt = params.prompt ?? `Full body photo of ${character.description}, standing, facing the camera, ${SHEET_BACKDROP}, sharp focus, photorealistic. No text, no labels, no graphics, single person only.`;
  const count = Math.max(1, Math.min(8, params.count ?? 4));
  const size = IMAGE_SIZES[params.aspect ?? '1:1'];
  const seed = resolveSeed();
  const workflow = buildZImage({ prompt, width: size.width, height: size.height, seed, batch: count });
  const promptId = await ctx.comfy.queuePrompt(workflow);
  await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Rendering references'));
  const outputs = await ctx.comfy.getOutputs(promptId);
  const newIds: string[] = [];
  for (const file of outputs) {
    const asset = await saveComfyOutput(ctx.comfy, file, {
      origin: 'generated',
      prompt,
      engine: 'zimage',
      params: { characterId, seed },
      jobId: job.id,
    });
    ctx.addOutput(asset.id);
    newIds.push(asset.id);
  }
  if (params.attach === false) return;
  const updated = charactersRepo.update(characterId, { referenceAssetIds: [...character.referenceAssetIds, ...newIds] });
  if (updated) emit({ type: 'character', character: updated });
});

// 'character_turnaround' and 'character_face' jobs: sheet-ready Z-Image references on a plain mid-grey
// background, for the scene reference-sheet builder (see reference_sheet.ts) and the Ingredients IC-LoRA
// (docs/research/2026-09-ltx-best-practices.md). Alongside character_refs (kept for the compose/generate
// keyframe pipeline), these give every character/prop a turnaround and (for people) a face close-up that the
// scene sheet composites into one image.
import { registerRunner } from './queue';
import { characters as charactersRepo } from '../db';
import { emit } from '../events';
import { buildZImage } from '../comfy/workflows';
import { IMAGE_SIZES } from '../../shared/presets';
import { resolveSeed, saveComfyOutput } from './media';

/** Plain flat light-grey seamless studio backdrop every sheet-ready reference is shot against (character_refs,
 *  character_turnaround, character_face): light neutral grey, near off-white but still clearly grey, gives the
 *  most consistent identity in testing (Higgsfield team report) — near-white or mid-grey backdrops were less
 *  consistent. The scene reference sheet's own outer canvas stays black (composeReferenceSheetImage /
 *  reference_sheet.ts): only each panel's own backdrop is this light grey. */
export const SHEET_BACKDROP = 'plain flat light-grey seamless background (#C8C8C8), soft even light';
const SHEET_BACKGROUND = `${SHEET_BACKDROP}, no text, no watermark, no logo`;

// In testing, a car's Z-Image turnaround sometimes repeated one view four times instead of rotating it;
// Qwen-Image-Edit's multi-angle LoRA (already used by qwen_angle, see prompts.ts/workflows.ts buildQwenEdit
// angles) driven from one clean side view fixed it reliably for vehicles. Left as an optional follow-up
// (a `prop` turnaround could fall back to 4x qwen_angle + composite instead of one Z-Image batch) — not built
// here; character_turnaround always uses Z-Image for both kinds.
export function turnaroundPrompt(kind: 'person' | 'prop', description: string): string {
  return kind === 'prop'
    ? `product reference sheet, four views of the same object side by side: side profile, front three-quarter, rear three-quarter, top; identical in every view; ${description}; ${SHEET_BACKGROUND}`
    : `character turnaround sheet, four views of the same character side by side, full body head to toe: front, left profile, back, three-quarter front; identical in every view; ${description}; ${SHEET_BACKGROUND}`;
}

export function facePrompt(description: string): string {
  return `character reference, head-and-shoulders close-up portrait of the same character; ${description}; ${SHEET_BACKGROUND}`;
}

registerRunner('character_turnaround', async (job, ctx) => {
  const params = job.params as { characterId?: string };
  const characterId = String(params.characterId ?? '');
  const character = charactersRepo.get(characterId);
  if (!character) throw new Error('Character not found');
  const kind = character.kind ?? 'person';
  const prompt = turnaroundPrompt(kind, character.description);
  const size = IMAGE_SIZES['16:9'];
  const seed = resolveSeed();
  const workflow = buildZImage({ prompt, width: size.width, height: size.height, seed, batch: 1 });
  const promptId = await ctx.comfy.queuePrompt(workflow);
  await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Rendering turnaround sheet'));
  const [file] = await ctx.comfy.getOutputs(promptId);
  if (!file) throw new Error('No turnaround image produced');
  const asset = await saveComfyOutput(ctx.comfy, file, { origin: 'generated', prompt, engine: 'zimage', params: { characterId, seed }, jobId: job.id });
  ctx.addOutput(asset.id);
  const updated = charactersRepo.update(characterId, {
    referenceAssetIds: [...character.referenceAssetIds, asset.id],
    sheetAssets: { ...character.sheetAssets, turnaround: asset.id },
  });
  if (updated) emit({ type: 'character', character: updated });
});

registerRunner('character_face', async (job, ctx) => {
  const params = job.params as { characterId?: string };
  const characterId = String(params.characterId ?? '');
  const character = charactersRepo.get(characterId);
  if (!character) throw new Error('Character not found');
  if ((character.kind ?? 'person') === 'prop') throw new Error('Props have no face close-up; use character_turnaround');
  const prompt = facePrompt(character.description);
  const size = IMAGE_SIZES['1:1'];
  const seed = resolveSeed();
  const workflow = buildZImage({ prompt, width: size.width, height: size.height, seed, batch: 1 });
  const promptId = await ctx.comfy.queuePrompt(workflow);
  await ctx.comfy.waitFor(promptId, workflow, (frac) => ctx.setProgress(frac, 'Rendering face reference'));
  const [file] = await ctx.comfy.getOutputs(promptId);
  if (!file) throw new Error('No face image produced');
  const asset = await saveComfyOutput(ctx.comfy, file, { origin: 'generated', prompt, engine: 'zimage', params: { characterId, seed }, jobId: job.id });
  ctx.addOutput(asset.id);
  const updated = charactersRepo.update(characterId, {
    referenceAssetIds: [...character.referenceAssetIds, asset.id],
    sheetAssets: { ...character.sheetAssets, face: asset.id },
  });
  if (updated) emit({ type: 'character', character: updated });
});

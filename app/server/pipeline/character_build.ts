// 'character_build' job: the character builder. From one chosen "look" image of a character (a generated
// candidate, an upload, any gallery image), one queue job makes everything the studio needs to keep that
// character the same in every shot:
//
//   1. the sheet-ready turnaround and (people) face close-up of that exact look, for scene reference sheets;
//   2. a varied, identity-preserving training set: other camera angles (Qwen-Image-Edit multi-angle LoRA) and
//      the same character in other expressions, lighting and settings (plain Qwen-Image-Edit), so the LoRA
//      learns the character and not the grey backdrop;
//   3. (unless train:false) a Z-Image character LoRA trained on look + training set + face, attached to the
//      character with its trigger word (loras/train.ts).
//
// Higgsfield's Soul ID asks for 20+ photos and trains in minutes; here one description (or one photo) is enough,
// because the edit model fabricates the photo set. Without the edit models (DOWNLOAD_EDIT_MODELS=false) the
// build falls back to Z-Image from the description alone: still a full set, but identity then rests on the
// description and the LoRA rather than on the chosen look.
import { registerRunner, type RunnerContext } from './queue';
import { assets as assetsRepo, characters as charactersRepo } from '../db';
import { emit } from '../events';
import { buildQwenEdit, buildZImage } from '../comfy/workflows';
import { IMAGE_SIZES } from '../../shared/presets';
import { anglePrompt } from '../../shared/camera';
import { isEngineAvailable } from '../system';
import { trainLora } from '../loras/train';
import { assetDiskPath, fitImageToFrame, resolveSeed, saveComfyOutput } from './media';
import { SHEET_BACKDROP, facePrompt, turnaroundPrompt } from './character_sheets';
import type { AngleSpec, Asset, Character, CharacterBuildRequest, ID } from '../../shared/types';

export const DEFAULT_VARIATIONS = 12;
export const MAX_VARIATIONS = 24;
export const DEFAULT_STEPS = 1500;

/** Share of the job's progress bar the images take when a LoRA is trained afterwards (training is the long part). */
const IMAGES_SHARE_WITH_TRAINING = 0.25;

export type BuildSlot = 'turnaround' | 'face' | 'variation';

export interface BuildStep {
  slot: BuildSlot;
  /** 'edit': Qwen-Image-Edit from the look. 'angle': the same with the multi-angle LoRA. 'zimage': text only (fallback). */
  engine: 'edit' | 'angle' | 'zimage';
  prompt: string;
  width: number;
  height: number;
  /** Shown in the job's stage text. */
  label: string;
}

const SAME_PERSON = 'The same person as in image 1: exactly the same face, hair, skin, build and outfit';
const SAME_OBJECT = 'The same object as in image 1: exactly the same shape, colours, materials and details';

/** Settings that move the character out of the grey studio. Varied light and places, so the LoRA learns the
 *  character, not the backdrop; every one is photographic and keeps the outfit (the look is the costume). */
const PERSON_SCENES = [
  'head-and-shoulders portrait, smiling warmly, soft window light indoors, photorealistic',
  'three-quarter view, serious expression, dramatic side lighting, dark background, photorealistic',
  'medium shot walking down a city street at dusk, candid, photorealistic',
  'sitting at a café table, laughing, daylight, shallow depth of field, photorealistic',
  'close-up, neutral expression, looking slightly off camera, golden-hour light outdoors, photorealistic',
  'full body standing in a doorway, overcast daylight, photorealistic',
  'profile view, thoughtful, cool blue night lighting, photorealistic',
  'medium shot in light rain looking at the camera, street lights behind, photorealistic',
  'leaning on a railing by the water, wind in the hair, late afternoon, photorealistic',
  'close-up lit by a screen in a dark room, concentrating, photorealistic',
  'mid-stride across a sunlit plaza, wide shot, photorealistic',
  'seated in a car, looking out of the side window, soft daylight, photorealistic',
];

const PROP_SCENES = [
  'on a wooden workbench under warm lamp light, photorealistic product photo',
  'outdoors on wet asphalt at dusk, reflections, photorealistic',
  'on a white studio sweep, soft even light, photorealistic product photo',
  'in a sunlit field, golden hour, shallow depth of field, photorealistic',
  'in a dim garage lit by one overhead bulb, photorealistic',
  'on a city street at night under neon signs, photorealistic',
  'in light rain, droplets on the surface, overcast, photorealistic',
  'on a rooftop at noon, hard shadows, photorealistic',
  'in a forest clearing, dappled light, photorealistic',
  'in a bright showroom, polished floor, photorealistic',
  'on sand at the beach, late afternoon, photorealistic',
  'in snow at dawn, cold blue light, photorealistic',
];

/** Other camera angles of the look (the multi-angle LoRA keeps the subject and backdrop, moves the camera). */
const ANGLES: AngleSpec[] = [
  { azimuth: 'front-left quarter view', elevation: 'eye-level shot', distance: 'medium shot' },
  { azimuth: 'left side view', elevation: 'eye-level shot', distance: 'close-up' },
  { azimuth: 'front-right quarter view', elevation: 'low-angle shot', distance: 'medium shot' },
  { azimuth: 'right side view', elevation: 'eye-level shot', distance: 'medium shot' },
  { azimuth: 'back-left quarter view', elevation: 'eye-level shot', distance: 'medium shot' },
  { azimuth: 'front view', elevation: 'elevated shot', distance: 'close-up' },
  { azimuth: 'back view', elevation: 'eye-level shot', distance: 'medium shot' },
  { azimuth: 'front-right quarter view', elevation: 'eye-level shot', distance: 'close-up' },
];

export function readBuildParams(raw: Record<string, unknown>): CharacterBuildRequest & { characterId: string } {
  const characterId = typeof raw.characterId === 'string' ? raw.characterId : '';
  const lookAssetId = typeof raw.lookAssetId === 'string' ? raw.lookAssetId : '';
  if (!characterId) throw new Error('character_build job is missing params.characterId');
  if (!lookAssetId) throw new Error('character_build job is missing params.lookAssetId');
  const variations = typeof raw.variations === 'number' ? Math.max(0, Math.min(MAX_VARIATIONS, Math.round(raw.variations))) : DEFAULT_VARIATIONS;
  return {
    characterId,
    lookAssetId,
    train: raw.train !== false,
    triggerWord: typeof raw.triggerWord === 'string' && raw.triggerWord.trim() ? raw.triggerWord.trim() : undefined,
    steps: typeof raw.steps === 'number' && raw.steps > 0 ? Math.round(raw.steps) : undefined,
    variations,
  };
}

export function defaultTriggerWord(character: Pick<Character, 'name' | 'triggerWord'>): string {
  return character.triggerWord?.trim() || `ohwx_${character.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'character'}`;
}

/** Every image the build renders, in order. About a third of the variations are other angles of the look (same
 *  grey backdrop, identity held by the angle LoRA) and the rest put the character in other settings. */
export function planBuild(character: Pick<Character, 'kind' | 'description'>, variations: number, canEdit: boolean): BuildStep[] {
  const kind = character.kind ?? 'person';
  const wide = IMAGE_SIZES['16:9'];
  const square = IMAGE_SIZES['1:1'];
  const steps: BuildStep[] = [];
  const same = kind === 'prop' ? SAME_OBJECT : SAME_PERSON;

  steps.push(
    canEdit
      ? {
          slot: 'turnaround',
          engine: 'edit',
          prompt:
            kind === 'prop'
              ? `${SAME_OBJECT}. Product reference sheet of it: four views side by side, side profile, front three-quarter, rear three-quarter, top; identical in every view; ${SHEET_BACKDROP}, no text, no watermark, no logo.`
              : `${SAME_PERSON}. Character turnaround sheet of them: four views side by side, full body head to toe, front, left profile, back, three-quarter front; identical in every view, neutral standing pose; ${SHEET_BACKDROP}, no text, no watermark, no logo.`,
          width: wide.width,
          height: wide.height,
          label: 'Turnaround sheet',
        }
      : { slot: 'turnaround', engine: 'zimage', prompt: turnaroundPrompt(kind, character.description), width: wide.width, height: wide.height, label: 'Turnaround sheet' },
  );

  if (kind === 'person') {
    steps.push(
      canEdit
        ? {
            slot: 'face',
            engine: 'edit',
            prompt: `${SAME_PERSON}. Head-and-shoulders close-up portrait, facing the camera, neutral expression, sharp focus on the eyes; ${SHEET_BACKDROP}, no text, no watermark, no logo.`,
            width: square.width,
            height: square.height,
            label: 'Face close-up',
          }
        : { slot: 'face', engine: 'zimage', prompt: facePrompt(character.description), width: square.width, height: square.height, label: 'Face close-up' },
    );
  }

  const angleCount = canEdit ? Math.min(ANGLES.length, Math.round(variations / 3)) : 0;
  const scenes = kind === 'prop' ? PROP_SCENES : PERSON_SCENES;
  for (let i = 0; i < variations; i++) {
    if (i < angleCount) {
      steps.push({ slot: 'variation', engine: 'angle', prompt: anglePrompt(ANGLES[i]!), width: square.width, height: square.height, label: `Training set ${i + 1}/${variations}` });
      continue;
    }
    const scene = scenes[(i - angleCount) % scenes.length]!;
    steps.push(
      canEdit
        ? { slot: 'variation', engine: 'edit', prompt: `${same}. ${scene}.`, width: square.width, height: square.height, label: `Training set ${i + 1}/${variations}` }
        : {
            slot: 'variation',
            engine: 'zimage',
            prompt: `Photo of ${character.description}; ${scene}. No text, no labels, single subject only.`,
            width: square.width,
            height: square.height,
            label: `Training set ${i + 1}/${variations}`,
          },
    );
  }
  return steps;
}

/** The look fitted (padded on grey) to a step's frame and uploaded, once per frame size. */
class LookUploads {
  private names = new Map<string, Promise<string>>();
  constructor(
    private comfy: RunnerContext['comfy'],
    private look: Asset,
  ) {}
  get(width: number, height: number): Promise<string> {
    const key = `${width}x${height}`;
    let p = this.names.get(key);
    if (!p) {
      p = fitImageToFrame(assetDiskPath(this.look), width, height, 'pad').then((buf) => this.comfy.uploadImage(buf, `${this.look.id}_look_${key}.png`));
      this.names.set(key, p);
    }
    return p;
  }
}

registerRunner('character_build', async (job, ctx) => {
  const params = readBuildParams(job.params as Record<string, unknown>);
  const character = charactersRepo.get(params.characterId);
  if (!character) throw new Error('Character not found');
  const look = assetsRepo.get(params.lookAssetId);
  if (!look || look.kind !== 'image') throw new Error('The look image was not found');

  const canEdit = await isEngineAvailable(ctx.comfy, 'qwen_edit');
  const steps = planBuild(character, params.variations ?? DEFAULT_VARIATIONS, canEdit);
  const imagesShare = params.train ? IMAGES_SHARE_WITH_TRAINING : 1;
  const uploads = new LookUploads(ctx.comfy, look);

  const made: { slot: BuildSlot; assetId: ID }[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (ctx.isCanceled()) throw new Error('canceled');
    const step = steps[i]!;
    const seed = resolveSeed();
    const stage = `${step.label} (${i + 1}/${steps.length})`;
    const progress = (frac: number) => ctx.setProgress(((i + frac) / steps.length) * imagesShare, stage);
    progress(0);
    const workflow =
      step.engine === 'zimage'
        ? buildZImage({ prompt: step.prompt, width: step.width, height: step.height, seed, batch: 1 })
        : buildQwenEdit({ images: [await uploads.get(step.width, step.height)], prompt: step.prompt, seed, angles: step.engine === 'angle' });
    const promptId = await ctx.comfy.queuePrompt(workflow);
    await ctx.comfy.waitFor(promptId, workflow, progress);
    const [file] = await ctx.comfy.getOutputs(promptId);
    if (!file) throw new Error(`No image produced for: ${step.label}`);
    const asset = await saveComfyOutput(ctx.comfy, file, {
      origin: 'generated',
      prompt: step.prompt,
      engine: step.engine === 'zimage' ? 'zimage' : step.engine === 'angle' ? 'qwen_angle' : 'qwen_edit',
      params: { characterId: character.id, buildSlot: step.slot, lookAssetId: look.id, seed },
      jobId: job.id,
    });
    ctx.addOutput(asset.id);
    made.push({ slot: step.slot, assetId: asset.id });
  }

  // The look leads the references (it is the primary image), then the training set; the sheets go in their slots.
  const variationIds = made.filter((m) => m.slot === 'variation').map((m) => m.assetId);
  const faceId = made.find((m) => m.slot === 'face')?.assetId;
  const turnaroundId = made.find((m) => m.slot === 'turnaround')?.assetId;
  const latest = charactersRepo.get(character.id) ?? character;
  const references = [look.id, ...latest.referenceAssetIds.filter((id) => id !== look.id), ...variationIds.filter((id) => !latest.referenceAssetIds.includes(id))];
  const triggerWord = defaultTriggerWord(latest);
  const afterImages = charactersRepo.update(character.id, {
    referenceAssetIds: references,
    sheetAssets: { ...latest.sheetAssets, ...(turnaroundId ? { turnaround: turnaroundId } : {}), ...(faceId ? { face: faceId } : {}) },
    triggerWord,
  });
  if (afterImages) emit({ type: 'character', character: afterImages });

  if (!params.train) return;
  if (ctx.isCanceled()) throw new Error('canceled');

  // Training: the look, the whole training set and the face close-up (not the four-figure turnaround).
  const trainCtx: RunnerContext = {
    ...ctx,
    setProgress: (frac, stage) => ctx.setProgress(imagesShare + frac * (1 - imagesShare), stage),
  };
  await trainLora(
    {
      name: latest.name,
      kind: 'character',
      triggerWord,
      description: latest.description,
      assetIds: [look.id, ...variationIds, ...(faceId ? [faceId] : [])],
      steps: params.steps ?? DEFAULT_STEPS,
      characterId: character.id,
    },
    job.id,
    trainCtx,
  );
});

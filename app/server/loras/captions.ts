// Per-image training captions (issue #42). One caption shared by every image makes the LoRA learn what the images
// have in common (backdrop, light, pose habits) as part of the trigger word, and leaves the description rather than
// the trigger to carry the identity. Each image instead gets `<trigger>, <what is different about this image>`,
// taken from the prompt that made it, so the trigger word picks up only the identity.
import { SHEET_BACKDROP } from '../pipeline/character_sheets';
import type { Asset, LoraTrainRequest } from '../../shared/types';

/** The character builder's identity preamble for its Qwen-Image-Edit steps (character_build.ts). Kept here so the
 *  captioner strips exactly what the builder writes. */
export const SAME_PERSON = 'The same person as in image 1: exactly the same face, hair, skin, build and outfit';
export const SAME_OBJECT = 'The same object as in image 1: exactly the same shape, colours, materials and details';

/** Phrases that say nothing about the image itself: identity boilerplate, the multi-angle LoRA's token, the sheet
 *  backdrop and the usual "no text" negatives. */
const BOILERPLATE: (string | RegExp)[] = [
  SAME_PERSON,
  SAME_OBJECT,
  '<sks>',
  SHEET_BACKDROP,
  /\bno text, no watermark, no logo\b/gi,
  /\bno text, no labels, no graphics, single person only\b/gi,
  /\bno text, no labels, single subject only\b/gi,
];

/** The part of a generation prompt that describes this image (scene, angle, framing, expression), without the
 *  character's description or boilerplate. Empty when nothing image-specific is left. */
export function sceneFromPrompt(prompt: string, description?: string): string {
  let text = prompt;
  if (description?.trim()) text = text.split(description.trim()).join(' ');
  for (const phrase of BOILERPLATE) text = typeof phrase === 'string' ? text.split(phrase).join(' ') : text.replace(phrase, ' ');
  return text
    .replace(/\b(photo|picture|image) of\s*(?=[,;.]|$)/gi, ' ') // "Full body photo of , standing" once the description is gone
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;.])/g, '$1')
    .replace(/([,;.])(\s*[,;.])+/g, '$1')
    .replace(/^[\s,;.:]+|[\s,;:]+$/g, '')
    .trim();
}

/** The caption one training image gets: an explicit caption from the request wins (used as written, so a
 *  multi-character LoRA can name several trigger words); otherwise the trigger word plus what is specific to the
 *  image; otherwise, with no prompt to go on (uploads), the trigger word plus the description as before. */
export function captionFor(params: Pick<LoraTrainRequest, 'triggerWord' | 'description' | 'captions'>, asset: Pick<Asset, 'id' | 'prompt'>): string {
  const explicit = params.captions?.[asset.id]?.trim();
  if (explicit) return explicit;
  const scene = asset.prompt ? sceneFromPrompt(asset.prompt, params.description) : '';
  const rest = scene || params.description?.trim() || '';
  return rest ? `${params.triggerWord}, ${rest}` : params.triggerWord;
}

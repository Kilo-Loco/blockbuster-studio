// Rewrites a studio prompt into MiniMax H3's official prompt structure
// (huggingface.co/MiniMaxAI/MiniMax-H3 docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md):
//
//   For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.   ← image-to-video only
//   integrated_multimodal_description: [Shot 1] …visuals, action, camera (type + amplitude + speed), dialogue…
//   overall_soundscape: …ambience and sound effects…
//   non_diegetic_music: …score, or "No music."…
//
// H3 runs guidance-free here (turbo LoRA, CFG 1), so anything left unsaid — music especially — is
// up to the model; we always fill both audio fields. Prompts already written in this format pass
// through untouched (apart from the image-alignment line).
import { CAMERA_MOVES } from '../../shared/presets';
import type { CameraMoveId } from '../../shared/types';
import { extractAudioSections } from './audio_sections';

export const H3_FIRST_FRAME_LINE = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';

/** Camera presets in H3's vocabulary: motion type + amplitude + speed. */
export const H3_CAMERA: Record<CameraMoveId, string> = {
  static: 'The camera stays completely still in a locked-off static shot.',
  push_in: 'The camera pushes in with small amplitude at slow speed toward the subject.',
  pull_out: 'The camera pulls out with small amplitude at slow speed, revealing more of the surroundings.',
  pan_left: 'The camera pans left with small amplitude at slow speed.',
  pan_right: 'The camera pans right with small amplitude at slow speed.',
  tilt_up: 'The camera tilts up with small amplitude at slow speed.',
  tilt_down: 'The camera tilts down with small amplitude at slow speed.',
  orbit_left: 'The camera makes an arc shot to the left around the subject with large amplitude at slow speed.',
  orbit_right: 'The camera makes an arc shot to the right around the subject with large amplitude at slow speed.',
  crane_up: 'The camera cranes up with large amplitude at slow speed, rising above the scene.',
  crane_down: 'The camera cranes down with large amplitude at slow speed, descending toward the subject.',
  tracking: 'Tracking shot: the camera follows the subject with small amplitude at slow speed.',
  handheld: 'Handheld camera with subtle natural shake, documentary style.',
  crash_zoom: 'The camera zooms in with large amplitude at fast speed on the subject.',
  dolly_zoom: 'Dolly zoom: the camera pulls back while zooming in with large amplitude at slow speed, so the background stretches while the subject stays the same size.',
  fpv_drone: 'Tracking shot from a fast FPV drone swooping through the scene with large amplitude at fast speed.',
  whip_pan: 'The camera whip-pans with large amplitude at fast speed, with motion blur.',
};

const DEFAULT_SOUNDSCAPE = 'Natural, realistic sound that matches the scene: its ambience and the sounds of the action.';
const DEFAULT_MUSIC = 'No music.';
const SPEECH_VERBS = 'says|said|asks|asked|shouts|yells|whispers|replies|calls out|mutters|exclaims|answers';

export function formatH3Prompt(prompt: string, opts: { firstFrame: boolean }): string {
  let text = prompt.trim();
  const alignment = opts.firstFrame && !/is fully referenced/i.test(text) ? `${H3_FIRST_FRAME_LINE}\n` : '';
  if (/integrated_multimodal_description\s*:/i.test(text)) return alignment + text;

  // Studio camera-preset sentences → H3 camera phrasing.
  for (const move of CAMERA_MOVES) text = text.split(move.phrase).join(H3_CAMERA[move.id]);

  const { description: rest, soundscape, music } = extractAudioSections(text);

  // Quoted speech after a speech verb → H3 dialogue tags.
  const speech = new RegExp(`\\b(${SPEECH_VERBS})(\\s*:)?\\s*["“]([^"”]+)["”]`, 'gi');
  const description = rest.replace(speech, (_m, verb: string, _colon: string, line: string) => `${verb}: <d>[English] ${line.trim()}</d>`);
  return (
    `${alignment}integrated_multimodal_description: [Shot 1] ${description}\n` +
    `overall_soundscape: ${soundscape || DEFAULT_SOUNDSCAPE}\n` +
    `non_diegetic_music: ${music || DEFAULT_MUSIC}`
  );
}

// ───────────────────────────── Ref2VA (reference-to-video) ─────────────────────────────
// H3's reference checkpoint wants six ordered fields (docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md):
//   subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music
// with <Subject N>, <Picture N>, <Video N> labels. A prompt already in that form passes through; otherwise the
// caller's plain description is wrapped: every reference image becomes a fully_preserved subject and the reference
// video a partially_preserved guide for camera, framing, positions and timing with its own look explicitly replaced
// (right for any motion or blocking reference: previs, a phone recording of the action, an animatic).
// (Measured 2026-09-28 on a Blender playblast: as weak_reference the camera and framing did not carry; as
// partially_preserved with the gray look named as replaced they did, docs/research/2026-09-quarter-mile-showcase.md.)
// The description opens with "one continuous shot; references never appear as stills": with several reference
// pictures the model otherwise tends to open on a plate as a wide and cut to a sheet as a close-up before the
// action (three of five takes, docs/research/2026-09-first-step-showcase.md).
export interface H3RefWrap {
  /** One short label per reference image, in order: "Rex, the driver of the black car", "the black muscle car". */
  imageLabels: string[];
  /** One label per reference video: "the previs cut of this shot". */
  videoLabels?: string[];
}

/** Reference stills must never appear as their own shots. A single-shot description also says there are no
 *  cuts; a multi-shot one ("[Shot 2] At 00:03.000, the camera cuts to …") says the listed cuts are the only ones. */
function continuityLine(description: string): string {
  const multiShot = /\[Shot 2\]/i.test(description);
  return multiShot
    ? 'The reference pictures define appearance only and never appear as inserted stills; the only cuts are the ones listed, at their times. '
    : 'One single continuous shot with no cuts; the reference pictures define appearance only and never appear as inserted stills. ';
}

export function formatH3RefPrompt(prompt: string, refs: H3RefWrap): string {
  const text = prompt.trim();
  if (/subject_definitions\s*:/i.test(text)) return text;
  const { description, soundscape, music } = extractAudioSections(text);
  const subjects = refs.imageLabels.map((l, i) => `<Subject ${i + 1}> is ${l}, whose appearance comes from <Picture ${i + 1}>.`);
  const videos = (refs.videoLabels ?? []).map((l, i) => `<Video ${i + 1}> is ${l}; it provides only the camera movement, framing, the subjects' positions and the timing.`);
  const retention = [
    ...refs.imageLabels.map((_l, i) => `<Subject ${i + 1}> (appears in [Shot 1]): fully_preserved - identity, colours and wardrobe or bodywork kept exactly as in <Picture ${i + 1}>.`),
    ...(refs.videoLabels ?? []).map((_l, i) => `<Video ${i + 1}> (camera, framing, positions and timing): partially_preserved - the camera position and path, the framing, the subjects' relative positions and the timing are kept; its own subjects, colours, materials and setting are replaced by the reference images and the description.`),
  ];
  const summary = `The target video is a new live-action shot featuring ${refs.imageLabels.map((_l, i) => `<Subject ${i + 1}>`).join(', ')}${refs.videoLabels?.length ? `, following the camera and timing of ${refs.videoLabels.map((_l, i) => `<Video ${i + 1}>`).join(' and ')}` : ''}.`;
  return [
    `subject_definitions:\n${[...subjects, ...videos].join('\n')}`,
    `summary: ${summary}`,
    `retention_analysis:\n${retention.join('\n')}`,
    `detailed_description: ${continuityLine(description)}${/^\s*\[Shot 1\]/i.test(description) ? '' : '[Shot 1] '}${description}`,
    `overall_soundscape: ${soundscape || DEFAULT_SOUNDSCAPE}`,
    `non_diegetic_music: ${music || DEFAULT_MUSIC}`,
  ].join('\n');
}

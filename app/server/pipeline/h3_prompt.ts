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

  // Pull "Audio: …" / "Sound: …" and "Music: …" sections out of the description.
  let soundscape = '';
  let music = '';
  text = text.replace(/\b(?:audio|sound|sounds|soundscape)\s*:\s*([\s\S]*?)(?=\bmusic\s*:|$)/i, (_m, s: string) => {
    soundscape = s.trim();
    return ' ';
  });
  text = text.replace(/\bmusic\s*:\s*([\s\S]*?)(?=\b(?:audio|sound|sounds|soundscape)\s*:|$)/i, (_m, s: string) => {
    music = s.trim();
    return ' ';
  });

  // Quoted speech after a speech verb → H3 dialogue tags.
  const speech = new RegExp(`\\b(${SPEECH_VERBS})(\\s*:)?\\s*["“]([^"”]+)["”]`, 'gi');
  text = text.replace(speech, (_m, verb: string, _colon: string, line: string) => `${verb}: <d>[English] ${line.trim()}</d>`);

  const description = text.replace(/\s+/g, ' ').trim();
  return (
    `${alignment}integrated_multimodal_description: [Shot 1] ${description}\n` +
    `overall_soundscape: ${soundscape || DEFAULT_SOUNDSCAPE}\n` +
    `non_diegetic_music: ${music || DEFAULT_MUSIC}`
  );
}

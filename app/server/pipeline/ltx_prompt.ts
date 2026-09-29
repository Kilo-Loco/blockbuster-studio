// Rewrites a studio prompt into the shape LTX-2.5's official ComfyUI templates use
// (Comfy-Org workflow_templates video_ltx2_5_*.json): one flowing paragraph of action and camera, spoken
// lines kept in quotes after the speaker ("Hank says: “Rough night, huh?”"), sound described in prose.
//
//   Use the provided start image as the first frame.   ← image-to-video (plus the end-image anchor for first/last frame)
//   <description, with the studio's camera sentence as-is>
//   Sound: <ambience and effects> Music: <score>     ← "No music." when the prompt names none
//
// The studio's camera presets are already plain English, which LTX follows, so they pass through.
import { extractAudioSections } from './audio_sections';

export const LTX_FIRST_FRAME_LINE = 'Use the provided start image as the first frame.';

/** `lastFrame` no longer changes the wording: official LTX first/last-frame prompts never mention the end
 *  image (2026-09 LTX best-practices research), so first/last-frame clips get the same plain first-frame line
 *  as image-to-video. The parameter is kept so callers (buildLtx25's FLF branch) don't need to change. Pass
 *  `firstFrame: false` for a reference-sheet prompt (the Ingredients model card's two-part prompt already
 *  states what the sheet is; this line would be redundant and refers to an image that isn't a video's first
 *  frame). */
export function formatLtxPrompt(prompt: string, opts: { firstFrame: boolean; lastFrame?: boolean }): string {
  const { description, soundscape, music } = extractAudioSections(prompt.trim());
  const alignment = opts.firstFrame && !/use the provided (start|end) image/i.test(description) ? `${LTX_FIRST_FRAME_LINE} ` : '';
  const sound = soundscape ? ` Sound: ${soundscape}` : '';
  return `${alignment}${description}${sound} ${music ? `Music: ${music}` : 'No music.'}`;
}

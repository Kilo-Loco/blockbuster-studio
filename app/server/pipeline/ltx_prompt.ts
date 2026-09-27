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
export const LTX_FIRST_LAST_FRAME_LINE =
  'Use the provided start image as the first frame and the provided end image as the final frame anchor.';

export function formatLtxPrompt(prompt: string, opts: { firstFrame: boolean; lastFrame?: boolean }): string {
  const { description, soundscape, music } = extractAudioSections(prompt.trim());
  const alignment = /use the provided (start|end) image/i.test(description)
    ? ''
    : opts.firstFrame && opts.lastFrame
      ? `${LTX_FIRST_LAST_FRAME_LINE} `
      : opts.firstFrame
        ? `${LTX_FIRST_FRAME_LINE} `
        : '';
  const sound = soundscape ? ` Sound: ${soundscape}` : '';
  return `${alignment}${description}${sound} ${music ? `Music: ${music}` : 'No music.'}`;
}

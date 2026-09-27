// "Audio: …" / "Sound: …" and "Music: …" sections of a studio prompt, pulled out so each sound-capable
// video model (MiniMax H3, LTX-2.5) can place them where its prompt format wants them.

export interface AudioSections {
  /** The prompt without its audio sections, whitespace collapsed. */
  description: string;
  soundscape: string;
  music: string;
}

export function extractAudioSections(prompt: string): AudioSections {
  let soundscape = '';
  let music = '';
  let text = prompt.replace(/\b(?:audio|sound|sounds|soundscape)\s*:\s*([\s\S]*?)(?=\bmusic\s*:|$)/i, (_m, s: string) => {
    soundscape = s.trim();
    return ' ';
  });
  text = text.replace(/\bmusic\s*:\s*([\s\S]*?)(?=\b(?:audio|sound|sounds|soundscape)\s*:|$)/i, (_m, s: string) => {
    music = s.trim();
    return ' ';
  });
  return { description: text.replace(/\s+/g, ' ').trim(), soundscape, music };
}

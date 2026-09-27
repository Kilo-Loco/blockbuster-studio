// Who says a shot's line, and whether its rendered audio still matches the line and the speaker's voice.
// Shared by the server (dialogue_line jobs, export) and the web (ShotPanel's speaker picker and badges).
import type { Character, CharacterVoice, ID, Shot } from './types';

/** A line starts this far into its shot in the export, so it doesn't clip the cut. */
export const LINE_START_SEC = 0.25;

/** The shot's speaker: the chosen one, else the only character in the shot. Undefined when it's ambiguous
 *  (several characters, none chosen) or nobody is in the shot. */
export function resolveSpeaker(shot: Pick<Shot, 'dialogueSpeakerId' | 'characterIds'>, cast: Character[]): Character | undefined {
  const byId = new Map(cast.map((c) => [c.id, c]));
  if (shot.dialogueSpeakerId) return byId.get(shot.dialogueSpeakerId);
  return shot.characterIds.length === 1 ? byId.get(shot.characterIds[0]) : undefined;
}

/** A shot needs a speaker picked when it has a line and several characters but none chosen. */
export function needsSpeakerChoice(shot: Pick<Shot, 'dialogue' | 'dialogueSpeakerId' | 'characterIds'>): boolean {
  return Boolean(shot.dialogue?.trim()) && !shot.dialogueSpeakerId && shot.characterIds.length > 1;
}

/** FNV-1a (32-bit): small, dependency-free, same result in Node and the browser. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** What a rendered line was made from: the text, the speaker and their voice. Changing any of them makes
 *  the audio stale. */
export function dialogueKey(text: string, speakerId: ID, voice: CharacterVoice): string {
  return fnv1a([text.trim(), speakerId, voice.refAssetId, voice.updatedAt, voice.language].join('\u0000'));
}

export type LineState = 'none' | 'no_speaker' | 'no_voice' | 'missing' | 'stale' | 'ready';

/** Where a shot's line stands, for badges and for deciding what to (re)render. */
export function lineState(shot: Pick<Shot, 'dialogue' | 'dialogueSpeakerId' | 'characterIds' | 'dialogueAudioAssetId' | 'dialogueAudioKey'>, cast: Character[]): LineState {
  const text = shot.dialogue?.trim();
  if (!text) return 'none';
  const speaker = resolveSpeaker(shot, cast);
  if (!speaker) return 'no_speaker';
  if (!speaker.voice) return 'no_voice';
  if (!shot.dialogueAudioAssetId) return 'missing';
  return shot.dialogueAudioKey === dialogueKey(text, speaker.id, speaker.voice) ? 'ready' : 'stale';
}

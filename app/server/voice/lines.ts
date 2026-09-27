// Character voices and dialogue lines: queueing the voice jobs and turning sidecar WAVs into audio assets.
import fs from 'node:fs/promises';
import { characters as charactersRepo, jobs as jobsRepo, projects as projectsRepo, shots as shotsRepo } from '../db';
import { enqueue } from '../pipeline/queue';
import { saveAsset } from '../pipeline/media';
import { lineState, resolveSpeaker } from '../../shared/dialogue';
import type { Asset, Character, ID, Job, Shot } from '../../shared/types';
import type { TtsAudio } from '../tts/client';

/** What a designed voice says in its reference clip: ~8 s, conversational, with a question for intonation.
 *  Every later line is cloned from this clip, so it should sound like ordinary speech, not a performance. */
export const REFERENCE_LINE =
  "Well, I didn't expect to see you here tonight. It's been a long time, hasn't it? Come on in, we have a lot to talk about.";

/** Default language for new voices; Qwen3-TTS also detects it ("Auto"). */
export const DEFAULT_VOICE_LANGUAGE = 'English';

/** Save a WAV the sidecar wrote as an audio asset, then remove the sidecar's copy. */
export async function saveTtsAudio(audio: TtsAudio, opts: { prompt?: string; params?: Record<string, unknown>; jobId?: ID; projectId?: ID; shotId?: ID }): Promise<Asset> {
  const bytes = await fs.readFile(audio.file);
  const asset = await saveAsset({ kind: 'audio', origin: 'generated', ext: 'wav', bytes, ...opts });
  await fs.unlink(audio.file).catch(() => undefined);
  return asset;
}

function castOf(shot: Shot): Character[] {
  return shot.characterIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
}

const pendingLine = (shotId: ID): Job | undefined =>
  jobsRepo.list({ active: true }).find((j) => j.type === 'dialogue_line' && j.status === 'queued' && j.params.shotId === shotId);

/** Queue a render of the shot's line unless one is already waiting (it reads the shot when it runs, so the
 *  waiting job picks up the latest text). Returns undefined when there's nothing to render. */
export function queueLine(shot: Shot, opts: { force?: boolean } = {}): Job | undefined {
  const state = lineState(shot, castOf(shot));
  if (state === 'none' || state === 'no_speaker' || state === 'no_voice') return undefined;
  if (state === 'ready' && !opts.force) return undefined;
  const waiting = pendingLine(shot.id);
  if (waiting) return waiting;
  const speaker = resolveSpeaker(shot, castOf(shot))!;
  return enqueue({ type: 'dialogue_line', title: `Line: ${speaker.name}`, params: { shotId: shot.id }, shotId: shot.id });
}

/** Every shot (in any project) whose line this character speaks. */
export function shotsSpokenBy(characterId: ID): Shot[] {
  const out: Shot[] = [];
  for (const project of projectsRepo.list())
    for (const shot of shotsRepo.listByProject(project.id))
      if (shot.dialogue?.trim() && resolveSpeaker(shot, castOf(shot))?.id === characterId) out.push(shot);
  return out;
}

/** After a voice changes, re-render that character's lines. */
export function queueLinesForCharacter(characterId: ID): Job[] {
  return shotsSpokenBy(characterId)
    .map((s) => queueLine(s))
    .filter((j): j is Job => Boolean(j));
}

/** Queue whatever a project's lines need: a voice for speakers with a voice description but no voice yet
 *  (their lines follow when the voice lands), and a render for every missing or stale line. */
export function queueProjectVoices(projectId: ID): { voiceJobs: Job[]; lineJobs: Job[]; needsVoice: string[] } {
  const voiceJobs: Job[] = [];
  const lineJobs: Job[] = [];
  const needsVoice = new Set<string>();
  const designing = new Set<ID>();
  for (const shot of shotsRepo.listByProject(projectId)) {
    const cast = castOf(shot);
    const state = lineState(shot, cast);
    if (state === 'no_voice') {
      const speaker = resolveSpeaker(shot, cast)!;
      if (designing.has(speaker.id)) continue;
      const description = speaker.voiceHint?.trim();
      if (!description) {
        needsVoice.add(speaker.name);
        continue;
      }
      designing.add(speaker.id);
      voiceJobs.push(queueVoiceDesign(speaker, description));
    } else if (state === 'missing' || state === 'stale') {
      const job = queueLine(shot);
      if (job) lineJobs.push(job);
    }
  }
  return { voiceJobs, lineJobs, needsVoice: [...needsVoice] };
}

export function queueVoiceDesign(character: Character, description: string, language = character.voice?.language ?? DEFAULT_VOICE_LANGUAGE): Job {
  return enqueue({
    type: 'character_voice',
    title: `Voice: ${character.name}`,
    params: { characterId: character.id, description, language },
  });
}

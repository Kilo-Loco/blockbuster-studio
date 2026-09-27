// 'dialogue_line' job: a shot's line in its speaker's voice (Qwen3-TTS Base, cloned from the voice's
// reference clip), saved as the shot's dialogue audio. With { characterId, text } and no shot it renders a
// preview line for the voice editor instead.
import { registerRunner } from './queue';
import { assets as assetsRepo, characters as charactersRepo, scenes as scenesRepo, shots as shotsRepo } from '../db';
import { emit } from '../events';
import { tts } from '../tts/client';
import { assetDiskPath } from './media';
import { saveTtsAudio } from '../voice/lines';
import { dialogueKey, resolveSpeaker } from '../../shared/dialogue';
import type { Character } from '../../shared/types';

async function speak(character: Character, text: string) {
  const voice = character.voice;
  if (!voice) throw new Error(`${character.name} has no voice yet`);
  const ref = assetsRepo.get(voice.refAssetId);
  if (!ref) throw new Error(`${character.name}'s voice clip is missing; set the voice again`);
  return tts.clone({ text, language: voice.language, refAudio: assetDiskPath(ref), refText: voice.refText || undefined });
}

registerRunner('dialogue_line', async (job, ctx) => {
  const params = job.params as { shotId?: string; characterId?: string; text?: string };

  if (!params.shotId) {
    const character = charactersRepo.get(String(params.characterId ?? ''));
    if (!character) throw new Error('Character not found');
    const text = params.text?.trim();
    if (!text) throw new Error('Nothing to say');
    ctx.setProgress(0.1, 'Speaking');
    const asset = await saveTtsAudio(await speak(character, text), { prompt: text, params: { characterId: character.id, preview: true }, jobId: job.id });
    ctx.addOutput(asset.id);
    return;
  }

  // Read the shot now, not at queue time: edits made while the job waited are what should be heard.
  const shot = shotsRepo.get(params.shotId);
  if (!shot) throw new Error('Shot not found');
  const text = shot.dialogue?.trim();
  if (!text) return;
  const cast = shot.characterIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
  const speaker = resolveSpeaker(shot, cast);
  if (!speaker) throw new Error('Pick who says this line');
  if (!speaker.voice) throw new Error(`${speaker.name} has no voice yet`);

  ctx.setProgress(0.1, `Speaking as ${speaker.name}`);
  const projectId = scenesRepo.get(shot.sceneId)?.projectId;
  const audio = await speak(speaker, text);
  if (ctx.isCanceled()) throw new Error('canceled');
  const asset = await saveTtsAudio(audio, { prompt: text, params: { characterId: speaker.id }, jobId: job.id, projectId, shotId: shot.id });
  ctx.addOutput(asset.id);
  const updated = shotsRepo.update(shot.id, { dialogueAudioAssetId: asset.id, dialogueAudioKey: dialogueKey(text, speaker.id, speaker.voice) });
  if (updated) emit({ type: 'shot', shot: updated });
});

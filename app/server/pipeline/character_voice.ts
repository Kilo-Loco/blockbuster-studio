// 'character_voice' job: design a character's voice from a description (Qwen3-TTS VoiceDesign renders the
// reference clip every later line is cloned from), then re-render the lines that character speaks.
import { registerRunner } from './queue';
import { characters as charactersRepo } from '../db';
import { emit } from '../events';
import { tts } from '../tts/client';
import { DEFAULT_VOICE_LANGUAGE, REFERENCE_LINE, queueLinesForCharacter, saveTtsAudio } from '../voice/lines';

registerRunner('character_voice', async (job, ctx) => {
  const params = job.params as { characterId?: string; description?: string; language?: string };
  const character = charactersRepo.get(String(params.characterId ?? ''));
  if (!character) throw new Error('Character not found');
  const description = params.description?.trim();
  if (!description) throw new Error('Describe the voice first');
  const language = params.language || DEFAULT_VOICE_LANGUAGE;

  ctx.setProgress(0.1, 'Designing voice');
  const audio = await tts.design({ text: REFERENCE_LINE, instruct: description, language });
  if (ctx.isCanceled()) throw new Error('canceled');
  const asset = await saveTtsAudio(audio, { prompt: description, params: { characterId: character.id, voiceReference: true }, jobId: job.id });
  ctx.addOutput(asset.id);

  const updated = charactersRepo.update(character.id, {
    voice: { source: 'designed', description, refAssetId: asset.id, refText: REFERENCE_LINE, language, updatedAt: new Date().toISOString() },
    voiceHint: undefined,
  });
  if (updated) emit({ type: 'character', character: updated });
  queueLinesForCharacter(character.id);
});

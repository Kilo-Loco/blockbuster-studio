// Under a shot's dialogue: who says it, and the line in their voice (play, re-record, fit the shot to it).
import { useMutation, useQuery } from '@tanstack/react-query';
import { AudioLines, RotateCcw, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { toast, useJobsStore } from '../../lib/store';
import { useEngineState } from '../../hooks/useEngineState';
import { Button, Progress } from '../ui';
import { AssetAudio } from '../cast/VoiceSection';
import { LINE_START_SEC, lineState, resolveSpeaker } from '@shared/dialogue';
import { durationsFor } from '@shared/presets';
import type { Character, Shot } from '@shared/types';

export function LineVoice({ shot, characters, onPatch }: { shot: Shot; characters: Character[]; onPatch: (p: Partial<Shot>) => void }) {
  const { system } = useEngineState();
  const ready = system?.voice === 'ready';
  const cast = characters.filter((c) => shot.characterIds.includes(c.id));
  const state = lineState(shot, cast);
  const speaker = resolveSpeaker(shot, cast);
  const recording = useJobsStore((s) => Object.values(s.jobs).find((j) => j.shotId === shot.id && j.type === 'dialogue_line' && (j.status === 'queued' || j.status === 'running')));
  const { data: line } = useQuery({
    queryKey: ['asset', shot.dialogueAudioAssetId],
    queryFn: () => api.asset(shot.dialogueAudioAssetId!),
    enabled: !!shot.dialogueAudioAssetId,
  });

  const recordMut = useMutation({
    mutationFn: () => api.shotLine(shot.id),
    onSuccess: (job) => useJobsStore.getState().upsert(job),
    onError: (err: Error) => toast({ title: 'Could not record the line', description: err.message, variant: 'error' }),
  });
  const designMut = useMutation({
    mutationFn: () => api.designVoice(speaker!.id, { description: speaker!.voiceHint! }),
    onSuccess: (job) => {
      useJobsStore.getState().upsert(job);
      toast({ title: `Designing ${speaker!.name}'s voice`, description: 'Their lines are recorded when it lands.' });
    },
    onError: (err: Error) => toast({ title: 'Could not design the voice', description: err.message, variant: 'error' }),
  });

  if (state === 'none') return null;

  const lineSec = line?.durationSec ? line.durationSec + LINE_START_SEC : undefined;
  const tooLong = state === 'ready' && lineSec !== undefined && lineSec > shot.durationSec;
  const fitTo = lineSec !== undefined ? durationsFor(system?.videoModel, { quality: 'fast', vramTotalMB: system?.comfy.vramTotalMB }).find((d) => d >= lineSec) : undefined;

  return (
    <div className="-mt-2 flex flex-col gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)]/40 p-2.5">
      {shot.characterIds.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-2)]">
          <span className="shrink-0">Who says it</span>
          <select
            value={shot.dialogueSpeakerId ?? ''}
            onChange={(e) => e.target.value && onPatch({ dialogueSpeakerId: e.target.value })}
            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2 text-xs text-[var(--color-ink-0)]"
          >
            <option value="" disabled>
              Pick a character…
            </option>
            {cast.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {state === 'no_speaker' && shot.characterIds.length === 0 && <p className="text-xs text-[var(--color-ink-3)]">Add who says this line to the shot to hear it in their voice.</p>}

      {state === 'no_voice' && speaker && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-2)]">
          <AudioLines className="size-3.5" />
          <span>{speaker.name} has no voice yet.</span>
          {speaker.voiceHint ? (
            <Button size="sm" icon={<Wand2 className="size-3.5" />} disabled={!ready} loading={designMut.isPending} onClick={() => designMut.mutate()} title={speaker.voiceHint}>
              Design it: “{speaker.voiceHint.length > 40 ? `${speaker.voiceHint.slice(0, 40)}…` : speaker.voiceHint}”
            </Button>
          ) : (
            <span className="text-[var(--color-ink-3)]">Give them one in Cast.</span>
          )}
        </div>
      )}

      {(state === 'missing' || state === 'stale') &&
        (recording ? (
          <div className="flex flex-col gap-1 text-xs text-[var(--color-ink-3)]">
            <span>Recording {speaker?.name}'s line…</span>
            <Progress value={recording.progress} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-[var(--color-ink-2)]">
            <span>{state === 'stale' ? 'The line or voice changed since it was recorded.' : `Not recorded in ${speaker?.name}'s voice yet.`}</span>
            <Button size="sm" icon={<AudioLines className="size-3.5" />} disabled={!ready} loading={recordMut.isPending} onClick={() => recordMut.mutate()}>
              Record
            </Button>
          </div>
        ))}

      {state === 'ready' && shot.dialogueAudioAssetId && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <AssetAudio assetId={shot.dialogueAudioAssetId} className="h-8 min-w-0 flex-1" />
            <Button size="sm" icon={<RotateCcw className="size-3.5" />} disabled={!ready || !!recording} loading={recordMut.isPending || !!recording} onClick={() => recordMut.mutate()} title="Record another take">
              Retake
            </Button>
          </div>
          {tooLong && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-amber-400)]">
              <span>
                The line runs {lineSec!.toFixed(1)} s; the shot is {shot.durationSec} s.
              </span>
              {fitTo && (
                <button className="underline" onClick={() => onPatch({ durationSec: fitTo })}>
                  Make it {fitTo} s
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

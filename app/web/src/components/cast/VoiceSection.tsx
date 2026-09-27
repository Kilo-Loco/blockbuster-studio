// A character's voice (Qwen3-TTS): design one from a description or use an uploaded clip, hear it, and try
// any line in it. Every line the character speaks in the storyboard is cloned from this voice.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Mic, Trash2, Upload, Wand2 } from 'lucide-react';
import { api, mediaUrl } from '../../lib/api';
import { toast, useJobsStore } from '../../lib/store';
import { useEngineState } from '../../hooks/useEngineState';
import { Button, Progress, Segmented } from '../ui';
import type { Character, ID } from '@shared/types';

const inputClass =
  'w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50';

/** Plays an audio asset by id. */
export function AssetAudio({ assetId, autoPlay = false, className }: { assetId: ID; autoPlay?: boolean; className?: string }) {
  const { data: asset } = useQuery({ queryKey: ['asset', assetId], queryFn: () => api.asset(assetId) });
  if (!asset) return null;
  return <audio controls autoPlay={autoPlay} src={mediaUrl(asset.file)} className={className ?? 'h-9 w-full'} />;
}

/** The job with this id from the live queue store, and a callback when it finishes. */
function useJob(jobId: ID | null, onDone: (outputs: ID[]) => void, onError: (message?: string) => void) {
  const job = useJobsStore((s) => (jobId ? s.jobs[jobId] : undefined));
  useEffect(() => {
    if (job?.status === 'done') onDone(job.outputAssetIds);
    else if (job?.status === 'error') onError(job.error);
  }, [job?.status]);
  return job && job.status !== 'done' && job.status !== 'error' && job.status !== 'canceled' ? job : undefined;
}

export function VoiceSection({ character }: { character: Character }) {
  const qc = useQueryClient();
  const { system } = useEngineState();
  const voiceState = system?.voice;
  const [mode, setMode] = useState<'describe' | 'upload'>('describe');
  const [editing, setEditing] = useState(!character.voice);
  const [description, setDescription] = useState(character.voice?.description ?? character.voiceHint ?? '');
  const [transcript, setTranscript] = useState('');
  const [clip, setClip] = useState<File | null>(null);
  const [sample, setSample] = useState("Rough night, huh? Sit down, I'll get you some coffee.");
  const [designJobId, setDesignJobId] = useState<ID | null>(null);
  const [previewJobId, setPreviewJobId] = useState<ID | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<ID | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['character', character.id] });
    qc.invalidateQueries({ queryKey: ['characters'] });
  };

  const designing = useJob(
    designJobId,
    () => {
      setDesignJobId(null);
      setEditing(false);
      refresh();
      toast({ title: `${character.name} has a voice`, description: 'Every line they speak is recorded in it.' });
    },
    (message) => {
      setDesignJobId(null);
      toast({ title: 'Voice design failed', description: message, variant: 'error' });
    },
  );
  const previewing = useJob(
    previewJobId,
    (outputs) => {
      setPreviewJobId(null);
      setPreviewAssetId(outputs[0] ?? null);
    },
    (message) => {
      setPreviewJobId(null);
      toast({ title: 'Preview failed', description: message, variant: 'error' });
    },
  );

  const designMut = useMutation({
    mutationFn: () => api.designVoice(character.id, { description: description.trim() }),
    onSuccess: (job) => {
      useJobsStore.getState().upsert(job);
      setDesignJobId(job.id);
    },
    onError: (err: Error) => toast({ title: 'Could not design the voice', description: err.message, variant: 'error' }),
  });

  const uploadMut = useMutation({
    mutationFn: async () => {
      const asset = await api.upload(clip!);
      return api.setVoiceClip(character.id, { assetId: asset.id, transcript: transcript.trim() || undefined });
    },
    onSuccess: (c) => {
      qc.setQueryData(['character', character.id], c);
      refresh();
      setEditing(false);
      setClip(null);
      toast({ title: `${character.name} has a voice` });
    },
    onError: (err: Error) => toast({ title: 'Could not use that clip', description: err.message, variant: 'error' }),
  });

  const previewMut = useMutation({
    mutationFn: () => api.previewVoice(character.id, sample.trim()),
    onSuccess: (job) => {
      useJobsStore.getState().upsert(job);
      setPreviewAssetId(null);
      setPreviewJobId(job.id);
    },
    onError: (err: Error) => toast({ title: 'Could not preview', description: err.message, variant: 'error' }),
  });

  const clearMut = useMutation({
    mutationFn: () => api.clearVoice(character.id),
    onSuccess: (c) => {
      qc.setQueryData(['character', character.id], c);
      refresh();
      setEditing(true);
    },
  });

  const ready = voiceState === 'ready';
  const voice = character.voice;

  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-2)]/50 p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-2)]">
          <AudioLines className="size-3.5" /> Voice
        </label>
        {voice && !editing && (
          <div className="flex items-center gap-3">
            <button className="text-xs text-[var(--color-ink-2)] hover:underline" onClick={() => setEditing(true)}>
              Change
            </button>
            <button className="flex items-center gap-1 text-xs text-[var(--color-danger)] hover:underline" onClick={() => clearMut.mutate()}>
              <Trash2 className="size-3" /> Remove
            </button>
          </div>
        )}
      </div>

      {!ready && (
        <p className="mb-2 text-[11px] text-[var(--color-ink-3)]">
          {voiceState === 'off' ? 'Voices are off on this pod (DOWNLOAD_VOICE_MODELS=false).' : 'The voice engine is still downloading; voices unlock when it lands.'}
        </p>
      )}

      {voice && !editing ? (
        <div className="space-y-2.5">
          <p className="text-xs text-[var(--color-ink-1)]">
            {voice.source === 'designed' ? voice.description : voice.refText ? 'Cloned from your clip.' : 'Cloned from your clip (no transcript, so a looser match).'}
          </p>
          <AssetAudio assetId={voice.refAssetId} />
          <div className="flex gap-2">
            <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Type a line to hear it" className={inputClass} />
            <Button size="sm" className="shrink-0 whitespace-nowrap" icon={<Mic className="size-3.5" />} disabled={!ready || !sample.trim()} loading={previewMut.isPending || !!previewing} onClick={() => previewMut.mutate()}>
              Say it
            </Button>
          </div>
          {previewing && <Progress value={previewing.progress} />}
          {previewAssetId && <AssetAudio key={previewAssetId} assetId={previewAssetId} autoPlay />}
        </div>
      ) : (
        <div className="space-y-2.5">
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'describe', label: 'Describe', icon: <Wand2 className="size-3.5" /> },
              { value: 'upload', label: 'Upload a clip', icon: <Upload className="size-3.5" /> },
            ]}
          />
          {mode === 'describe' ? (
            <>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Gravelly, tired man in his 60s, slow Southern drawl"
                className={`${inputClass} resize-none`}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} disabled={!ready || !description.trim()} loading={designMut.isPending || !!designing} onClick={() => designMut.mutate()}>
                  {voice ? 'Design a new voice' : 'Design voice'}
                </Button>
                {voice && (
                  <button className="text-xs text-[var(--color-ink-3)] hover:underline" onClick={() => setEditing(false)}>
                    Keep the current one
                  </button>
                )}
              </div>
              {designing && <Progress value={designing.progress} />}
            </>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  setClip(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                  {clip ? 'Choose another' : 'Choose a clip'}
                </Button>
                <span className="truncate text-xs text-[var(--color-ink-3)]">{clip ? clip.name : '5–15 s of one person talking, no music'}</span>
              </div>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={2}
                placeholder="What's said in the clip (optional, makes the voice closer)"
                className={`${inputClass} resize-none`}
              />
              <Button size="sm" variant="primary" disabled={!clip} loading={uploadMut.isPending} onClick={() => uploadMut.mutate()}>
                Use this voice
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

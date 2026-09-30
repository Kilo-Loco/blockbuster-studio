import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileJson, Trash2, Upload } from 'lucide-react';
import { api, mediaUrl } from '../../lib/api';
import { toast } from '../../lib/store';
import type { Scene, Shot } from '@shared/types';
import { parsePrevisSequences, type PrevisSequence } from '@shared/previs';
import { Button, Dialog } from '../ui';
import { useDebouncedCallback } from './hooks';
import { parseCutsInput, previsShotWindows } from './utils';

function fmt(sec: number): string {
  return `${sec.toFixed(1)}s`;
}

/** When a sequences.json has more than one sequence, ask which one this scene is. */
function SequencePickerDialog({
  open,
  onClose,
  sequences,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  sequences: PrevisSequence[];
  onPick: (index: number) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Which sequence?" size="sm">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-[var(--color-ink-2)]">This file has {sequences.length} sequences. Pick the one for this scene.</p>
        {sequences.map((seq, i) => (
          <button
            key={i}
            onClick={() => onPick(i)}
            className="flex items-center justify-between rounded-lg border border-[var(--color-hairline)] px-3 py-2 text-left text-sm text-[var(--color-ink-1)] hover:border-[var(--color-hairline-strong)]"
          >
            <span>{seq.name}</span>
            <span className="text-xs text-[var(--color-ink-3)]">{seq.shots.length} shots</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export function PrevisImportStep({ scene, shots, projectId }: { scene: Scene; shots: Shot[]; projectId: string }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'project' });

  const patch = useMutation({
    mutationFn: (body: Partial<Scene>) => api.updateScene(scene.id, body),
    onSuccess: invalidate,
    onError: (err) => toast({ title: 'Could not save previs', description: (err as Error).message, variant: 'error' }),
  });

  const { data: previsAsset } = useQuery({ queryKey: ['asset', scene.previsAssetId], queryFn: () => api.asset(scene.previsAssetId!), enabled: !!scene.previsAssetId });
  const { data: depthAsset } = useQuery({ queryKey: ['asset', scene.previsDepthAssetId], queryFn: () => api.asset(scene.previsDepthAssetId!), enabled: !!scene.previsDepthAssetId });

  const [cutsText, setCutsText] = useState((scene.previsCuts ?? []).join(', '));
  const [cutsError, setCutsError] = useState(false);
  const debouncedCuts = useDebouncedCallback((v: string) => {
    const parsed = parseCutsInput(v);
    setCutsError(parsed === undefined);
    if (parsed !== undefined) patch.mutate({ previsCuts: parsed });
  }, 600);

  const previsFileRef = useRef<HTMLInputElement>(null);
  const depthFileRef = useRef<HTMLInputElement>(null);
  const sequencesFileRef = useRef<HTMLInputElement>(null);

  const uploadPrevis = useMutation({
    mutationFn: async (file: File) => {
      const asset = await api.upload(file, projectId);
      return api.updateScene(scene.id, { previsAssetId: asset.id });
    },
    onSuccess: invalidate,
    onError: (err) => toast({ title: 'Upload failed', description: (err as Error).message, variant: 'error' }),
  });
  const uploadDepth = useMutation({
    mutationFn: async (file: File) => {
      const asset = await api.upload(file, projectId);
      return api.updateScene(scene.id, { previsDepthAssetId: asset.id });
    },
    onSuccess: invalidate,
    onError: (err) => toast({ title: 'Upload failed', description: (err as Error).message, variant: 'error' }),
  });

  const [pendingSequences, setPendingSequences] = useState<PrevisSequence[] | null>(null);
  const pendingJsonRef = useRef<unknown>(undefined);

  const importMut = useMutation({
    mutationFn: (args: { json: unknown; sequence?: number }) => api.importPrevisSequences(scene.id, args.json, args.sequence),
    onSuccess: (res) => {
      invalidate();
      setCutsText((res.scene.previsCuts ?? []).join(', '));
      setCutsError(false);
      toast({ title: `Imported ${res.shots.length} shot${res.shots.length === 1 ? '' : 's'}`, variant: 'success' });
    },
    onError: (err) => {
      const detail = (err as { detail?: unknown }).detail;
      toast({ title: 'Could not import sequences.json', description: (detail as { error?: string })?.error ?? (err as Error).message, variant: 'error' });
    },
  });

  function handleSequencesFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      let json: unknown;
      try {
        json = JSON.parse(String(reader.result));
      } catch {
        toast({ title: 'Could not read sequences.json', variant: 'error' });
        return;
      }
      const sequences = parsePrevisSequences(json);
      if (!sequences) {
        toast({ title: 'Could not use sequences.json', description: 'No usable sequence with shot start/end times was found.', variant: 'error' });
        return;
      }
      if (sequences.length > 1) {
        pendingJsonRef.current = json;
        setPendingSequences(sequences);
      } else {
        importMut.mutate({ json });
      }
    };
    reader.readAsText(file);
  }

  const windows = previsShotWindows(shots, scene.previsCuts, previsAsset?.durationSec);
  const lastEnd = windows.length ? windows[windows.length - 1]!.start + windows[windows.length - 1]!.duration : 0;
  const runsPastVideo = Boolean(previsAsset?.durationSec) && lastEnd > (previsAsset!.durationSec! + 0.05);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--color-ink-2)]">Previs video</span>
        <input
          ref={previsFileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadPrevis.mutate(f);
            e.target.value = '';
          }}
        />
        {scene.previsAssetId ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <video src={mediaUrl(previsAsset?.file)} controls className="aspect-video w-full max-w-xs rounded-lg bg-black sm:w-64" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Upload className="size-3.5" />} loading={uploadPrevis.isPending} onClick={() => previsFileRef.current?.click()}>
                Replace
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => patch.mutate({ previsAssetId: undefined })}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" icon={<Upload className="size-3.5" />} loading={uploadPrevis.isPending} onClick={() => previsFileRef.current?.click()}>
            Upload previs video
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--color-ink-2)]">Depth pass — optional, makes shots follow the previs more closely</span>
        <input
          ref={depthFileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadDepth.mutate(f);
            e.target.value = '';
          }}
        />
        {scene.previsDepthAssetId ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <video src={mediaUrl(depthAsset?.file)} controls className="aspect-video w-full max-w-xs rounded-lg bg-black sm:w-64" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Upload className="size-3.5" />} loading={uploadDepth.isPending} onClick={() => depthFileRef.current?.click()}>
                Replace
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => patch.mutate({ previsDepthAssetId: undefined })}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" icon={<Upload className="size-3.5" />} loading={uploadDepth.isPending} onClick={() => depthFileRef.current?.click()}>
            Upload depth pass
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Shots from sequences.json</span>
          <input
            ref={sequencesFileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleSequencesFile(f);
              e.target.value = '';
            }}
          />
          <Button size="sm" variant="ghost" icon={<FileJson className="size-3.5" />} loading={importMut.isPending} onClick={() => sequencesFileRef.current?.click()}>
            Import sequences.json
          </Button>
        </div>
        <p className="text-xs text-[var(--color-ink-3)]">Creates this scene's shots from the file's cuts, names and beats.</p>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--color-ink-3)]">Edit cut times (seconds)</span>
          <input
            value={cutsText}
            onChange={(e) => {
              setCutsText(e.target.value);
              debouncedCuts(e.target.value);
            }}
            placeholder="3.0, 5.0, 7.5"
            className="chip-mono h-9 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
          <p className="text-xs text-[var(--color-ink-3)]">
            {cutsError
              ? 'Enter non-negative numbers, increasing left to right, separated by commas.'
              : shots.length === 0
                ? 'Importing sequences.json fills this in. Or type where each cut falls, in seconds.'
                : shots.length === 1
                  ? 'One shot covers the whole previs, so there are no cuts.'
                  : `Where each shot after the first begins, in seconds: ${shots.length - 1} for this scene's ${shots.length} shots.`}
          </p>
        </label>

        {runsPastVideo && (
          <p className="text-xs text-[var(--color-danger)]">
            The shots run to {fmt(lastEnd)}, past the previs video's {fmt(previsAsset!.durationSec!)}.
          </p>
        )}

        {shots.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] p-2 text-xs text-[var(--color-ink-1)]">
            {shots.map((s, i) => (
              <li key={s.id} className="flex items-center justify-between">
                <span className="truncate pr-2">
                  Shot {i + 1}
                  {s.action ? ` · ${s.action}` : ''}
                </span>
                <span className="chip-mono shrink-0 text-[var(--color-ink-3)]">
                  {fmt(windows[i]?.start ?? 0)} – {fmt((windows[i]?.start ?? 0) + (windows[i]?.duration ?? 0))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingSequences && (
        <SequencePickerDialog
          open
          onClose={() => setPendingSequences(null)}
          sequences={pendingSequences}
          onPick={(index) => {
            const json = pendingJsonRef.current;
            setPendingSequences(null);
            importMut.mutate({ json, sequence: index });
          }}
        />
      )}
    </div>
  );
}

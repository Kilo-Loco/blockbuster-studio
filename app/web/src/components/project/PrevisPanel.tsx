import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileJson, Trash2, Upload } from 'lucide-react';
import { api, mediaUrl } from '../../lib/api';
import { toast } from '../../lib/store';
import type { Scene, Shot } from '@shared/types';
import { Button, Dialog } from '../ui';
import { useDebouncedCallback } from './hooks';
import { parseCutsInput, previsCutsFromSequences, previsShotWindows } from './utils';

function fmt(sec: number): string {
  return `${sec.toFixed(1)}s`;
}

export function PrevisPanel({
  open,
  onClose,
  scene,
  shots,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  scene: Scene;
  shots: Shot[];
  projectId: string;
}) {
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
  useEffect(() => setCutsText((scene.previsCuts ?? []).join(', ')), [scene.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const windows = previsShotWindows(shots, scene.previsCuts, previsAsset?.durationSec);

  function importSequences(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        const cuts = previsCutsFromSequences(json);
        if (!cuts || cuts.length !== shots.length - 1) {
          toast({
            title: 'Could not use sequences.json',
            description: `This scene has ${shots.length} shot(s), which needs ${Math.max(0, shots.length - 1)} cut time(s); the file gave ${cuts?.length ?? 0}.`,
            variant: 'error',
          });
          return;
        }
        setCutsText(cuts.join(', '));
        setCutsError(false);
        patch.mutate({ previsCuts: cuts });
        toast({ title: 'Cuts imported', variant: 'success' });
      } catch {
        toast({ title: 'Could not read sequences.json', variant: 'error' });
      }
    };
    reader.readAsText(file);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Scene previs" size="lg">
      <div className="flex flex-col gap-5">
        <p className="text-xs text-[var(--color-ink-2)]">
          A previs is a simple grey 3D blockout that sets the camera, cuts and timing. Each shot renders its slice of it.
        </p>

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
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Cut times (seconds)</span>
            <input
              ref={sequencesFileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importSequences(f);
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="ghost" icon={<FileJson className="size-3.5" />} onClick={() => sequencesFileRef.current?.click()}>
              Import sequences.json
            </Button>
          </div>
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
              : `This scene has ${shots.length} shot${shots.length === 1 ? '' : 's'}, so ${Math.max(0, shots.length - 1)} cut time${shots.length - 1 === 1 ? '' : 's'} marks where each shot after the first begins.`}
          </p>
        </div>

        {shots.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-ink-2)]">Each shot's slice of the previs</span>
            <ul className="flex flex-col gap-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] p-2 text-xs text-[var(--color-ink-1)]">
              {shots.map((s, i) => (
                <li key={s.id} className="flex items-center justify-between">
                  <span>Shot {i + 1}</span>
                  <span className="chip-mono text-[var(--color-ink-3)]">
                    {fmt(windows[i]?.start ?? 0)} – {fmt((windows[i]?.start ?? 0) + (windows[i]?.duration ?? 0))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}

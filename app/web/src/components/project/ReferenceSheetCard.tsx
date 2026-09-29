import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { RefreshCw, Sparkles, Upload } from 'lucide-react';
import { api, mediaUrl } from '../../lib/api';
import { toast, useJobsStore } from '../../lib/store';
import type { Character, ID, Scene, Shot } from '@shared/types';
import { Button, Progress } from '../ui';
import { useDebouncedCallback } from './hooks';

export function ReferenceSheetCard({ scene, shots, characters, projectId }: { scene: Scene; shots: Shot[]; characters: Character[]; projectId: string }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'project' });
  const jobs = useJobsStore((s) => s.jobs);
  const activeJob = Object.values(jobs).find((j) => j.type === 'scene_reference_sheet' && j.projectId === projectId && (j.status === 'queued' || j.status === 'running') && j.params.sceneId === scene.id);

  const { data: sheetAsset } = useQuery({ queryKey: ['asset', scene.referenceSheetAssetId], queryFn: () => api.asset(scene.referenceSheetAssetId!), enabled: !!scene.referenceSheetAssetId });

  const buildMut = useMutation({
    mutationFn: () => api.sceneReferenceSheet(scene.id),
    onSuccess: (job) => {
      useJobsStore.getState().upsert(job);
      toast({ title: 'Building reference sheet…' });
    },
    onError: (err) => toast({ title: 'Could not build the sheet', description: (err as Error).message, variant: 'error' }),
  });

  const patch = useMutation({
    mutationFn: (body: Partial<Scene>) => api.updateScene(scene.id, body),
    onSuccess: invalidate,
    onError: (err) => toast({ title: 'Could not save', description: (err as Error).message, variant: 'error' }),
  });

  const [text, setText] = useState(scene.referenceSheetText ?? '');
  useEffect(() => setText(scene.referenceSheetText ?? ''), [scene.id, scene.referenceSheetText]);
  const debouncedText = useDebouncedCallback((v: string) => patch.mutate({ referenceSheetText: v }), 700);

  const fileRef = useRef<HTMLInputElement>(null);
  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const asset = await api.upload(file, projectId);
      return api.updateScene(scene.id, { referenceSheetAssetId: asset.id });
    },
    onSuccess: invalidate,
    onError: (err) => toast({ title: 'Upload failed', description: (err as Error).message, variant: 'error' }),
  });

  const castIds = [...new Set(shots.flatMap((s) => s.characterIds))];
  const cast = castIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is Character => Boolean(c));
  const missingSheets = cast.filter((c) => {
    const isProp = (c.kind ?? 'person') === 'prop';
    return !c.sheetAssets?.turnaround || (!isProp && !c.sheetAssets?.face);
  });

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-hairline)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-ink-2)]">Reference sheet</span>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadMut.mutate(f);
              e.target.value = '';
            }}
          />
          <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} loading={uploadMut.isPending} onClick={() => fileRef.current?.click()}>
            Use my own image
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={scene.referenceSheetAssetId ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
            loading={buildMut.isPending || !!activeJob}
            onClick={() => buildMut.mutate()}
          >
            {scene.referenceSheetAssetId ? 'Rebuild sheet' : 'Build sheet'}
          </Button>
        </div>
      </div>
      <p className="text-xs text-[var(--color-ink-3)]">
        One image with the scene's characters, props and location. It keeps faces, clothes and objects consistent across shots.
      </p>

      {activeJob && (
        <div>
          <Progress value={activeJob.progress} />
          <div className="mt-1 text-[11px] text-[var(--color-ink-3)]">{activeJob.stage ?? 'Building…'}</div>
        </div>
      )}

      {scene.referenceSheetAssetId ? (
        <img src={mediaUrl(sheetAsset?.thumb ?? sheetAsset?.file)} alt="Scene reference sheet" className="max-h-64 w-full rounded-lg border border-[var(--color-hairline)] object-contain bg-[var(--color-bg-2)]" />
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-hairline)] px-3 py-6 text-center text-xs text-[var(--color-ink-3)]">
          No reference sheet yet — build one from this scene's cast and location, or upload your own.
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--color-ink-3)]">What's on the sheet</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            debouncedText(e.target.value);
          }}
          rows={2}
          className="resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 py-2 text-xs text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
        />
      </label>

      {missingSheets.length > 0 && (
        <p className="text-xs text-[var(--color-ink-3)]">
          Missing sheets for {missingSheets.map((c) => c.name).join(', ')} —{' '}
          <Link to="/cast" className="text-[var(--color-amber-300)] hover:underline">
            generate them in Cast &amp; props
          </Link>{' '}
          for a stronger sheet.
        </p>
      )}
    </div>
  );
}

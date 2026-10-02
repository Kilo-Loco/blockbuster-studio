import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Camera as CameraIcon } from 'lucide-react';
import { api, mediaUrl } from '../../lib/api';
import { toast } from '../../lib/store';
import { useEngineState } from '../../hooks/useEngineState';
import { useTrackedJobs } from '../../hooks/useTrackedJobs';
import { Button, Dialog, Progress, Skeleton } from '../ui';
import { AnglePicker } from './AnglePicker';
import { AssetLightbox } from '../AssetLightbox';
import type { AngleSpec, ID, Job, Location } from '@shared/types';

function useAsset(id: ID | undefined) {
  return useQuery({ queryKey: ['asset', id], queryFn: () => api.asset(id!), enabled: !!id });
}

function angleCaption(angleKey: string) {
  return angleKey.split('|').join(' · ');
}

function AngleThumb({ assetId, angleKey, onOpen }: { assetId: ID; angleKey: string; onOpen: () => void }) {
  const { data: asset } = useAsset(assetId);
  const [azimuth, elevation, distance] = angleKey.split('|');
  return (
    <button
      onClick={onOpen}
      aria-label={`Open ${angleCaption(angleKey)}`}
      className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] text-left transition-colors hover:border-[var(--color-amber-400)]/50"
    >
      <div className="aspect-video">
        {asset ? <img src={mediaUrl(asset.thumb ?? asset.file)} alt={angleKey} className="size-full object-cover" /> : <Skeleton className="size-full" />}
      </div>
      <div className="px-2 py-1.5 text-[10px] leading-tight text-[var(--color-ink-2)]">
        <div className="truncate">{azimuth}</div>
        <div className="truncate text-[var(--color-ink-3)]">
          {elevation} · {distance}
        </div>
      </div>
    </button>
  );
}

/** Placeholder tile for an angle that is queued or rendering. */
function PendingAngle({ job }: { job: Job }) {
  const angle = job.params.angle as AngleSpec | undefined;
  const queued = job.status === 'queued';
  return (
    <div className="overflow-hidden rounded-lg border border-dashed border-[var(--color-hairline)] bg-[var(--color-bg-2)]/50">
      <div className="flex aspect-video flex-col items-center justify-center gap-2 px-3">
        <span className="text-[11px] text-[var(--color-ink-2)]">
          {queued ? (job.queuePosition ? `Queued · #${job.queuePosition}` : 'Queued') : (job.stage ?? 'Rendering…')}
        </span>
        {!queued && <Progress value={job.progress} className="max-w-24" />}
      </div>
      <div className="px-2 py-1.5 text-[10px] leading-tight text-[var(--color-ink-3)]">
        <div className="truncate">{angle?.azimuth}</div>
        <div className="truncate">
          {angle?.elevation} · {angle?.distance}
        </div>
      </div>
    </div>
  );
}

export function AngleGallery({ location }: { location: Location }) {
  const qc = useQueryClient();
  const { isOff } = useEngineState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [angle, setAngle] = useState<AngleSpec>({ azimuth: 'front-right quarter view', elevation: 'eye-level shot', distance: 'medium shot' });
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const renders = useTrackedJobs({
    onDone: () => {
      toast({ title: 'Angle ready' });
      qc.invalidateQueries({ queryKey: ['location', location.id] });
    },
    onError: (job) => toast({ title: 'Angle render failed', description: job.error, variant: 'error' }),
  });

  const renderMut = useMutation({
    mutationFn: () => api.locationAngle(location.id, angle),
    onSuccess: (j) => {
      renders.track(j);
      setPickerOpen(false);
      toast({ title: j.status === 'queued' ? 'Angle queued' : 'Rendering angle…' });
    },
    onError: () => toast({ title: 'Failed to start render', variant: 'error' }),
  });

  const removeMut = useMutation({
    mutationFn: (assetId: ID) => api.updateLocation(location.id, { angleViews: location.angleViews.filter((v) => v.assetId !== assetId) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['location', location.id] }),
    onError: () => toast({ title: 'Could not remove angle', variant: 'error' }),
  });

  if (isOff('qwen_angle')) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold tracking-tight text-lg text-[var(--color-ink-0)]">Angle views</h2>
        <Button size="sm" icon={<Plus className="size-3.5" />} loading={renderMut.isPending} onClick={() => setPickerOpen(true)}>
          Render new angle
        </Button>
      </div>

      {location.angleViews.length === 0 && renders.active.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-hairline)] py-10 text-center">
          <CameraIcon className="size-6 text-[var(--color-ink-3)]" />
          <p className="max-w-xs text-xs text-[var(--color-ink-2)]">No angle views cached yet. Render one to build up a reusable set of camera angles for this set.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {location.angleViews.map((v, i) => (
            <AngleThumb key={v.key} assetId={v.assetId} angleKey={v.key} onOpen={() => setOpenIndex(i)} />
          ))}
          {renders.active.map((job) => (
            <PendingAngle key={job.id} job={job} />
          ))}
        </div>
      )}

      {openIndex !== null && (
        <AssetLightbox
          assetIds={location.angleViews.map((v) => v.assetId)}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          caption={(i) => angleCaption(location.angleViews[i]?.key ?? '')}
          onRemove={(assetId) => {
            if (window.confirm('Remove this angle from the location?')) removeMut.mutate(assetId);
          }}
          removeLabel="Remove angle"
        />
      )}

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} title="Render new angle" size="sm">
        <div className="space-y-4">
          <AnglePicker value={angle} onChange={setAngle} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={renderMut.isPending} onClick={() => renderMut.mutate()}>
              Render
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

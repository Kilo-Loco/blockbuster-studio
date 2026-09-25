import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Camera as CameraIcon } from 'lucide-react';
import { api, mediaUrl } from '../../lib/api';
import { toast, useJobsStore } from '../../lib/store';
import { useEngineState } from '../../hooks/useEngineState';
import { Button, Dialog, Skeleton } from '../ui';
import { AnglePicker } from './AnglePicker';
import type { AngleSpec, ID, Location } from '@shared/types';

function useAsset(id: ID | undefined) {
  return useQuery({ queryKey: ['asset', id], queryFn: () => api.asset(id!), enabled: !!id });
}

function AngleThumb({ assetId, angleKey }: { assetId: ID; angleKey: string }) {
  const { data: asset } = useAsset(assetId);
  const [azimuth, elevation, distance] = angleKey.split('|');
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)]">
      <div className="aspect-video">
        {asset ? <img src={mediaUrl(asset.thumb ?? asset.file)} alt={angleKey} className="size-full object-cover" /> : <Skeleton className="size-full" />}
      </div>
      <div className="px-2 py-1.5 text-[10px] leading-tight text-[var(--color-ink-2)]">
        <div className="truncate">{azimuth}</div>
        <div className="truncate text-[var(--color-ink-3)]">
          {elevation} · {distance}
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
  const [jobId, setJobId] = useState<ID | null>(null);
  const jobs = useJobsStore((s) => s.jobs);
  const job = jobId ? jobs[jobId] : undefined;

  const renderMut = useMutation({
    mutationFn: () => api.locationAngle(location.id, angle),
    onSuccess: (j) => {
      setJobId(j.id);
      useJobsStore.getState().upsert(j);
      setPickerOpen(false);
      toast({ title: 'Rendering angle…' });
    },
    onError: () => toast({ title: 'Failed to start render', variant: 'error' }),
  });

  useEffect(() => {
    if (job?.status === 'done') {
      toast({ title: 'Angle ready' });
      qc.invalidateQueries({ queryKey: ['location', location.id] });
      setJobId(null);
    } else if (job?.status === 'error') {
      toast({ title: 'Angle render failed', description: job.error, variant: 'error' });
      setJobId(null);
    }
  }, [job?.status]);

  if (isOff('qwen_angle')) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-lg text-[var(--color-ink-0)]">Angle views</h2>
        <Button size="sm" icon={<Plus className="size-3.5" />} loading={renderMut.isPending || (!!job && job.status !== 'done' && job.status !== 'error')} onClick={() => setPickerOpen(true)}>
          Render new angle
        </Button>
      </div>

      {location.angleViews.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-hairline)] py-10 text-center">
          <CameraIcon className="size-6 text-[var(--color-ink-3)]" />
          <p className="max-w-xs text-xs text-[var(--color-ink-2)]">No angle views cached yet. Render one to build up a reusable set of camera angles for this set.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {location.angleViews.map((v) => (
            <AngleThumb key={v.key} assetId={v.assetId} angleKey={v.key} />
          ))}
        </div>
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

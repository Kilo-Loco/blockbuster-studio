import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, Upload, Wand2 } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { toast, useJobsStore } from '../lib/store';
import { Button, IconButton, Popover, Skeleton } from '../components/ui';
import { MapEditor } from '../components/location/MapEditor';
import { AngleGallery } from '../components/location/AngleGallery';
import type { Asset, ID, Location } from '@shared/types';

export default function LocationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: location, isLoading } = useQuery({ queryKey: ['location', id], queryFn: () => api.location(id!), enabled: !!id });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [estJobId, setEstJobId] = useState<ID | null>(null);
  const jobs = useJobsStore((s) => s.jobs);
  const estJob = estJobId ? jobs[estJobId] : undefined;
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (location) {
      setName(location.name);
      setDescription(location.description);
    }
  }, [location?.id]);

  useEffect(() => {
    if (estJob?.status === 'done') {
      toast({ title: 'Establishing shot ready' });
      qc.invalidateQueries({ queryKey: ['location', id] });
      setEstJobId(null);
    } else if (estJob?.status === 'error') {
      toast({ title: 'Generation failed', description: estJob.error, variant: 'error' });
      setEstJobId(null);
    }
  }, [estJob?.status]);

  const updateMut = useMutation({
    mutationFn: (body: Partial<Location>) => api.updateLocation(id!, body),
    onSuccess: (loc) => {
      qc.setQueryData(['location', id], loc);
      qc.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: () => toast({ title: 'Failed to save changes', variant: 'error' }),
  });

  const genMut = useMutation({
    mutationFn: () => api.locationEstablishing(id!, { prompt: customPrompt || undefined }),
    onSuccess: (job) => {
      setEstJobId(job.id);
      useJobsStore.getState().upsert(job);
      toast({ title: 'Generating establishing shot…' });
    },
    onError: () => toast({ title: 'Failed to start generation', variant: 'error' }),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const asset = await api.upload(file);
      return api.updateLocation(id!, { establishingAssetId: asset.id });
    },
    onSuccess: (loc) => qc.setQueryData(['location', id], loc),
    onError: () => toast({ title: 'Upload failed', variant: 'error' }),
  });

  const { data: estAsset } = useQuery({
    queryKey: ['asset', location?.establishingAssetId],
    queryFn: () => api.asset(location!.establishingAssetId!),
    enabled: !!location?.establishingAssetId,
  });

  if (isLoading || !location) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="aspect-video w-full" />
        </div>
      </div>
    );
  }

  const saveName = () => {
    if (name.trim() && name !== location.name) updateMut.mutate({ name: name.trim() });
  };
  const saveDescription = () => {
    if (description !== location.description) updateMut.mutate({ description });
  };

  const generating = genMut.isPending || (!!estJob && estJob.status !== 'done' && estJob.status !== 'error');

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <button
          onClick={() => navigate('/locations')}
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]"
        >
          <ArrowLeft className="size-3.5" /> Locations
        </button>

        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_1.2fr]">
          <div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              className="w-full rounded-lg border border-transparent bg-transparent font-serif text-2xl text-[var(--color-ink-0)] outline-none transition-colors hover:border-[var(--color-hairline)] focus:border-[var(--color-amber-400)]/50 focus:bg-[var(--color-bg-2)] px-1 -mx-1"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              rows={4}
              placeholder="A neon-lit ramen bar, rain on the windows, 1980s Tokyo…"
              className="mt-2 w-full resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-1)] outline-none focus:border-[var(--color-amber-400)]/50"
            />
            {location.triggerWord && <div className="chip-mono mt-2 text-xs text-[var(--color-ink-3)]">{location.triggerWord}</div>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Optional custom prompt for establishing shot…"
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-xs text-[var(--color-ink-1)] outline-none focus:border-[var(--color-amber-400)]/50"
              />
              <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={generating} onClick={() => genMut.mutate()}>
                Generate
              </Button>
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
              <IconButton icon={<Upload className="size-4" />} label="Upload establishing image" size="sm" onClick={() => fileRef.current?.click()} />
              <GalleryPicker onPick={(assetId) => updateMut.mutate({ establishingAssetId: assetId })} />
            </div>
            {generating && estJob && (
              <div className="mt-2 text-[11px] text-[var(--color-ink-3)]">{estJob.stage ?? 'Generating…'}</div>
            )}
          </div>

          <div className="aspect-video overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-2)]">
            {location.establishingAssetId ? (
              estAsset ? (
                <img src={mediaUrl(estAsset.thumb ?? estAsset.file)} alt={location.name} className="size-full object-cover" />
              ) : (
                <Skeleton className="size-full" />
              )
            ) : (
              <div className="flex size-full items-center justify-center text-center text-sm text-[var(--color-ink-3)]">No establishing image yet</div>
            )}
          </div>
        </div>

        <MapEditor key={location.id} locationId={location.id} initialMap={location.map} onSave={(map) => updateMut.mutate({ map })} />

        <AngleGallery location={location} />
      </div>
    </div>
  );
}

function GalleryPicker({ onPick }: { onPick: (assetId: ID) => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['assets', 'image'], queryFn: () => api.assets({ kind: 'image' }), enabled: open });
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={({ onClick, ref }) => <IconButton ref={ref} icon={<ImagePlus className="size-4" />} label="Pick from gallery" size="sm" onClick={onClick} />}
    >
      <div className="max-h-72 w-64 overflow-y-auto p-2">
        {!data && <div className="p-3 text-xs text-[var(--color-ink-3)]">Loading…</div>}
        {data && data.items.length === 0 && <div className="p-3 text-xs text-[var(--color-ink-3)]">No images yet.</div>}
        <div className="grid grid-cols-3 gap-1.5">
          {data?.items.map((a: Asset) => (
            <button
              key={a.id}
              className="aspect-square overflow-hidden rounded-md border border-transparent hover:border-[var(--color-amber-400)]/50"
              onClick={() => {
                onPick(a.id);
                setOpen(false);
              }}
            >
              <img src={mediaUrl(a.thumb ?? a.file)} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

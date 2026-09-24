import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { toast } from '../lib/store';
import { Button, Skeleton } from '../components/ui';
import type { Location, ID } from '@shared/types';

function useAsset(id: ID | undefined) {
  return useQuery({ queryKey: ['asset', id], queryFn: () => api.asset(id!), enabled: !!id });
}

const GRADIENTS = [
  'linear-gradient(155deg, #2a1e3d, #0a0a0c)',
  'linear-gradient(155deg, #1e2f3d, #0a0a0c)',
  'linear-gradient(155deg, #3d2a1e, #0a0a0c)',
  'linear-gradient(155deg, #1e3d2a, #0a0a0c)',
  'linear-gradient(155deg, #3d1e2a, #0a0a0c)',
];

function gradientFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length]!;
}

function LocationCard({ location }: { location: Location }) {
  const navigate = useNavigate();
  const { data: asset } = useAsset(location.establishingAssetId);

  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] transition-colors hover:border-[var(--color-hairline-strong)]"
      onClick={() => navigate(`/locations/${location.id}`)}
    >
      <div className="relative aspect-video overflow-hidden bg-[var(--color-bg-2)]">
        {location.establishingAssetId ? (
          asset ? (
            <img src={mediaUrl(asset.thumb ?? asset.file)} alt={location.name} className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <Skeleton className="size-full" />
          )
        ) : (
          <div className="flex size-full items-center justify-center p-4 text-center" style={{ background: gradientFor(location.id) }}>
            <span className="font-serif text-lg text-white/80">{location.name}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium text-[var(--color-ink-0)]">{location.name}</div>
        <div className="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">{location.description || 'No description yet'}</div>
      </div>
    </div>
  );
}

export default function Locations() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: locations, isLoading } = useQuery({ queryKey: ['locations'], queryFn: api.locations });
  const [creating, setCreating] = useState(false);

  const createMut = useMutation({
    mutationFn: () => api.createLocation({ name: 'New Location', description: '' }),
    onMutate: () => setCreating(true),
    onSuccess: (loc) => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      navigate(`/locations/${loc.id}`);
    },
    onError: () => toast({ title: 'Failed to create location', variant: 'error' }),
    onSettled: () => setCreating(false),
  });

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-[var(--color-ink-0)]">Locations</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">Sets and their maps, establishing shots, and cached camera angles.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} loading={creating} onClick={() => createMut.mutate()}>
            New location
          </Button>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video w-full" />
            ))}
          </div>
        )}

        {!isLoading && (locations?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-hairline)] py-24 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-[var(--color-bg-2)] text-[var(--color-ink-2)]">
              <MapPin className="size-7" />
            </div>
            <h2 className="mt-4 font-serif text-lg text-[var(--color-ink-0)]">No locations yet</h2>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-2)]">
              Create your first set to sketch a map, generate an establishing shot, and render camera angles.
            </p>
            <Button variant="primary" className="mt-4" icon={<Plus className="size-4" />} loading={creating} onClick={() => createMut.mutate()}>
              New location
            </Button>
          </div>
        )}

        {!isLoading && (locations?.length ?? 0) > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {locations!.map((loc) => (
              <LocationCard key={loc.id} location={loc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../../lib/api';
import { toast, useJobsStore } from '../../lib/store';
import type { Character, ID, Location, Scene } from '@shared/types';
import { Button, Progress } from '../ui';
import { characterColor, initials } from './utils';

function CastMemberSheetStatus({ character, projectId }: { character: Character; projectId: string }) {
  const isProp = (character.kind ?? 'person') === 'prop';
  const hasTurnaround = Boolean(character.sheetAssets?.turnaround);
  const hasFace = isProp || Boolean(character.sheetAssets?.face);
  const jobs = useJobsStore((s) => s.jobs);
  const activeJob = Object.values(jobs).find(
    (j) => (j.type === 'character_turnaround' || j.type === 'character_face') && j.params.characterId === character.id && (j.status === 'queued' || j.status === 'running'),
  );

  const turnaround = useMutation({
    mutationFn: () => api.characterTurnaround(character.id),
    onSuccess: (job) => useJobsStore.getState().upsert(job),
    onError: (err) => toast({ title: 'Could not start turnaround', description: (err as Error).message, variant: 'error' }),
  });
  const face = useMutation({
    mutationFn: () => api.characterFace(character.id),
    onSuccess: (job) => useJobsStore.getState().upsert(job),
    onError: (err) => toast({ title: 'Could not start face close-up', description: (err as Error).message, variant: 'error' }),
  });

  if (hasTurnaround && hasFace) {
    return <span className="text-[11px] text-[var(--color-success)]">Turnaround ✓{!isProp && ' / Face ✓'}</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      {activeJob ? (
        <div className="w-20">
          <Progress value={activeJob.progress} />
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          icon={<Sparkles className="size-3.5" />}
          loading={turnaround.isPending || face.isPending}
          onClick={() => {
            if (!hasTurnaround) turnaround.mutate();
            if (!hasFace) face.mutate();
          }}
        >
          Generate missing sheets
        </Button>
      )}
      <span className="text-[11px] text-[var(--color-ink-3)]">
        {hasTurnaround ? 'Turnaround ✓' : 'Turnaround'} {!isProp && (hasFace ? '/ Face ✓' : '/ Face')}
      </span>
    </div>
  );
}

export function CastLocationStep({
  scene,
  characters,
  locations,
  projectId,
}: {
  scene: Scene;
  characters: Character[];
  locations: Location[];
  projectId: string;
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'project' });

  const patch = useMutation({
    mutationFn: (body: Partial<Scene>) => api.updateScene(scene.id, body),
    onSuccess: invalidate,
    onError: (err) => toast({ title: 'Could not save', description: (err as Error).message, variant: 'error' }),
  });

  const castIds = scene.castIds ?? [];
  const location = locations.find((l) => l.id === scene.locationId);

  function toggleCast(id: ID) {
    const next = castIds.includes(id) ? castIds.filter((c) => c !== id) : [...castIds, id];
    patch.mutate({ castIds: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--color-ink-2)]">Location</span>
        <select
          value={scene.locationId ?? ''}
          onChange={(e) => patch.mutate({ locationId: e.target.value || undefined })}
          className="h-9 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-sm text-[var(--color-ink-0)] outline-none"
        >
          <option value="">No location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <Link to="/locations" className="self-start text-xs text-[var(--color-amber-300)] hover:underline">
          New location
        </Link>
        {location && !location.establishingAssetId && (
          <p className="text-xs text-[var(--color-ink-2)]">
            This location has no establishing image yet —{' '}
            <Link to="/locations" className="text-[var(--color-amber-300)] hover:underline">
              add one
            </Link>
            .
          </p>
        )}
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--color-ink-2)]">Cast</span>
        <div className="flex flex-col gap-1.5">
          {characters.map((c, i) => {
            const active = castIds.includes(c.id);
            return (
              <div
                key={c.id}
                className={clsx(
                  'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5',
                  active ? 'border-[var(--color-amber-400)]/40 bg-[var(--color-amber-400)]/10' : 'border-[var(--color-hairline)]',
                )}
              >
                <button onClick={() => toggleCast(c.id)} className="flex flex-1 items-center gap-2 text-left">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-black" style={{ background: characterColor(c, i) }}>
                    {initials(c.name)}
                  </span>
                  <span className="text-sm text-[var(--color-ink-1)]">{c.name}</span>
                  <span className="rounded-full bg-[var(--color-bg-3)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-3)]">{c.kind === 'prop' ? 'prop' : 'person'}</span>
                </button>
                {active && <CastMemberSheetStatus character={c} projectId={projectId} />}
              </div>
            );
          })}
          {characters.length === 0 && <span className="text-xs text-[var(--color-ink-3)]">No characters or props in Cast yet.</span>}
        </div>
        <Link to="/cast" className="self-start text-xs text-[var(--color-amber-300)] hover:underline">
          New character
        </Link>
      </div>
    </div>
  );
}

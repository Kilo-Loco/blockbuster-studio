import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from '../../lib/store';
import type { BreakdownDraft, ID } from '@shared/types';
import { Dialog, Button } from '../ui';

export function BreakdownReview({
  open,
  onClose,
  draft,
  projectId,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  draft: BreakdownDraft;
  projectId: ID;
  onApplied?: () => void;
}) {
  const [included, setIncluded] = useState<boolean[]>(() => draft.scenes.map(() => true));
  const qc = useQueryClient();

  const totalShots = useMemo(() => draft.scenes.reduce((n, s) => n + s.shots.length, 0), [draft.scenes]);
  const includedShots = useMemo(
    () => draft.scenes.reduce((n, s, i) => (included[i] ? n + s.shots.length : n), 0),
    [draft.scenes, included],
  );

  const apply = useMutation({
    mutationFn: () => api.applyBreakdown(projectId, { ...draft, scenes: draft.scenes.filter((_, i) => included[i]) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      toast({ title: 'Breakdown applied', variant: 'success' });
      onClose();
      onApplied?.();
    },
    onError: (err) => toast({ title: 'Could not apply breakdown', description: (err as Error).message, variant: 'error' }),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Review breakdown" size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--color-ink-2)]">{draft.logline}</p>

        <div className="flex flex-wrap gap-4 text-xs text-[var(--color-ink-2)]">
          <span>{draft.characters.length} characters</span>
          <span>{draft.locations.length} locations</span>
          <span>
            {includedShots}/{totalShots} shots selected
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Characters</span>
          <div className="flex flex-wrap gap-1.5">
            {draft.characters.map((c) => (
              <span key={c.name} className="rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 py-1 text-xs text-[var(--color-ink-1)]">
                {c.name}
                {c.existingId && <span className="ml-1 text-[var(--color-ink-3)]">(existing)</span>}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Locations</span>
          <div className="flex flex-wrap gap-1.5">
            {draft.locations.map((l) => (
              <span key={l.name} className="rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 py-1 text-xs text-[var(--color-ink-1)]">
                {l.name}
                {l.existingId && <span className="ml-1 text-[var(--color-ink-3)]">(existing)</span>}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--color-ink-2)]">Scenes</span>
          {draft.scenes.map((scene, i) => (
            <label key={i} className="flex items-start gap-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-2)] p-3">
              <input
                type="checkbox"
                checked={included[i]}
                onChange={(e) => setIncluded((prev) => prev.map((v, idx) => (idx === i ? e.target.checked : v)))}
                className="mt-1 accent-[var(--color-amber-400)]"
              />
              <div className="min-w-0 flex-1">
                <p className="font-serif text-sm text-[var(--color-ink-0)]">{scene.title}</p>
                <p className="text-xs text-[var(--color-ink-2)]">
                  {scene.locationName} · {scene.timeOfDay} · {scene.shots.length} shots
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--color-ink-3)]">{scene.description}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={apply.isPending} disabled={!included.some(Boolean)} onClick={() => apply.mutate()}>
            Apply breakdown
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

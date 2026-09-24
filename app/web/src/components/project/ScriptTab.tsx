import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../../lib/store';
import type { BreakdownDraft, Project } from '@shared/types';
import { Button } from '../ui';
import { useDebouncedCallback } from './hooks';
import { BreakdownReview } from './BreakdownReview';

export function ScriptTab({ project, onApplied }: { project: Project; onApplied: () => void }) {
  const [script, setScript] = useState(project.script);
  const [draft, setDraft] = useState<BreakdownDraft | null>(null);

  useEffect(() => setScript(project.script), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system });

  const saveScript = useMutation({ mutationFn: (s: string) => api.updateProject(project.id, { script: s }) });
  const debouncedSave = useDebouncedCallback((s: string) => saveScript.mutate(s), 800);

  const breakdown = useMutation({
    mutationFn: () => api.breakdown(project.id, script),
    onSuccess: (d) => setDraft(d),
    onError: (err) => toast({ title: 'Breakdown failed', description: (err as Error).message, variant: 'error' }),
  });

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 px-6 py-6">
      {system && !system.llmConfigured ? (
        <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4 text-sm text-[var(--color-ink-2)]">
          Connect an LLM in{' '}
          <Link to="/settings" className="text-[var(--color-amber-300)] hover:underline">
            Settings
          </Link>{' '}
          to auto-break-down scripts. You can still build the storyboard manually.
        </div>
      ) : (
        <div className="flex justify-end">
          <Button variant="primary" icon={<Wand2 className="size-4" />} loading={breakdown.isPending} disabled={!script.trim()} onClick={() => breakdown.mutate()}>
            Break down with AI
          </Button>
        </div>
      )}

      <textarea
        value={script}
        onChange={(e) => {
          setScript(e.target.value);
          debouncedSave(e.target.value);
        }}
        placeholder="Write your idea, treatment, or full screenplay here…"
        className="min-h-[50vh] flex-1 resize-none rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4 font-mono text-sm leading-relaxed text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
      />

      {draft && (
        <BreakdownReview
          open
          onClose={() => setDraft(null)}
          draft={draft}
          projectId={project.id}
          onApplied={onApplied}
        />
      )}
    </div>
  );
}

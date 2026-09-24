import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, RotateCw, Ban } from 'lucide-react';
import { api } from '../lib/api';
import { useUIStore } from '../lib/store';
import { toast } from '../lib/store';
import { IconButton, Progress } from './ui';
import type { Job } from '@shared/types';
import { clsx } from 'clsx';

export function QueueDrawer() {
  const { queueOpen, setQueueOpen } = useUIStore();
  const qc = useQueryClient();
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs', 'all'], queryFn: () => api.jobs({ limit: 100 }), refetchInterval: 5000 });

  if (!queueOpen) return null;

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const recent = jobs.filter((j) => j.status !== 'queued' && j.status !== 'running').slice(0, 20);

  async function cancel(id: string) {
    try {
      await api.cancelJob(id);
      qc.invalidateQueries({ queryKey: ['jobs'] });
    } catch {
      toast({ title: 'Could not cancel job', variant: 'error' });
    }
  }
  async function retry(id: string) {
    try {
      await api.retryJob(id);
      qc.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: 'Job re-queued', variant: 'success' });
    } catch {
      toast({ title: 'Could not retry job', variant: 'error' });
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-label="Queue">
      <div className="absolute inset-0 bg-black/50" onClick={() => setQueueOpen(false)} />
      <div className="relative flex h-full w-[380px] max-w-full flex-col border-l border-[var(--color-hairline)] bg-[var(--color-bg-1)] shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-3">
          <h2 className="font-serif text-lg">Queue</h2>
          <IconButton icon={<X className="size-4" />} label="Close" onClick={() => setQueueOpen(false)} />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-3)]">Active</h3>
            {active.length === 0 && <p className="text-sm text-[var(--color-ink-2)]">Nothing running.</p>}
            <div className="flex flex-col gap-2">
              {active.map((j) => (
                <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />
              ))}
            </div>
          </section>
          <section className="mt-6">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-3)]">Recent</h3>
            <div className="flex flex-col gap-2">
              {recent.map((j) => (
                <JobRow key={j.id} job={j} onRetry={j.status === 'error' ? () => retry(j.id) : undefined} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, onCancel, onRetry }: { job: Job; onCancel?: () => void; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm text-[var(--color-ink-0)]">{job.title}</p>
        <span
          className={clsx(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase',
            job.status === 'error' && 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]',
            job.status === 'done' && 'bg-[var(--color-success)]/15 text-[var(--color-success)]',
            (job.status === 'queued' || job.status === 'running') && 'bg-[var(--color-amber-400)]/15 text-[var(--color-amber-400)]',
            job.status === 'canceled' && 'bg-white/10 text-[var(--color-ink-2)]',
          )}
        >
          {job.status}
        </span>
      </div>
      {job.stage && <p className="mt-1 text-xs text-[var(--color-ink-2)]">{job.stage}</p>}
      {(job.status === 'running' || job.status === 'queued') && <Progress value={job.progress} className="mt-2" />}
      {job.error && <p className="mt-1 text-xs text-[var(--color-danger)]">{job.error}</p>}
      <div className="mt-2 flex gap-2">
        {onCancel && (
          <button onClick={onCancel} className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-2)] hover:text-[var(--color-danger)]">
            <Ban className="size-3" /> Cancel
          </button>
        )}
        {onRetry && (
          <button onClick={onRetry} className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-2)] hover:text-[var(--color-amber-400)]">
            <RotateCw className="size-3" /> Retry
          </button>
        )}
      </div>
    </div>
  );
}

// Settings section: how long this pod took to reach each setup step, and a one-click download of its logs
// (for bug reports and for our own timed tests). Local only — nothing here is sent anywhere.
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../lib/api';
import { Skeleton } from './ui';
import type { Milestones } from '@shared/types';

const LABELS: { key: keyof Milestones; label: string }[] = [
  { key: 'studioReadyAt', label: 'Studio ready' },
  { key: 'videoModelsReadyAt', label: 'Video ready' },
  { key: 'hfTokenSavedAt', label: 'Hugging Face token saved' },
  { key: 'firstImageAt', label: 'First image' },
  { key: 'firstVideoQueuedAt', label: 'First video queued' },
  { key: 'firstVideoAt', label: 'First video' },
  { key: 'firstPrevisShotAt', label: 'First previs shot' },
  { key: 'firstExportAt', label: 'First export' },
];

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

export function Diagnostics() {
  const { data } = useQuery({ queryKey: ['diagnostics'], queryFn: api.diagnostics, refetchInterval: 10_000 });
  const rows = data ? LABELS.filter(({ key }) => data.durations[key] != null) : [];

  return (
    <section className="space-y-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
      <h2 className="font-serif text-lg text-[var(--color-ink-0)]">Setup and logs</h2>
      {!data && <Skeleton className="h-16 w-full" />}
      {data && rows.length === 0 && <p className="text-sm text-[var(--color-ink-2)]">Nothing recorded yet.</p>}
      {rows.length > 0 && (
        <ul className="space-y-1 text-sm text-[var(--color-ink-1)]">
          {rows.map(({ key, label }) => (
            <li key={key} className="flex items-center justify-between">
              <span>{label}</span>
              <span className="chip-mono text-[var(--color-ink-2)]">{formatDuration(data!.durations[key]!)}</span>
            </li>
          ))}
        </ul>
      )}
      <a
        href={api.diagnosticsLogsUrl}
        download
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 text-[13px] font-medium text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-bg-3)]"
      >
        <Download className="size-3.5" />
        Download logs
      </a>
      <p className="text-[11px] text-[var(--color-ink-3)]">Send this file with a bug report. It has no passwords or keys.</p>
    </section>
  );
}

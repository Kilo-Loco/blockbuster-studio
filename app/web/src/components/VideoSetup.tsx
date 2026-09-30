import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/store';
import { Dialog, Progress } from './ui';
import { GatedTokenField } from './GatedTokenField';
import { useEngineState } from '../hooks/useEngineState';
import type { ModelGroupId, ModelGroupStatus } from '@shared/types';

const GATED_RE = /^(\S+\/\S+) is gated/;

/** The gated Hugging Face repo a model group's download error names, if any. Shared with AppShell so the
 *  banner and this dialog agree on what counts as "gated". */
export function gatedRepoFor(group: ModelGroupStatus): string | undefined {
  return group.error ? GATED_RE.exec(group.error)?.[1] : undefined;
}

/** Walks the user through unblocking a gated video model: accept the repo's terms, make a read token, paste
 *  it in, then watch the download finish. Opened from the AppShell banner, or automatically once per browser
 *  the first time a video group turns out to be gated. */
export function VideoSetup({ open, onClose, groupIds }: { open: boolean; onClose: () => void; groupIds: ModelGroupId[] }) {
  const qc = useQueryClient();
  const { system } = useEngineState();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const groups = (system?.models ?? []).filter((g) => groupIds.includes(g.id));
  const repos = Array.from(new Set(groups.map(gatedRepoFor).filter((r): r is string => !!r)));
  const allReady = groups.length > 0 && groups.every((g) => g.ready);

  const saveMut = useMutation({
    mutationFn: (hfToken: string) => api.updateSettings({ hfToken }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      toast({ title: 'Token saved', variant: 'success' });
    },
    onError: () => toast({ title: 'Failed to save the token', variant: 'error' }),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Set up video" size="sm">
      <div className="space-y-5">
        <p className="text-sm text-[var(--color-ink-2)]">Video needs a free Hugging Face account and a read token. This only takes a minute.</p>

        <div>
          <div className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">1. Accept the terms</div>
          <div className="flex flex-col items-start gap-1">
            {(repos.length > 0 ? repos : ['…']).map((repo) => (
              <a
                key={repo}
                href={`https://huggingface.co/${repo}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-[var(--color-amber-400)] hover:underline"
              >
                huggingface.co/{repo}
                <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">2. Create a read token</div>
          <a
            href="https://huggingface.co/settings/tokens"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-amber-400)] hover:underline"
          >
            huggingface.co/settings/tokens
            <ExternalLink className="size-3" />
          </a>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">3. Paste it here</div>
          <GatedTokenField saved={!!settings?.hfTokenSet} onSave={(hfToken) => saveMut.mutate(hfToken)} stepsAbove />
        </div>

        {groups.length > 0 && !allReady && (
          <div className="space-y-2 border-t border-[var(--color-hairline)] pt-4">
            {groups.map((g) => {
              const pct = g.totalBytes ? g.downloadedBytes / g.totalBytes : 0;
              return (
                <div key={g.id}>
                  <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-ink-2)]">
                    <span>{g.label}</span>
                    <span>{g.ready ? 'Ready' : `${(pct * 100).toFixed(0)}%`}</span>
                  </div>
                  <Progress value={g.ready ? 1 : pct} />
                </div>
              );
            })}
          </div>
        )}

        {allReady && (
          <p className="rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-3 py-2 text-sm text-[var(--color-success)]">
            Video is ready.
          </p>
        )}
      </div>
    </Dialog>
  );
}

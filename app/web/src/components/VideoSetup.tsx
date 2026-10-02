import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/store';
import { Dialog, Progress } from './ui';
import { GatedTokenField } from './GatedTokenField';
import { useEngineState } from '../hooks/useEngineState';
import type { GatedRefusal, ModelGroupId, ModelGroupStatus } from '@shared/types';

const GATED_RE = /^(\S+\/\S+) is gated/;

/** The gated Hugging Face repo a model group's download error names, if any. Shared with AppShell and Settings
 *  so the banner, this dialog and the Models list agree on what counts as "gated". The regex covers status
 *  files written by an older downloader without the structured `gated` entry. */
export function gatedRepoFor(group: ModelGroupStatus): string | undefined {
  return group.gated?.repo ?? (group.error ? GATED_RE.exec(group.error)?.[1] : undefined);
}

/** One-line banner text for a gated download, by why Hugging Face refused it. */
export function gatedHeadline(refusals: GatedRefusal[], tokenSet: boolean): string {
  if (refusals.some((r) => r.reason === 'bad_token')) return 'Hugging Face rejected the saved token.';
  const refused = refusals.find((r) => r.reason === 'no_access');
  if (refused) return `Hugging Face refused ${refused.file.split('/').pop()} for your token.`;
  return tokenSet ? 'Video is still waiting on Hugging Face.' : 'Video needs a free Hugging Face token.';
}

/** What Hugging Face said, with the fix for that case: which file and repo, and which account the token is for. */
function RefusalDetail({ refusal }: { refusal: GatedRefusal }) {
  const terms = `https://huggingface.co/${refusal.repo}`;
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2.5 text-xs text-[var(--color-ink-1)]">
      {refusal.reason === 'bad_token' ? (
        <p>
          Hugging Face rejected the saved token itself{refusal.status ? ` (HTTP ${refusal.status})` : ''}. It may be mistyped, revoked or
          expired. Create a new <strong>Read</strong> token and save it below.
        </p>
      ) : (
        <>
          <p>
            Hugging Face refused <span className="chip-mono break-all">{refusal.file}</span> from{' '}
            <a href={terms} target="_blank" rel="noreferrer" className="text-[var(--color-amber-400)] hover:underline">
              {refusal.repo}
            </a>
            {refusal.account ? (
              <>
                {' '}
                for <strong>@{refusal.account}</strong>
              </>
            ) : null}
            {refusal.status ? ` (HTTP ${refusal.status})` : ''}.
          </p>
          <p>
            Open the repo while signed in as {refusal.account ? `@${refusal.account}` : 'the token\'s account'} and accept its terms.
            Accepting the terms of an older LTX repo doesn&apos;t cover this one.
          </p>
          <p>
            {refusal.tokenRole === 'fineGrained' ? 'This is a fine-grained token: e' : 'If it\'s a fine-grained token, e'}dit it and turn on{' '}
            <em>Read access to contents of all public gated repos you can access</em>, or use a plain <strong>Read</strong> token.
          </p>
        </>
      )}
    </div>
  );
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
  // Only once a token is saved: before that, the steps below are the whole story.
  const refusals = settings?.hfTokenSet ? groups.flatMap((g) => (g.gated && g.gated.reason !== 'no_token' ? [g.gated] : [])) : [];
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
        {refusals.length > 0 ? (
          <div className="space-y-2">
            {refusals.map((r) => (
              <RefusalDetail key={`${r.repo}/${r.file}`} refusal={r} />
            ))}
            <p className="text-xs text-[var(--color-ink-3)]">
              Fixed it? Click <strong>Retry now</strong> below, or paste a new token. Files that already downloaded are kept.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-ink-2)]">Video needs a free Hugging Face account and a read token. This only takes a minute.</p>
        )}

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

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CircleHelp, Copy, LogOut, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/store';
import { Button, Progress, Segmented, Skeleton } from '../components/ui';
import { ASPECTS } from '@shared/presets';
import type { AspectRatio, LlmProvider, SettingsUpdate, VideoQuality } from '@shared/types';
import { useEngineState } from '../hooks/useEngineState';
import { DOCS_URL } from '../lib/links';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-ink-2)]">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">{hint}</p>}
    </div>
  );
}

function textInputClass() {
  return 'w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50';
}

function SecretField({
  label,
  isSet,
  onSave,
  onClear,
}: {
  label: string;
  isSet: boolean;
  onSave: (value: string) => void;
  onClear: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (value) {
              onSave(value);
              setValue('');
            }
          }}
          placeholder={isSet ? '••••• set — enter a new value to replace' : 'Not set'}
          className={textInputClass()}
        />
        {isSet && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </Field>
  );
}

/** Right on a download waiting for a gated repo: the Hugging Face token it needs, with an explicit Save. The
 *  downloader picks a saved token up within ~15 s (docker/download_models.py), so no restart is needed. */
function GatedTokenField({ saved, onSave }: { saved: boolean; onSave: (token: string) => void }) {
  const [value, setValue] = useState('');
  const save = () => {
    if (!value.trim()) return;
    onSave(value.trim());
    setValue('');
  };
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={saved ? 'Token saved; paste a new one to replace it' : 'Hugging Face token (hf_…)'}
          className={textInputClass()}
        />
        <Button size="sm" variant="primary" disabled={!value.trim()} onClick={save}>
          Save
        </Button>
      </div>
      <p className="text-[11px] text-[var(--color-ink-3)]">
        {saved
          ? 'Token saved. If the download still waits, check that this account accepted the terms; it retries every few minutes.'
          : 'Create a read token at huggingface.co/settings/tokens with the account that accepted the terms. The download starts within a few seconds of saving.'}
      </p>
    </div>
  );
}

/** How an AI agent (Claude Code or any MCP client) connects. The token is only readable on the pod itself. */
function AgentAccessSection() {
  const { data: access } = useQuery({ queryKey: ['agent-access'], queryFn: api.agentAccess });
  const rotate = useMutation({
    mutationFn: () => api.rotateAgentToken(),
    onSuccess: () => toast({ title: 'New agent token', description: 'Agents using the old one are signed out. Read the new one from the pod.', variant: 'success' }),
    onError: (err) => toast({ title: 'Could not rotate the token', description: err instanceof Error ? err.message : undefined, variant: 'error' }),
  });
  const command = `claude mcp add --transport http blockbuster ${window.location.origin}/mcp --header "Authorization: Bearer <token>"`;
  const code = 'block whitespace-pre-wrap break-all rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 font-mono text-xs text-[var(--color-ink-1)]';
  if (!access) return null;
  return (
    <section className="space-y-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
      <h2 className="flex items-center gap-2 font-serif text-lg text-[var(--color-ink-0)]">
        <Bot className="size-4 text-[var(--color-ink-2)]" />
        Agent access
      </h2>
      {access.source === 'off' ? (
        <p className="text-sm text-[var(--color-ink-2)]">Off. This pod was started with AGENT_ACCESS=false, so agents can't sign in.</p>
      ) : (
        <>
          <p className="text-sm text-[var(--color-ink-2)]">
            An AI agent such as Claude Code can make films here on its own: write the storyboard, render, review each shot and export. It signs in with the
            agent token instead of your password. Anyone with the token can use the studio, so keep it private.
          </p>
          <Field label="1. Get the token">
            {access.source === 'env' ? (
              <p className="text-sm text-[var(--color-ink-2)]">It's the STUDIO_AGENT_TOKEN secret you set on this pod in Runpod.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-[var(--color-ink-2)]">In Runpod, open this pod's web terminal (Connect → Start Web Terminal) and run:</p>
                <code className={code}>cat {access.path}</code>
              </>
            )}
          </Field>
          <Field label="2. Connect Claude Code" hint="Replace <token> with the token. Other MCP clients use the same URL and header.">
            <div className="flex items-start gap-2">
              <code className={`${code} min-w-0 flex-1`}>{command}</code>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy className="size-3.5" />}
                onClick={() => navigator.clipboard.writeText(command).then(() => toast({ title: 'Copied', variant: 'success' }))}
              >
                Copy
              </Button>
            </div>
          </Field>
          {access.source === 'file' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className="size-3.5" />}
              loading={rotate.isPending}
              onClick={() => {
                if (window.confirm('Make a new agent token? Agents using the current one stop working until you give them the new one.')) rotate.mutate();
              }}
            >
              New token
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { system } = useEngineState();
  const enabledModels = system?.models.filter((m) => m.enabled) ?? [];
  // MiniMax H3 and LTX-2.5 replace the Wan video groups (and are opt-in alternatives to each other), so
  // those being off isn't a preset limitation.
  const optInVideoOn = !!system?.models.some((m) => (m.id === 'minimax' || m.id === 'ltx') && m.enabled);
  const replacedByOptIn = new Set(optInVideoOn ? ['video', 't2v', 'minimax', 'ltx'] : ['minimax', 'ltx']);
  const hasDisabledModels = !!system && system.models.some((m) => !m.enabled && !replacedByOptIn.has(m.id));

  const [anthropicModel, setAnthropicModel] = useState('');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [openaiModel, setOpenaiModel] = useState('');

  useEffect(() => {
    if (settings) {
      setAnthropicModel(settings.anthropicModel);
      setOpenaiBaseUrl(settings.openaiBaseUrl);
      setOpenaiModel(settings.openaiModel);
    }
  }, [settings?.llmProvider]);

  const updateMut = useMutation({
    mutationFn: (body: SettingsUpdate) => api.updateSettings(body),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      toast({ title: 'Saved', variant: 'success' });
    },
    onError: () => toast({ title: 'Failed to save settings', variant: 'error' }),
  });

  const logoutMut = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => navigate('/login'),
  });

  if (isLoading || !settings) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-8 pb-10">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl text-[var(--color-ink-0)]">Settings</h1>
          <div className="flex items-center gap-1">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-[var(--color-ink-1)] transition-colors hover:bg-white/6 hover:text-[var(--color-ink-0)]"
            >
              <CircleHelp className="size-3.5" />
              Help
            </a>
            <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} loading={logoutMut.isPending} onClick={() => logoutMut.mutate()}>
              Sign out
            </Button>
          </div>
        </div>

        <section className="space-y-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
          <h2 className="font-serif text-lg text-[var(--color-ink-0)]">LLM provider</h2>
          <Segmented
            options={[
              { value: 'none', label: 'None' },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'openai_compatible', label: 'OpenAI-compatible' },
            ]}
            value={settings.llmProvider}
            onChange={(v: LlmProvider) => updateMut.mutate({ llmProvider: v })}
          />

          {settings.llmProvider === 'anthropic' && (
            <div className="space-y-3 border-t border-[var(--color-hairline)] pt-3">
              <Field label="Model">
                <input
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value)}
                  onBlur={() => anthropicModel !== settings.anthropicModel && updateMut.mutate({ anthropicModel })}
                  placeholder="claude-sonnet-5"
                  className={textInputClass()}
                />
              </Field>
              <SecretField
                label="API key"
                isSet={settings.anthropicApiKeySet}
                onSave={(v) => updateMut.mutate({ anthropicApiKey: v })}
                onClear={() => updateMut.mutate({ anthropicApiKey: '' })}
              />
            </div>
          )}

          {settings.llmProvider === 'openai_compatible' && (
            <div className="space-y-3 border-t border-[var(--color-hairline)] pt-3">
              <Field label="Base URL">
                <input
                  value={openaiBaseUrl}
                  onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                  onBlur={() => openaiBaseUrl !== settings.openaiBaseUrl && updateMut.mutate({ openaiBaseUrl })}
                  placeholder="https://openrouter.ai/api/v1"
                  className={textInputClass()}
                />
              </Field>
              <Field label="Model">
                <input
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  onBlur={() => openaiModel !== settings.openaiModel && updateMut.mutate({ openaiModel })}
                  className={textInputClass()}
                />
              </Field>
              <SecretField
                label="API key"
                isSet={settings.openaiApiKeySet}
                onSave={(v) => updateMut.mutate({ openaiApiKey: v })}
                onClear={() => updateMut.mutate({ openaiApiKey: '' })}
              />
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
          <h2 className="font-serif text-lg text-[var(--color-ink-0)]">Download tokens</h2>
          <SecretField
            label="Civitai token"
            isSet={settings.civitaiTokenSet}
            onSave={(v) => updateMut.mutate({ civitaiToken: v })}
            onClear={() => updateMut.mutate({ civitaiToken: '' })}
          />
          <SecretField
            label="Hugging Face token"
            isSet={settings.hfTokenSet}
            onSave={(v) => updateMut.mutate({ hfToken: v })}
            onClear={() => updateMut.mutate({ hfToken: '' })}
          />
        </section>

        <AgentAccessSection />

        <section className="space-y-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
          <h2 className="font-serif text-lg text-[var(--color-ink-0)]">Defaults</h2>
          <Field label="Default aspect ratio">
            <Segmented
              size="sm"
              options={ASPECTS.map((a) => ({ value: a, label: a }))}
              value={settings.defaultAspect}
              onChange={(v: AspectRatio) => updateMut.mutate({ defaultAspect: v })}
            />
          </Field>
          <Field label="Default video quality">
            <Segmented
              size="sm"
              options={[
                { value: 'fast', label: 'Fast' },
                { value: 'hd', label: 'HD' },
              ]}
              value={settings.defaultVideoQuality}
              onChange={(v: VideoQuality) => updateMut.mutate({ defaultVideoQuality: v })}
            />
          </Field>
        </section>

        <section className="space-y-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
          <h2 className="font-serif text-lg text-[var(--color-ink-0)]">Models</h2>
          {hasDisabledModels && (
            <p className="text-[11px] text-[var(--color-ink-3)]">
              These models were turned off for this pod. To turn one on, set its DOWNLOAD_*_MODELS variable to true in Runpod
              (Edit Pod) and restart; the download starts on the next boot.
            </p>
          )}
          <div className="space-y-3">
            {system && enabledModels.length === 0 && <p className="text-sm text-[var(--color-ink-2)]">No model status reported yet.</p>}
            {enabledModels.map((m) => {
              const pct = m.totalBytes ? m.downloadedBytes / m.totalBytes : m.ready ? 1 : 0;
              return (
                <div key={m.id} className="rounded-lg border border-[var(--color-hairline)] px-3 py-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--color-ink-0)]">{m.label}</span>
                    <span className={m.ready ? 'text-[var(--color-success)]' : 'text-[var(--color-amber-400)]'}>{m.ready ? 'Ready' : m.enabled ? 'Downloading' : 'Not enabled'}</span>
                  </div>
                  {m.id === 'minimax' && (
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-3)]">
                      Powered by MiniMax H3. Replaces Wan for Video, Animate and storyboard clips, with sound (Perform still uses Wan Animate).
                      Its{' '}
                      <a className="underline" href="https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE" target="_blank" rel="noreferrer">
                        community license
                      </a>{' '}
                      excludes the US, EU, UK and South Korea unless you get a license from MiniMax.
                    </p>
                  )}
                  {m.id === 'ltx' && (
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-3)]">
                      LTX-2.5 by Lightricks. Replaces Wan for Video, Animate and storyboard clips, with sound and spoken dialogue
                      (Perform still uses Wan Animate). Its{' '}
                      <a className="underline" href="https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x" target="_blank" rel="noreferrer">
                        community license
                      </a>{' '}
                      is free under $10M annual revenue, but needs a separate license from Lightricks for products that compete with
                      theirs, and videos you publish must be disclosed as AI-generated.
                    </p>
                  )}
                  {!m.ready && m.enabled && (
                    <div className="mt-1.5">
                      <Progress value={pct} />
                      <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--color-ink-3)]">
                        <span className="truncate">{m.currentFile ?? ''}</span>
                        <span>
                          {(m.downloadedBytes / 1e9).toFixed(1)}/{(m.totalBytes / 1e9).toFixed(1)} GB
                        </span>
                      </div>
                    </div>
                  )}
                  {m.error && <div className="mt-1 text-[11px] text-[var(--color-danger)]">{m.error}</div>}
                  {m.error && /is gated/.test(m.error) && (
                    <GatedTokenField saved={settings.hfTokenSet} onSave={(hfToken) => updateMut.mutate({ hfToken })} />
                  )}
                </div>
              );
            })}
            {!system && <Skeleton className="h-16 w-full" />}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)] p-4">
          <h2 className="font-serif text-lg text-[var(--color-ink-0)]">Disk</h2>
          {system ? (
            <div>
              <Progress value={1 - system.disk.freeBytes / system.disk.totalBytes} />
              <p className="mt-1.5 text-xs text-[var(--color-ink-2)]">
                {(system.disk.freeBytes / 1e9).toFixed(1)} GB free of {(system.disk.totalBytes / 1e9).toFixed(1)} GB
              </p>
            </div>
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
        </section>

        <div className="flex items-center justify-between text-xs text-[var(--color-ink-3)]">
          <span>Blockbuster Studio</span>
          <span className="chip-mono">{system?.version ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}

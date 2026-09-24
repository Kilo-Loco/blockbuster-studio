import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/store';
import { Button, Progress, Segmented, Skeleton } from '../components/ui';
import { ASPECTS } from '@shared/presets';
import type { AspectRatio, LlmProvider, SettingsUpdate, VideoQuality } from '@shared/types';

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

export default function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system, refetchInterval: 10_000 });

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
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8 pb-10">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl text-[var(--color-ink-0)]">Settings</h1>
          <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} loading={logoutMut.isPending} onClick={() => logoutMut.mutate()}>
            Sign out
          </Button>
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
          <div className="space-y-3">
            {system && system.models.length === 0 && <p className="text-sm text-[var(--color-ink-2)]">No model status reported yet.</p>}
            {system?.models.map((m) => {
              const pct = m.totalBytes ? m.downloadedBytes / m.totalBytes : m.ready ? 1 : 0;
              return (
                <div key={m.id} className="rounded-lg border border-[var(--color-hairline)] px-3 py-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--color-ink-0)]">{m.label}</span>
                    <span className={m.ready ? 'text-[var(--color-success)]' : 'text-[var(--color-amber-400)]'}>{m.ready ? 'Ready' : m.enabled ? 'Downloading' : 'Not enabled'}</span>
                  </div>
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

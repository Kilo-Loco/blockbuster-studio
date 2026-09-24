// Central settings resolution: DB-stored values (via `kv`) override env fallbacks from config.ts.
// Secrets (API keys/tokens) are stored in the same `kv` row as the rest of Settings but are never
// serialized back to the client — see `publicSettings()`.
import { kv } from './db';
import {
  ANTHROPIC_API_KEY,
  CIVITAI_TOKEN,
  HF_TOKEN,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
} from './config';
import type { Settings, SettingsUpdate } from '../shared/types';

const KEY = 'settings';

export type StoredSettings = Partial<Settings> & {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  civitaiToken?: string;
  hfToken?: string;
};

export function getStoredSettings(): StoredSettings {
  return kv.get<StoredSettings>(KEY) ?? {};
}

export function publicSettings(): Settings {
  const s = getStoredSettings();
  return {
    llmProvider: s.llmProvider ?? (ANTHROPIC_API_KEY ? 'anthropic' : OPENAI_API_KEY ? 'openai_compatible' : 'none'),
    anthropicModel: s.anthropicModel || 'claude-sonnet-5',
    openaiBaseUrl: s.openaiBaseUrl || OPENAI_BASE_URL || '',
    openaiModel: s.openaiModel || OPENAI_MODEL || '',
    anthropicApiKeySet: Boolean(s.anthropicApiKey || ANTHROPIC_API_KEY),
    openaiApiKeySet: Boolean(s.openaiApiKey || OPENAI_API_KEY),
    civitaiTokenSet: Boolean(s.civitaiToken || CIVITAI_TOKEN),
    hfTokenSet: Boolean(s.hfToken || HF_TOKEN),
    defaultAspect: s.defaultAspect ?? '16:9',
    defaultVideoQuality: s.defaultVideoQuality ?? 'fast',
  };
}

export function updateSettings(update: SettingsUpdate): Settings {
  const cur = getStoredSettings();
  const next: StoredSettings = { ...cur };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if ((key === 'anthropicApiKey' || key === 'openaiApiKey' || key === 'civitaiToken' || key === 'hfToken') && value === '') {
      delete (next as Record<string, unknown>)[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  kv.set(KEY, next);
  return publicSettings();
}

/** Resolve the effective Civitai token (DB override > env fallback). */
export function resolveCivitaiToken(): string | undefined {
  return getStoredSettings().civitaiToken || CIVITAI_TOKEN;
}

/** Resolve the effective Hugging Face token (DB override > env fallback). */
export function resolveHfToken(): string | undefined {
  return getStoredSettings().hfToken || HF_TOKEN;
}

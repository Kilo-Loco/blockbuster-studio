// Thin LLM abstraction used by server/ai/breakdown.ts (and any future AI routes).
//
// Resolves provider config from stored Settings (DB, via `kv`) with env fallbacks from
// server/config.ts, then makes a single "give me back structured JSON" call — either via the
// Anthropic SDK's tool-use mechanism, or via an OpenAI-compatible chat/completions endpoint
// using `response_format: json_object`. Callers get back `unknown` and are expected to validate
// with their own schema (see breakdown.ts's zod usage) since the model's output is not trusted.

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL } from '../config';
import { kv } from '../db';
import type { Settings } from '../../shared/types';

export interface LlmConfig {
  provider: 'anthropic' | 'openai_compatible';
  anthropicApiKey?: string;
  anthropicModel?: string; // default 'claude-sonnet-5'
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
}

// Settings as stored in `kv` — non-secret fields shaped like `Settings`, plus the write-only
// secret values that never leave the server (the `Settings` type only exposes *Set booleans).
type StoredSettings = Partial<Settings> & {
  anthropicApiKey?: string;
  openaiApiKey?: string;
};

/**
 * Resolve the active LLM config: DB-stored settings (via `kv.get('settings')`) override env
 * fallbacks from config.ts. Returns undefined when no usable provider is configured — either
 * `llmProvider` is 'none'/unset, or the provider's required credential is missing.
 */
export function resolveLlmConfig(): LlmConfig | undefined {
  const stored = kv.get<StoredSettings>('settings');
  const provider = stored?.llmProvider ?? (ANTHROPIC_API_KEY ? 'anthropic' : OPENAI_API_KEY ? 'openai_compatible' : 'none');

  if (provider === 'anthropic') {
    const anthropicApiKey = stored?.anthropicApiKey || ANTHROPIC_API_KEY;
    if (!anthropicApiKey) return undefined;
    return {
      provider: 'anthropic',
      anthropicApiKey,
      anthropicModel: stored?.anthropicModel || 'claude-sonnet-5',
    };
  }

  if (provider === 'openai_compatible') {
    const openaiApiKey = stored?.openaiApiKey || OPENAI_API_KEY;
    const openaiBaseUrl = stored?.openaiBaseUrl || OPENAI_BASE_URL;
    const openaiModel = stored?.openaiModel || OPENAI_MODEL;
    if (!openaiApiKey || !openaiBaseUrl || !openaiModel) return undefined;
    return { provider: 'openai_compatible', openaiApiKey, openaiBaseUrl, openaiModel };
  }

  return undefined;
}

export function isLlmConfigured(): boolean {
  return resolveLlmConfig() !== undefined;
}

export interface CallLlmForJsonOpts {
  system: string;
  user: string;
  toolName: string; // e.g. 'submit_breakdown' or 'submit_enhancement'
  toolDescription: string;
  schema: Record<string, unknown>; // JSON-schema-ish object for the tool input_schema / response_format hint
}

/** Low-level "call the configured LLM and get back one JSON object" helper. Throws on failure. */
export async function callLlmForJson<T = unknown>(opts: CallLlmForJsonOpts): Promise<T> {
  const cfg = resolveLlmConfig();
  if (!cfg) {
    throw new Error('LLM not configured');
  }

  if (cfg.provider === 'anthropic') {
    return callAnthropic<T>(cfg, opts);
  }
  return callOpenAiCompatible<T>(cfg, opts);
}

async function callAnthropic<T>(cfg: LlmConfig, opts: CallLlmForJsonOpts): Promise<T> {
  const client = new Anthropic({ apiKey: cfg.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: cfg.anthropicModel || 'claude-sonnet-5',
      max_tokens: 16000,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: opts.schema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: opts.toolName },
    });
  } catch (err) {
    throw new Error(`Anthropic API request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === opts.toolName,
  );
  if (!toolUse) {
    throw new Error('Anthropic response did not include the expected tool call');
  }
  return toolUse.input as T;
}

async function callOpenAiCompatible<T>(cfg: LlmConfig, opts: CallLlmForJsonOpts): Promise<T> {
  const baseUrl = (cfg.openaiBaseUrl ?? '').replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.openaiModel,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${opts.system}\n\nRespond with a single JSON object matching this schema:\n${JSON.stringify(opts.schema)}`,
          },
          { role: 'user', content: opts.user },
        ],
      }),
    });
  } catch (err) {
    throw new Error(`OpenAI-compatible API request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible API returned ${res.status}: ${bodyText.slice(0, 500)}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('OpenAI-compatible API returned a non-JSON response body');
  }

  const content = (body as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI-compatible API response was missing choices[0].message.content');
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error('OpenAI-compatible API response content was not valid JSON');
  }
}

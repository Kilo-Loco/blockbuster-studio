// Client for the Qwen3-TTS voice sidecar (docker/tts/server.py, or dev/mock-tts.ts in development).
// The sidecar shares the filesystem: it reads reference clips and writes rendered WAVs by path.
import { TTS_URL } from '../config';

export interface TtsAudio {
  /** WAV written by the sidecar (24 kHz mono). */
  file: string;
  sampleRate: number;
  durationSec: number;
}

export interface TtsHealth {
  ok: boolean;
  /** Model name → its files are downloaded. */
  models: Record<string, boolean>;
  loaded: string[];
}

/** Generous: the first request after boot loads a 1.7B model from disk. */
const GENERATE_TIMEOUT_MS = 5 * 60_000;

export class TtsClient {
  constructor(private readonly baseUrl: string) {}

  private async post<T>(route: string, body: unknown, timeoutMs = GENERATE_TIMEOUT_MS): Promise<T> {
    const res = await fetch(`${this.baseUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(`Voice engine: ${json.error ?? `HTTP ${res.status}`}`);
    return json as T;
  }

  /** A new voice from a description, speaking `text` (used as the voice's reference clip). */
  design(p: { text: string; instruct: string; language: string }): Promise<TtsAudio> {
    return this.post('/design', p);
  }

  /** `text` in the voice of the reference clip. Without `refText` the clone uses the speaker embedding only. */
  clone(p: { text: string; language: string; refAudio: string; refText?: string }): Promise<TtsAudio> {
    return this.post('/clone', p);
  }

  /** Free the GPU (before ComfyUI work). Never throws: a sidecar that is down holds no memory. */
  async unload(): Promise<void> {
    await this.post('/unload', {}, 30_000).catch(() => undefined);
  }

  async health(): Promise<TtsHealth | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? ((await res.json()) as TtsHealth) : null;
    } catch {
      return null;
    }
  }
}

export const tts = new TtsClient(TTS_URL);

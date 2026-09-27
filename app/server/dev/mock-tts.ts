// Fake voice sidecar (docker/tts/server.py) for local dev and e2e tests: same HTTP surface, no GPU.
// /design and /clone write a short tone WAV (24 kHz mono) whose length follows the text, so durations,
// playback and export mixing behave like the real thing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { SAMPLE_RATE, toneWav } from './tone';

const PORT = Number(process.env.MOCK_TTS_PORT ?? 8190);
const OUT_DIR = process.env.TTS_OUT_DIR ?? path.join(os.tmpdir(), 'bb-mock-tts');
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? '200');
fs.mkdirSync(OUT_DIR, { recursive: true });

let loaded: string[] = [];
const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, models: { 'Qwen3-TTS-12Hz-1.7B-VoiceDesign': true, 'Qwen3-TTS-12Hz-1.7B-Base': true }, loaded }));

async function speak(text: string, hz: number) {
  await new Promise((r) => setTimeout(r, DELAY_MS));
  const file = path.join(OUT_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  const wav = toneWav(text, hz);
  fs.writeFileSync(file, wav);
  return { file, sampleRate: SAMPLE_RATE, durationSec: (wav.length - 44) / 2 / SAMPLE_RATE };
}

app.post('/design', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.text || !body.instruct) return c.json({ error: 'design needs text and instruct' }, 400);
  loaded = ['Qwen3-TTS-12Hz-1.7B-VoiceDesign'];
  return c.json(await speak(String(body.text), 180 + (String(body.instruct).length % 120)));
});

app.post('/clone', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.text || !body.refAudio) return c.json({ error: 'clone needs text and refAudio' }, 400);
  if (!fs.existsSync(String(body.refAudio))) return c.json({ error: `reference audio not found: ${body.refAudio}` }, 400);
  loaded = ['Qwen3-TTS-12Hz-1.7B-Base'];
  return c.json(await speak(String(body.text), 220));
});

app.post('/unload', (c) => {
  loaded = [];
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`Mock voice sidecar listening on http://127.0.0.1:${info.port}`);
});

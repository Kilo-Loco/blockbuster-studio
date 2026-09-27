// Character voices end to end: the real server against dev/mock-comfy.ts and dev/mock-tts.ts (in-process,
// free ports). Design a voice, preview it, hear a shot's line, re-render it when it changes, clone a voice
// from an uploaded clip, and export a film with the line mixed into the silent clip.
import { beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { toneWav } from './dev/tone';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const PASSWORD = 'voice-test-password';
let base = '';
let cookie = '';
let dataDir = '';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function api(pathAndQuery: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return fetch(`${base}${pathAndQuery}`, { ...init, headers });
}
const json = async <T = any>(res: Response | Promise<Response>): Promise<T> => (await (await res).json()) as T;

async function waitJob(id: string): Promise<any> {
  for (let i = 0; i < 20; i++) {
    const job = await json(api(`/api/jobs/${id}?wait=10`));
    if (['done', 'error', 'canceled'].includes(job.status)) return job;
  }
  throw new Error(`job ${id} never finished`);
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 20000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  const [serverPort, comfyPort, ttsPort] = [await getFreePort(), await getFreePort(), await getFreePort()];
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-voice-'));
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    STUDIO_PASSWORD: PASSWORD,
    COMFY_URL: `http://127.0.0.1:${comfyPort}`,
    MOCK_COMFY_PORT: String(comfyPort),
    MOCK_COMFY_OUTPUT_DIR: path.join(dataDir, 'mock-comfy-output'),
    TTS_URL: `http://127.0.0.1:${ttsPort}`,
    MOCK_TTS_PORT: String(ttsPort),
    TTS_OUT_DIR: path.join(dataDir, 'tts-out'),
    MOCK_DELAY_MS: '60',
    PORT: String(serverPort),
    HOST: '127.0.0.1',
    COMFY_MOCK: '1',
    WEB_DIST: path.join(dataDir, 'nonexistent-web-dist'),
  });
  base = `http://127.0.0.1:${serverPort}`;
  await import('./dev/mock-comfy');
  await import('./dev/mock-tts');
  await import('./index');
  await waitFor(
    () => fetch(`${base}/api/health`).then((r) => r.ok, () => false),
    Boolean,
    10000,
  );
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;
}, 30000);

describe('character voices', () => {
  let hank: any;
  let shotId = '';
  let projectId = '';

  it('reports the voice engine ready', async () => {
    expect((await json(api('/api/system'))).voice).toBe('ready');
  });

  it('designs a voice from a description', async () => {
    hank = await json(api('/api/characters', { method: 'POST', body: JSON.stringify({ name: 'Hank', description: 'an old man in a flannel shirt' }) }));
    const res = await api(`/api/characters/${hank.id}/voice`, { method: 'POST', body: JSON.stringify({ description: 'gravelly, tired man in his 60s, slow drawl' }) });
    expect(res.status).toBe(202);
    expect((await waitJob((await res.json()).id)).status).toBe('done');
    hank = await json(api(`/api/characters/${hank.id}`));
    expect(hank.voice).toMatchObject({ source: 'designed', description: 'gravelly, tired man in his 60s, slow drawl', language: 'English' });
    const ref = await json(api(`/api/assets/${hank.voice.refAssetId}`));
    expect(ref.kind).toBe('audio');
    expect(ref.durationSec).toBeGreaterThan(5);
    expect((await api(`/media/${ref.file}`)).headers.get('content-type')).toBe('audio/wav');
  });

  it('rejects a voice without a description', async () => {
    expect((await api(`/api/characters/${hank.id}/voice`, { method: 'POST', body: JSON.stringify({ description: ' ' }) })).status).toBe(400);
  });

  it('previews a line in that voice', async () => {
    const res = await api(`/api/characters/${hank.id}/voice/preview`, { method: 'POST', body: JSON.stringify({ text: 'Rough night, huh?' }) });
    const job = await waitJob((await res.json()).id);
    expect(job.status).toBe('done');
    expect((await json(api(`/api/assets/${job.outputAssetIds[0]}`))).kind).toBe('audio');
  });

  it("renders a shot's line in the speaker's voice as soon as it's written", async () => {
    const project = await json(api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Diner', aspect: '16:9' }) }));
    projectId = project.id;
    const scene = await json(api(`/api/projects/${projectId}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. DINER - NIGHT', description: 'a rainy diner' }) }));
    const shot = await json(api(`/api/scenes/${scene.id}/shots`, { method: 'POST', body: JSON.stringify({ action: 'Hank looks up from his coffee.', characterIds: [hank.id], durationSec: 5 }) }));
    shotId = shot.id;
    await api(`/api/shots/${shotId}`, { method: 'PATCH', body: JSON.stringify({ dialogue: 'Rough night, huh?' }) });
    const rendered = await waitFor(
      () => json(api(`/api/projects/${projectId}`)).then((d) => d.scenes[0].shots[0]),
      (s: any) => Boolean(s.dialogueAudioAssetId),
    );
    const audio = await json(api(`/api/assets/${rendered.dialogueAudioAssetId}`));
    expect(audio).toMatchObject({ kind: 'audio', shotId, projectId });
    expect(rendered.dialogueAudioKey).toBeTruthy();
  });

  it('re-renders the line when the words change', async () => {
    const before = (await json(api(`/api/projects/${projectId}`))).scenes[0].shots[0];
    await api(`/api/shots/${shotId}`, { method: 'PATCH', body: JSON.stringify({ dialogue: 'Long night, huh? Coffee?' }) });
    const after = await waitFor(
      () => json(api(`/api/projects/${projectId}`)).then((d) => d.scenes[0].shots[0]),
      (s: any) => s.dialogueAudioAssetId !== before.dialogueAudioAssetId,
    );
    expect(after.dialogueAudioKey).not.toBe(before.dialogueAudioKey);
  });

  it('keeps voice clips out of the image/video gallery', async () => {
    const all = await json(api('/api/assets'));
    expect(all.items.every((a: any) => a.kind !== 'audio')).toBe(true);
    const audio = await json(api('/api/assets?kind=audio'));
    expect(audio.items.length).toBeGreaterThanOrEqual(3);
  });

  it.skipIf(!hasFfmpeg)('clones a voice from an uploaded clip and re-renders its lines', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(toneWav('This is how I sound when I talk.', 300))], { type: 'audio/wav' }), 'me.wav');
    const upload = await json(api('/api/uploads', { method: 'POST', body: form }));
    expect(upload).toMatchObject({ kind: 'audio', origin: 'upload' });
    expect(upload.file).toMatch(/\.wav$/);
    const lineBefore = (await json(api(`/api/projects/${projectId}`))).scenes[0].shots[0].dialogueAudioAssetId;
    const updated = await json(api(`/api/characters/${hank.id}/voice`, { method: 'PUT', body: JSON.stringify({ assetId: upload.id, transcript: 'This is how I sound when I talk.' }) }));
    expect(updated.voice).toMatchObject({ source: 'cloned', refAssetId: upload.id, refText: 'This is how I sound when I talk.' });
    await waitFor(
      () => json(api(`/api/projects/${projectId}`)).then((d) => d.scenes[0].shots[0].dialogueAudioAssetId),
      (id) => id !== lineBefore,
    );
  });

  it.skipIf(!hasFfmpeg)('exports a film with the line mixed into the silent clip', async () => {
    expect((await waitJob((await json(api(`/api/shots/${shotId}/keyframe`, { method: 'POST' }))).id)).status).toBe('done');
    expect((await waitJob((await json(api(`/api/shots/${shotId}/video`, { method: 'POST' }))).id)).status).toBe('done');
    const exportJob = await json(api(`/api/projects/${projectId}/export`, { method: 'POST' }));
    expect((await waitJob(exportJob.id)).status).toBe('done');
    const project = (await json(api(`/api/projects/${projectId}`))).project;
    const film = await json(api(`/api/assets/${project.exportAssetId}`));
    const file = path.join(dataDir, 'media', film.file);
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
    const maxDb = Number(/max_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1]);
    expect(maxDb).toBeGreaterThan(-30); // silence would be about -91 dB
  }, 60000);

  it('clears a voice', async () => {
    const cleared = await json(api(`/api/characters/${hank.id}/voice`, { method: 'DELETE' }));
    expect(cleared.voice).toBeUndefined();
  });
});

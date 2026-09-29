// Boots the real server (server/index.ts) against dev/mock-comfy.ts, both on random free ports,
// in-process, and drives the HTTP API end to end.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

let serverPort: number;
let comfyPort: number;
let dataDir: string;
let cookie = '';

function api(pathAndQuery: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('Cookie', cookie);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return fetch(`http://127.0.0.1:${serverPort}${pathAndQuery}`, { ...init, headers });
}

async function waitUntil<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs = 20000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (predicate(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  serverPort = await getFreePort();
  comfyPort = await getFreePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-integration-'));

  process.env.DATA_DIR = dataDir;
  process.env.STUDIO_PASSWORD = 'test-password-123';
  process.env.COMFY_URL = `http://127.0.0.1:${comfyPort}`;
  process.env.MOCK_COMFY_PORT = String(comfyPort);
  process.env.MOCK_COMFY_OUTPUT_DIR = path.join(dataDir, 'mock-comfy-output');
  process.env.MOCK_DELAY_MS = '80';
  process.env.PORT = String(serverPort);
  process.env.HOST = '127.0.0.1';
  process.env.COMFY_MOCK = '1';
  process.env.WEB_DIST = path.join(dataDir, 'nonexistent-web-dist');

  await import('./dev/mock-comfy');
  await import('./index');

  // Wait for both servers to actually accept connections.
  await waitUntil(
    async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${comfyPort}/system_stats`);
        return res.ok;
      } catch {
        return false;
      }
    },
    (ok) => ok,
    10000,
  );
  await waitUntil(
    async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${serverPort}/api/health`);
        return res.ok;
      } catch {
        return false;
      }
    },
    (ok) => ok,
    10000,
  );
}, 30000);

describe('integration: server + mock ComfyUI', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await api('/api/system');
    expect(res.status).toBe(401);
  });

  it('logs in and sets the session cookie', async () => {
    const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: 'test-password-123' }) });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    cookie = setCookie!.split(';')[0]!;
    const session = await api('/api/session');
    expect((await session.json()).authenticated).toBe(true);
  });

  it('rejects bad passwords and reports unauthenticated', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(res.status).toBe(401);
  });

  it('reports system info once authenticated', async () => {
    const res = await api('/api/system');
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info.comfy.online).toBe(true);
    expect(info.engines.zimage).toBe(true);
  });

  let firstAssetId: string;
  let secondAssetId: string;

  it('rejects an unknown quality with 400 instead of a failed job', async () => {
    const res = await api('/api/generate', { method: 'POST', body: JSON.stringify({ engine: 'zimage', prompt: 'x', aspect: '16:9', quality: 'sd' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('"fast" or "hd"');
  });

  it('runs a zimage generate job end to end and produces 2 assets', async () => {
    const genRes = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ engine: 'zimage', prompt: 'a cat in the rain, neon sign reflections', aspect: '16:9', count: 2 }),
    });
    expect(genRes.status).toBe(202);
    const job = await genRes.json();
    expect(job.status === 'queued' || job.status === 'running').toBe(true);

    const finished = await waitUntil(
      async () => (await (await api(`/api/jobs/${job.id}`)).json()) as { status: string; outputAssetIds: string[] },
      (j) => j.status === 'done' || j.status === 'error',
      20000,
    );
    expect(finished.status).toBe('done');
    expect(finished.outputAssetIds).toHaveLength(2);
    [firstAssetId, secondAssetId] = finished.outputAssetIds;

    for (const assetId of finished.outputAssetIds) {
      const assetRes = await api(`/api/assets/${assetId}`);
      expect(assetRes.status).toBe(200);
      const asset = await assetRes.json();
      expect(asset.kind).toBe('image');
      expect(asset.width).toBeGreaterThan(0);
      expect(asset.height).toBeGreaterThan(0);
      const onDisk = path.join(dataDir, 'media', asset.file);
      expect(fs.existsSync(onDisk)).toBe(true);
    }
  }, 25000);

  it('lists the generated assets via GET /api/assets', async () => {
    const res = await api('/api/assets?kind=image&limit=10');
    const body = await res.json();
    const ids = body.items.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([firstAssetId, secondAssetId]));
  });

  it('runs a shot keyframe in compose mode using an establishing image and a character reference', async () => {
    // Reuse the two zimage assets from the previous test as the location's establishing image
    // and the character's reference image, rather than uploading new files.
    const locRes = await api('/api/locations', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ramen bar', description: 'a neon-lit ramen bar, rain on the windows' }),
    });
    const location = await locRes.json();
    const patched = await api(`/api/locations/${location.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ establishingAssetId: firstAssetId }),
    });
    expect(patched.status).toBe(200);

    const charRes = await api('/api/characters', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Mara',
        description: 'a woman in her 30s with short silver hair, black trench coat',
        referenceAssetIds: [secondAssetId],
      }),
    });
    const character = await charRes.json();

    const projRes = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Ramen noir', aspect: '16:9' }) });
    const project = await projRes.json();

    const sceneRes = await api(`/api/projects/${project.id}/scenes`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'INT. RAMEN BAR - NIGHT',
        description: 'Mara waits at the counter.',
        locationId: location.id,
        timeOfDay: 'night',
        blocking: [{ characterId: character.id, pos: { x: 6, y: 4 }, facingDeg: 180 }],
      }),
    });
    const scene = await sceneRes.json();

    const shotRes = await api(`/api/scenes/${scene.id}/shots`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'Mara slides the envelope across the counter without looking up.',
        shotSize: 'MS',
        cameraMove: 'push_in',
        characterIds: [character.id],
        durationSec: 5,
      }),
    });
    const shot = await shotRes.json();

    const previewRes = await api(`/api/shots/${shot.id}/preview`);
    const preview = await previewRes.json();
    expect(preview.mode).toBe('compose');

    const kfJob = await (await api(`/api/shots/${shot.id}/keyframe`, { method: 'POST' })).json();
    const finished = await waitUntil(
      async () => (await (await api(`/api/jobs/${kfJob.id}`)).json()) as { status: string },
      (j) => j.status === 'done' || j.status === 'error',
      20000,
    );
    expect(finished.status).toBe('done');

    const detail = await (await api(`/api/projects/${project.id}`)).json();
    const updatedShot = detail.scenes[0].shots.find((s: { id: string }) => s.id === shot.id);
    expect(updatedShot.status).toBe('keyframe_ready');
    expect(updatedShot.keyframeAssetId).toBeTruthy();
  }, 25000);
});

describe('scene previs + reference sheet (LTX-2.5 IC-LoRA scene-previs branch)', () => {
  async function uploadFile(filePath: string, type: string): Promise<{ id: string }> {
    const form = new FormData();
    const bytes = await fs.promises.readFile(filePath);
    form.append('file', new Blob([bytes], { type }), path.basename(filePath));
    const res = await api('/api/uploads', { method: 'POST', body: form as unknown as BodyInit });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('renders a shot with no keyframe of its own from the scene previs + reference sheet, via LTX-2.5', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-previs-fixture-'));
    const previsFile = path.join(tmp, 'previs.mp4');
    const sheetFile = path.join(tmp, 'sheet.png');
    await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=6', '-pix_fmt', 'yuv420p', previsFile]);
    await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=1792x1008', '-frames:v', '1', sheetFile]);

    const previs = await uploadFile(previsFile, 'video/mp4');
    const sheet = await uploadFile(sheetFile, 'image/png');
    fs.rmSync(tmp, { recursive: true, force: true });

    const project = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Previs film', aspect: '16:9' }) })).json();
    const scene = await (
      await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. GARAGE - DAY', description: 'A car pulls up.' }) })
    ).json();
    const shot = await (
      await api(`/api/scenes/${scene.id}/shots`, {
        method: 'POST',
        body: JSON.stringify({ action: 'The car pulls into the garage and stops.', shotSize: 'WS', cameraMove: 'static', durationSec: 5 }),
      })
    ).json();
    // No keyframeAssetId on this shot at all — the scene previs + sheet stands in for it.
    expect(shot.keyframeAssetId).toBeFalsy();

    const patched = await api(`/api/scenes/${scene.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ previsAssetId: previs.id, referenceSheetAssetId: sheet.id, referenceSheetText: 'Top row: a red muscle car, product turnaround.' }),
    });
    expect(patched.status).toBe(200);

    const prevMock = process.env.MOCK_LTX_IC;
    process.env.MOCK_LTX_IC = '1';
    try {
      const videoJob = await (await api(`/api/shots/${shot.id}/video`, { method: 'POST' })).json();
      const finished = await waitUntil(
        async () => (await (await api(`/api/jobs/${videoJob.id}`)).json()) as { status: string; error?: string },
        (j) => j.status === 'done' || j.status === 'error',
        25000,
      );
      expect(finished.error).toBeUndefined();
      expect(finished.status).toBe('done');

      const detail = await (await api(`/api/projects/${project.id}`)).json();
      const updatedShot = detail.scenes[0].shots.find((s: { id: string }) => s.id === shot.id);
      expect(updatedShot.status).toBe('video_ready');
      expect(updatedShot.videoAssetId).toBeTruthy();

      const asset = await (await api(`/api/assets/${updatedShot.videoAssetId}`)).json();
      expect(asset.engine).toBe('ltx_ic');
      expect(asset.params.videoModel).toBe('ltx_2_5');
      expect(asset.params.controlVideoAssetId).toBe(previs.id);
      expect(asset.params.referenceSheetAssetId).toBe(sheet.id);
    } finally {
      if (prevMock === undefined) delete process.env.MOCK_LTX_IC;
      else process.env.MOCK_LTX_IC = prevMock;
    }
  }, 30000);

  it('still requires a keyframe for a shot in a scene with no previs (old behaviour unchanged)', async () => {
    const project = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'No previs film', aspect: '16:9' }) })).json();
    const scene = await (await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. OFFICE - DAY' }) })).json();
    const shot = await (
      await api(`/api/scenes/${scene.id}/shots`, { method: 'POST', body: JSON.stringify({ action: 'Someone types at a desk.', shotSize: 'MS', cameraMove: 'static', durationSec: 5 }) })
    ).json();
    const res = await api(`/api/shots/${shot.id}/video`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no keyframe/i);
  });

  it('validates the new previs/sheet/grade/kind fields with 400s', async () => {
    const project = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Validation film', aspect: '16:9' }) })).json();
    const scene = await (await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. TEST - DAY' }) })).json();

    expect((await api(`/api/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ previsCuts: 'not-an-array' }) })).status).toBe(400);
    expect((await api(`/api/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ previsCuts: [5, 1] }) })).status).toBe(400); // must be non-decreasing
    expect((await api(`/api/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ previsAssetId: 123 }) })).status).toBe(400);
    expect((await api(`/api/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ previsCuts: [1, 3] }) })).status).toBe(200);

    expect((await api(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ grade: 'sepia' }) })).status).toBe(400);
    expect((await api(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ grade: 'film' }) })).status).toBe(200);

    expect((await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: 'Bad Kind', kind: 'vehicle' }) })).status).toBe(400);
    const prop = await (await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: 'The Car', description: 'a red muscle car', kind: 'prop' }) })).json();
    expect(prop.kind).toBe('prop');
    expect((await api(`/api/characters/${prop.id}`, { method: 'PATCH', body: JSON.stringify({ kind: 'vehicle' }) })).status).toBe(400);
    expect((await api(`/api/characters/${prop.id}/face`, { method: 'POST' })).status).toBe(400); // props have no face close-up

    const shot = await (
      await api(`/api/scenes/${scene.id}/shots`, { method: 'POST', body: JSON.stringify({ action: 'x', shotSize: 'MS', cameraMove: 'static', durationSec: 5 }) })
    ).json();
    expect((await api(`/api/shots/${shot.id}`, { method: 'PATCH', body: JSON.stringify({ controlStrength: 2 }) })).status).toBe(400);
    expect((await api(`/api/shots/${shot.id}`, { method: 'PATCH', body: JSON.stringify({ pinKeyframe: 'yes' }) })).status).toBe(400);
    const okShot = await api(`/api/shots/${shot.id}`, { method: 'PATCH', body: JSON.stringify({ controlStrength: 0.6, pinKeyframe: true }) });
    expect(okShot.status).toBe(200);
    expect((await okShot.json()).controlStrength).toBe(0.6);
  });
});

afterAll(async () => {
  // Best-effort cleanup; the temp DATA_DIR is left for inspection on failure but removed on success.
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

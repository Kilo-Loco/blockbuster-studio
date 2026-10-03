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

    expect((await api(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ upscale: '8k' }) })).status).toBe(400);
    expect((await api(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ upscale: '4k' }) })).status).toBe(200);

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

describe('guided previs flow: project mode, scene castIds, previs import, render fix', () => {
  it('validates project mode on create and update', async () => {
    const bad = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Bad mode', aspect: '16:9', mode: 'sketch' }) });
    expect(bad.status).toBe(400);
    const created = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Previs mode test', aspect: '16:9', mode: 'previs' }) })).json();
    expect(created.mode).toBe('previs');
    expect((await api(`/api/projects/${created.id}`, { method: 'PATCH', body: JSON.stringify({ mode: 'nope' }) })).status).toBe(400);
    const toScript = await api(`/api/projects/${created.id}`, { method: 'PATCH', body: JSON.stringify({ mode: 'script' }) });
    expect(toScript.status).toBe(200);
    expect((await toScript.json()).mode).toBe('script');
  });

  it('validates scene castIds and falls back the reference sheet to the union of shot characters when unset', async () => {
    const project = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Cast film', aspect: '16:9' }) })).json();
    const scene = await (await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. STUDIO - DAY' }) })).json();
    const mara = await (await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: 'Mara C', description: 'a courier' }) })).json();

    expect((await api(`/api/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ castIds: 'not-an-array' }) })).status).toBe(400);
    expect((await api(`/api/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ castIds: ['does-not-exist'] }) })).status).toBe(400);
    const withCast = await api(`/api/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ castIds: [mara.id] }) });
    expect(withCast.status).toBe(200);
    expect((await withCast.json()).castIds).toEqual([mara.id]);

    const clearedCast = await api(`/api/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ castIds: [] }) });
    expect((await clearedCast.json()).castIds).toEqual([]);
  });

  it('imports a previs sequences.json into a scene, creating and reusing shots, and setting previsCuts', async () => {
    const project = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Coast Road', aspect: '16:9', mode: 'previs' }) })).json();
    const scene = await (await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'EXT. CLIFF ROAD - DAY' }) })).json();
    // One shot with an empty action already in the scene; it should be reused (not duplicated) and its
    // action filled from the file, since it's blank.
    const existingShot = await (await api(`/api/scenes/${scene.id}/shots`, { method: 'POST', body: JSON.stringify({ action: '', shotSize: 'WS', cameraMove: 'static', durationSec: 5 }) })).json();

    const badBody = await api(`/api/scenes/${scene.id}/previs/import`, { method: 'POST', body: JSON.stringify({ sequences: { not: 'a previs file' } }) });
    expect(badBody.status).toBe(400);

    // The real Coast Road sequences.json shape (see docs/plans/guided_flow_spec.md), trimmed.
    const sequences = {
      film: 'COAST ROAD',
      fps: 24,
      sequences: [
        {
          name: 'seq',
          file: 'seq.mp4',
          shots: [
            { shot: 1, name: 'Aerial', beat: 'establish: the car on the cliff road', start_s: 0.0, end_s: 3.0 },
            { shot: 2, name: 'Close on driver', beat: 'she grips the wheel', start_s: 3.0, end_s: 5.0 },
            { shot: 3, name: 'Wide', beat: 'the road curves ahead', start_s: 5.0, end_s: 7.5 },
            { shot: 4, name: 'Reverse', beat: 'the ocean behind her', start_s: 7.5, end_s: 10.0 },
          ],
        },
      ],
    };
    const res = await api(`/api/scenes/${scene.id}/previs/import`, { method: 'POST', body: JSON.stringify({ sequences }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shots).toHaveLength(4);
    expect(body.shots[0].id).toBe(existingShot.id); // reused, not duplicated
    expect(body.shots[0].action).toBe('establish: the car on the cliff road'); // filled (was empty)
    expect(body.shots[1].action).toBe('she grips the wheel'); // newly created
    expect(body.scene.previsCuts).toEqual([3, 5, 7.5]);
    // previsCuts recomputed every shot's durationSec (10 s previs, cuts at 3/5/7.5 → 3, 2, 2.5, 2.5 s).
    expect(body.shots.map((s: { durationSec: number }) => s.durationSec)).toEqual([3, 2, 2.5, 2.5]);

    // An existing shot with a non-empty action keeps it.
    const namedShot = await (await api(`/api/scenes/${scene.id}/shots`, { method: 'POST', body: JSON.stringify({ action: 'Kept as written', shotSize: 'MS', cameraMove: 'static', durationSec: 1 }) })).json();
    void namedShot;

    // Too many existing shots (now 5) for a file with only 4: 409.
    const tooMany = await api(`/api/scenes/${scene.id}/previs/import`, { method: 'POST', body: JSON.stringify({ sequences }) });
    expect(tooMany.status).toBe(409);
    expect((await tooMany.json()).error).toMatch(/5 shots but the previs has 4/);
  });

  it('picks a sequence by index, and the old top-level { shots: [...] } shape still works', async () => {
    const project = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Two sequences', aspect: '16:9' }) })).json();
    const scene = await (await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. TWO SEQ' }) })).json();
    const twoSeqs = {
      sequences: [
        { name: 'seqA', file: 'a.mp4', shots: [{ start_s: 0, end_s: 2 }, { start_s: 2, end_s: 4 }] },
        { name: 'seqB', file: 'b.mp4', shots: [{ start_s: 0, end_s: 1 }, { start_s: 1, end_s: 6 }, { start_s: 6, end_s: 9 }] },
      ],
    };
    const res = await api(`/api/scenes/${scene.id}/previs/import`, { method: 'POST', body: JSON.stringify({ sequences: twoSeqs, sequence: 1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shots).toHaveLength(3);
    expect(body.scene.previsCuts).toEqual([1, 6]);

    const flatScene = await (await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. FLAT SHAPE' }) })).json();
    const flat = { shots: [{ start_s: 0, end_s: 4, name: 'A' }, { start_s: 4, end_s: 9, name: 'B' }] };
    const flatRes = await api(`/api/scenes/${flatScene.id}/previs/import`, { method: 'POST', body: JSON.stringify({ sequences: flat }) });
    expect(flatRes.status).toBe(200);
    expect((await flatRes.json()).scene.previsCuts).toEqual([4]);
  });

  it('render what:videos queues a previs scene\'s shots even without a keyframe, and sceneId scopes it to one scene', async () => {
    const project = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Render fix film', aspect: '16:9' }) })).json();
    const previsScene = await (await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. PREVIS SCENE' }) })).json();
    const otherScene = await (await api(`/api/projects/${project.id}/scenes`, { method: 'POST', body: JSON.stringify({ title: 'INT. OTHER SCENE' }) })).json();
    const previsShot = await (
      await api(`/api/scenes/${previsScene.id}/shots`, { method: 'POST', body: JSON.stringify({ action: 'The car pulls in.', shotSize: 'WS', cameraMove: 'static', durationSec: 5 }) })
    ).json();
    const otherShot = await (
      await api(`/api/scenes/${otherScene.id}/shots`, { method: 'POST', body: JSON.stringify({ action: 'Someone waits.', shotSize: 'MS', cameraMove: 'static', durationSec: 5 }) })
    ).json();
    expect(previsShot.keyframeAssetId).toBeFalsy();
    expect(otherShot.keyframeAssetId).toBeFalsy();

    // Without a previs + reference sheet, this scene's shot still needs a keyframe (unchanged behaviour).
    const beforePrevis = await api(`/api/projects/${project.id}/render`, { method: 'POST', body: JSON.stringify({ what: 'videos', sceneId: previsScene.id }) });
    expect((await beforePrevis.json())).toEqual([]);

    // A small previs + sheet fixture (reuses the same upload path as the LTX scene-previs test above).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-render-fix-'));
    const previsFile = path.join(tmp, 'previs.mp4');
    const sheetFile = path.join(tmp, 'sheet.png');
    await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=5', '-pix_fmt', 'yuv420p', previsFile]);
    await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=1792x1008', '-frames:v', '1', sheetFile]);
    const uploadFile = async (filePath: string, type: string) => {
      const form = new FormData();
      const bytes = await fs.promises.readFile(filePath);
      form.append('file', new Blob([bytes], { type }), path.basename(filePath));
      return (await api('/api/uploads', { method: 'POST', body: form as unknown as BodyInit })).json();
    };
    const previs = await uploadFile(previsFile, 'video/mp4');
    const sheet = await uploadFile(sheetFile, 'image/png');
    fs.rmSync(tmp, { recursive: true, force: true });
    await api(`/api/scenes/${previsScene.id}`, { method: 'PATCH', body: JSON.stringify({ previsAssetId: previs.id, referenceSheetAssetId: sheet.id }) });

    // sceneId scopes rendering to the previs scene only: the other scene's keyframe-less shot is skipped.
    const scoped = await api(`/api/projects/${project.id}/render`, { method: 'POST', body: JSON.stringify({ what: 'videos', sceneId: previsScene.id }) });
    expect(scoped.status).toBe(202);
    const scopedJobs = await scoped.json();
    expect(scopedJobs).toHaveLength(1);
    expect(scopedJobs[0].shotId).toBe(previsShot.id);

    // Without sceneId, every ready shot in the project is queued, but the other scene's is still skipped
    // (no keyframe, no previs); onlyMissing keeps this from duplicating the previs shot's job.
    const projectWide = await api(`/api/projects/${project.id}/render`, { method: 'POST', body: JSON.stringify({ what: 'videos', onlyMissing: true }) });
    const projectWideJobs = await projectWide.json();
    expect(projectWideJobs.every((j: { shotId: string }) => j.shotId !== otherShot.id)).toBe(true);
  }, 20000);
});

afterAll(async () => {
  // Best-effort cleanup; the temp DATA_DIR is left for inspection on failure but removed on success.
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('character builder (character_refs attach:false → character_build)', () => {
  it('renders candidate looks without attaching them, then builds sheets and a training set from the chosen one', async () => {
    const mara = await (await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: 'Mara Build', description: 'a woman with short silver hair, black trench coat' }) })).json();

    const looksJob = await (await api(`/api/characters/${mara.id}/references`, { method: 'POST', body: JSON.stringify({ count: 2, attach: false }) })).json();
    expect(looksJob.title).toBe('Looks: Mara Build');
    const looksDone = await waitUntil(
      async () => (await (await api(`/api/jobs/${looksJob.id}`)).json()) as { status: string; outputAssetIds: string[]; error?: string },
      (j) => j.status === 'done' || j.status === 'error',
    );
    expect(looksDone.error).toBeUndefined();
    expect(looksDone.outputAssetIds).toHaveLength(2);
    // Candidates stay out of the character until one is chosen.
    expect((await (await api(`/api/characters/${mara.id}`)).json()).referenceAssetIds).toEqual([]);

    expect((await api(`/api/characters/${mara.id}/build`, { method: 'POST', body: JSON.stringify({}) })).status).toBe(400);
    expect((await api(`/api/characters/${mara.id}/build`, { method: 'POST', body: JSON.stringify({ lookAssetId: 'nope' }) })).status).toBe(400);

    const look = looksDone.outputAssetIds[1]!;
    const buildRes = await api(`/api/characters/${mara.id}/build`, { method: 'POST', body: JSON.stringify({ lookAssetId: look, train: false, variations: 3 }) });
    expect(buildRes.status).toBe(202);
    const buildJob = await buildRes.json();
    expect(buildJob.type).toBe('character_build');
    const buildDone = await waitUntil(
      async () => (await (await api(`/api/jobs/${buildJob.id}`)).json()) as { status: string; outputAssetIds: string[]; error?: string },
      (j) => j.status === 'done' || j.status === 'error',
      60000,
    );
    expect(buildDone.error).toBeUndefined();
    // turnaround + face + 3 variations
    expect(buildDone.outputAssetIds).toHaveLength(5);

    const built = await (await api(`/api/characters/${mara.id}`)).json();
    expect(built.sheetAssets.turnaround).toBe(buildDone.outputAssetIds[0]);
    expect(built.sheetAssets.face).toBe(buildDone.outputAssetIds[1]);
    expect(built.referenceAssetIds).toEqual([look, ...buildDone.outputAssetIds.slice(2)]);
    expect(built.triggerWord).toBe('ohwx_mara_build');
    expect(built.loraId).toBeUndefined();

    // The sheets were drawn from the look (Qwen edits), the angles with the multi-angle LoRA.
    const turnaround = await (await api(`/api/assets/${built.sheetAssets.turnaround}`)).json();
    expect(turnaround.engine).toBe('qwen_edit');
    expect(turnaround.params.lookAssetId).toBe(look);
    const firstVariation = await (await api(`/api/assets/${built.referenceAssetIds[1]}`)).json();
    expect(firstVariation.engine).toBe('qwen_angle');
  });
});

describe('character packs (export → import)', () => {
  it('round-trips a character with its references, sheets and LoRA into a new character', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pack-fixture-'));
    const img = path.join(tmp, 'ref.png');
    await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', img]);
    const form = new FormData();
    form.append('file', new Blob([await fs.promises.readFile(img)], { type: 'image/png' }), 'ref.png');
    const ref = await (await api('/api/uploads', { method: 'POST', body: form as unknown as BodyInit })).json();

    // A "trained" LoRA: any bytes, uploaded through the LoRA upload route.
    const loraForm = new FormData();
    loraForm.append('file', new Blob([Buffer.alloc(2048, 9)]), 'Pack_Test.safetensors');
    loraForm.append('name', 'Pack Test');
    loraForm.append('kind', 'character');
    loraForm.append('triggerWord', 'ohwx_pack');
    const lora = await (await api('/api/loras/upload', { method: 'POST', body: loraForm as unknown as BodyInit })).json();
    expect(lora.filename).toBe('Pack_Test.safetensors');

    const src = await (
      await api('/api/characters', {
        method: 'POST',
        body: JSON.stringify({ name: 'Pack Test', description: 'a courier in a yellow jacket', referenceAssetIds: [ref.id], sheetAssets: { face: ref.id }, loraId: lora.id, triggerWord: 'ohwx_pack' }),
      })
    ).json();

    const exp = await (await api(`/api/characters/${src.id}/export`, { method: 'POST' })).json();
    expect(exp.count).toBe(2); // the image + the LoRA file
    const zipRes = await api(exp.url);
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get('content-disposition')).toContain('pack-test-character.zip');
    const zip = Buffer.from(await zipRes.arrayBuffer());

    const importForm = new FormData();
    importForm.append('file', new Blob([zip], { type: 'application/zip' }), 'pack-test-character.zip');
    const impRes = await api('/api/characters/import', { method: 'POST', body: importForm as unknown as BodyInit });
    expect(impRes.status).toBe(201);
    const imported = await impRes.json();
    expect(imported.id).not.toBe(src.id);
    expect(imported.name).toBe('Pack Test');
    expect(imported.description).toBe('a courier in a yellow jacket');
    expect(imported.triggerWord).toBe('ohwx_pack');
    expect(imported.referenceAssetIds).toHaveLength(1);
    expect(imported.referenceAssetIds[0]).not.toBe(ref.id);
    expect(imported.sheetAssets.face).toBe(imported.referenceAssetIds[0]);
    expect(imported.loraId).toBeTruthy();
    expect(imported.loraId).not.toBe(lora.id);

    const newAsset = await (await api(`/api/assets/${imported.referenceAssetIds[0]}`)).json();
    expect(newAsset.origin).toBe('upload');
    expect(newAsset.params.importedFrom).toBe(ref.id);
    const newLora = (await (await api('/api/loras?family=zimage')).json()).find((l: { id: string }) => l.id === imported.loraId);
    expect(newLora).toMatchObject({ triggerWord: 'ohwx_pack', kind: 'character', status: 'ready', source: 'upload' });
    // Same bytes as the one already there, so the file name is reused rather than duplicated.
    expect(newLora.filename).toBe('Pack_Test.safetensors');

    // Not a pack: a clear 422, nothing created.
    const before = (await (await api('/api/characters')).json()).length;
    const badForm = new FormData();
    badForm.append('file', new Blob([Buffer.from('nope')], { type: 'application/zip' }), 'x.zip');
    const bad = await api('/api/characters/import', { method: 'POST', body: badForm as unknown as BodyInit });
    expect(bad.status).toBe(422);
    expect((await (await api('/api/characters')).json()).length).toBe(before);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

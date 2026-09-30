// Agent access end to end (docs/plans/2026-09-agent-access.md): the agent token, waiting on jobs, the
// one-request storyboard, review images, signed links and the MCP server, against the real server and
// dev/mock-comfy.ts, both in-process on free ports.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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

const TOKEN = 'bbs_test-token-0123456789abcdefghijklmnopqrstuvwxyz';
const PASSWORD = 'agent-test-password';
let base: string;
let dataDir: string;
let cookie = '';
const logged: string[] = [];

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function api(pathAndQuery: string, init: RequestInit & { as?: 'agent' | 'human' | 'nobody' } = {}) {
  const headers = new Headers(init.headers);
  const as = init.as ?? 'agent';
  if (as === 'agent') headers.set('Authorization', `Bearer ${TOKEN}`);
  if (as === 'human') headers.set('Cookie', cookie);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return fetch(`${base}${pathAndQuery}`, { ...init, headers });
}

async function json<T = any>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

async function waitDone(ids: string[]) {
  for (let i = 0; i < 20; i++) {
    const jobs = await json<any[]>(api(`/api/jobs?ids=${ids.join(',')}&wait=10`));
    if (jobs.every((j) => ['done', 'error', 'canceled'].includes(j.status))) return jobs;
  }
  throw new Error('jobs never finished');
}

beforeAll(async () => {
  const serverPort = await getFreePort();
  const comfyPort = await getFreePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-agent-'));
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    STUDIO_PASSWORD: PASSWORD,
    STUDIO_AGENT_TOKEN: TOKEN,
    COMFY_URL: `http://127.0.0.1:${comfyPort}`,
    MOCK_COMFY_PORT: String(comfyPort),
    MOCK_COMFY_OUTPUT_DIR: path.join(dataDir, 'mock-comfy-output'),
    MOCK_DELAY_MS: '300',
    PORT: String(serverPort),
    HOST: '127.0.0.1',
    COMFY_MOCK: '1',
    WEB_DIST: path.join(dataDir, 'nonexistent-web-dist'),
  });
  delete process.env.AGENT_ACCESS;
  // Everything the server prints, to prove the token never appears in it.
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      original(...args);
    });
  }
  await import('./dev/mock-comfy');
  await import('./index');
  base = `http://127.0.0.1:${serverPort}`;
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
    const comfyOk = await fetch(`http://127.0.0.1:${comfyPort}/system_stats`).then((r) => r.ok).catch(() => false);
    if (ok && comfyOk) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;
}, 30000);

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('agent token', () => {
  it('accepts the bearer token and rejects wrong, missing, or query-string tokens', async () => {
    expect((await api('/api/system')).status).toBe(200);
    expect((await api('/api/system', { as: 'nobody' })).status).toBe(401);
    expect((await api('/api/system', { as: 'nobody', headers: { Authorization: `Bearer ${TOKEN}x` } })).status).toBe(401);
    expect((await api('/api/system', { as: 'nobody', headers: { Authorization: `Basic ${TOKEN}` } })).status).toBe(401);
    expect((await api(`/api/system?token=${TOKEN}`, { as: 'nobody' })).status).toBe(401);
    expect((await api(`/api/system?access_token=${TOKEN}`, { as: 'nobody' })).status).toBe(401);
    expect((await api('/media/anything.png', { as: 'nobody' })).status).toBe(401);
  });

  it('throttles repeated wrong tokens from one address, like wrong passwords', async () => {
    // Runpod's proxy (Cloudflare) sets CF-Connecting-IP; the client controls X-Forwarded-For, so changing
    // it on every attempt must not reset the count (measured on a real pod, 2026-09-27).
    const from = { 'CF-Connecting-IP': '203.0.113.9' };
    for (let i = 0; i < 10; i++) {
      const headers = { ...from, 'X-Forwarded-For': `198.51.100.${i}`, Authorization: `Bearer wrong-${i}` };
      expect((await api('/api/system', { as: 'nobody', headers })).status).toBe(401);
    }
    expect((await api('/api/system', { as: 'nobody', headers: { ...from, 'X-Forwarded-For': '198.51.100.99', Authorization: `Bearer wrong-x` } })).status).toBe(429);
    // Even the right token waits out the window from that address; others are unaffected.
    expect((await api('/api/system', { headers: from })).status).toBe(429);
    expect((await api('/api/system', { headers: { 'CF-Connecting-IP': '203.0.113.10' } })).status).toBe(200);
  });

  it('counts a whole IPv6 /64 as one address', async () => {
    const { ipKey } = await import('./auth');
    expect(ipKey('2603:8002:f540:1346:3536:f1b7:a404:42d4')).toBe('2603:8002:f540:1346::/64');
    expect(ipKey('2603:8002:f540:1346::1')).toBe('2603:8002:f540:1346::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
    for (let i = 0; i < 10; i++) {
      await api('/api/system', { as: 'nobody', headers: { 'CF-Connecting-IP': `2001:db8:aa:bb::${i + 1}`, Authorization: 'Bearer nope' } });
    }
    expect((await api('/api/system', { headers: { 'CF-Connecting-IP': '2001:db8:aa:bb:ffff::9' } })).status).toBe(429);
  });

  it('reports agent access without ever returning the token', async () => {
    const res = await api('/api/agent-token', { as: 'human' });
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ enabled: true, source: 'env' });
    expect(text).not.toContain(TOKEN);
  });

  it('only a password session may rotate the token', async () => {
    expect((await api('/api/agent-token/rotate', { method: 'POST' })).status).toBe(403);
    // The token here comes from STUDIO_AGENT_TOKEN, so rotation points at the Runpod secret.
    expect((await api('/api/agent-token/rotate', { method: 'POST', as: 'human' })).status).toBe(409);
  });

  it('tags jobs with who queued them', async () => {
    const byAgent = await json(api('/api/generate', { method: 'POST', body: JSON.stringify({ engine: 'zimage', prompt: 'a lighthouse', aspect: '1:1', count: 1 }) }));
    const byHuman = await json(api('/api/generate', { method: 'POST', as: 'human', body: JSON.stringify({ engine: 'zimage', prompt: 'a harbour', aspect: '1:1', count: 1 }) }));
    expect(byAgent.actor).toBe('agent');
    expect(byAgent.statusUrl).toBe(`/api/jobs/${byAgent.id}?wait=50`);
    expect(byHuman.actor).toBe('human');
    await waitDone([byAgent.id, byHuman.id]);
  }, 30000);
});

describe('waiting on jobs', () => {
  it('holds until the job finishes', async () => {
    const job = await json(api('/api/generate', { method: 'POST', body: JSON.stringify({ engine: 'zimage', prompt: 'a red door', aspect: '1:1', count: 1 }) }));
    const done = await json(api(`/api/jobs/${job.id}?wait=20`));
    expect(done.status).toBe('done');
    expect(done.outputAssetIds).toHaveLength(1);
  }, 30000);

  it('returns at the timeout while work is still queued, and waits on a batch', async () => {
    const jobs = [];
    for (let i = 0; i < 3; i++) jobs.push(await json(api('/api/generate', { method: 'POST', body: JSON.stringify({ engine: 'zimage', prompt: `boat ${i}`, aspect: '1:1', count: 4 }) })));
    const started = Date.now();
    const last = await json(api(`/api/jobs/${jobs[2].id}?wait=1`));
    expect(Date.now() - started).toBeLessThan(2500);
    expect(['queued', 'running']).toContain(last.status);
    const all = await json<any[]>(api(`/api/jobs?ids=${jobs.map((j) => j.id).join(',')}&wait=30`));
    expect(all.map((j) => j.status)).toEqual(['done', 'done', 'done']);
  }, 40000);

  it('caps a wait at 50 s', async () => {
    const { waitMs } = await import('./pipeline/wait');
    expect(waitMs('500')).toBe(50_000);
    expect(waitMs('abc')).toBe(0);
    expect(waitMs(undefined)).toBe(0);
  });

  it('cancels a running job even when ComfyUI never answers', async () => {
    const job = await json(api('/api/generate', { method: 'POST', body: JSON.stringify({ engine: 'zimage', prompt: 'MOCK_HANG a stuck render', aspect: '1:1', count: 1 }) }));
    let current = job;
    for (let i = 0; i < 50 && current.status !== 'running'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      current = await json(api(`/api/jobs/${job.id}`));
    }
    expect(current.status).toBe('running');
    await api(`/api/jobs/${job.id}/cancel`, { method: 'POST' });
    const after = await json(api(`/api/jobs/${job.id}?wait=5`));
    expect(after.status).toBe('canceled');
    // The queue keeps going afterwards.
    const next = await json(api('/api/generate', { method: 'POST', body: JSON.stringify({ engine: 'zimage', prompt: 'after the hang', aspect: '1:1', count: 1 }) }));
    expect((await json(api(`/api/jobs/${next.id}?wait=20`))).status).toBe('done');
  }, 30000);
});

const PLAN = {
  logline: 'Two rivals settle it in a closed bar.',
  characters: [
    { name: 'Rook', description: 'a wiry woman in her 30s, shaved head, leather jacket' },
    { name: 'Vance', description: 'a broad man in his 40s, grey beard, bartender apron' },
  ],
  locations: [{ name: 'The Anchor', description: 'a dim dockside bar with a long wooden counter' }],
  scenes: [
    {
      title: 'INT. THE ANCHOR - NIGHT',
      description: 'Closing time.',
      locationName: 'The Anchor',
      timeOfDay: 'night',
      blocking: [
        { character: 'Rook', x: 5, y: 4, facingDeg: 90 },
        { character: 'Vance', x: 7, y: 4, facingDeg: 270 },
      ],
      shots: [
        { action: 'Rook sets a coin on the counter.', shotSize: 'CU', cameraMove: 'push_in', characterNames: ['Rook'], durationSec: 4 },
        {
          action: 'Vance leans in.',
          dialogue: "We're closed.",
          shotSize: 'MS',
          cameraMove: 'static',
          characterNames: ['Rook', 'Vance'],
          durationSec: 5,
          cameraSide: 'front-left',
          keyframeMode: 'generate',
          keyframePrompt: 'two people across a bar counter, low light',
          motionPrompt: 'he leans forward slowly',
          seed: 42,
          blocking: [{ character: 'Vance', x: 6.5, y: 4, facingDeg: 270 }],
        },
        { action: 'The door swings shut.', durationSec: 3, camera: { x: 2, y: 7, targetX: 6, targetY: 4 } },
      ],
    },
  ],
};

describe('one-request storyboard', () => {
  let projectId: string;

  it('validates without writing and lists every problem at once', async () => {
    projectId = (await json(api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Closing Time', aspect: '16:9' }) }))).id;
    const bad = {
      ...PLAN,
      scenes: [{ ...PLAN.scenes[0], locationName: 'Nowhere', shots: [{ action: 'x', characterNames: ['Ghost'], durationSec: 30 }, { action: 'y', cameraMove: 'barrel_roll' }] }],
    };
    const res = await api(`/api/projects/${projectId}/storyboard?validate=1`, { method: 'POST', body: JSON.stringify(bad) });
    expect(res.status).toBe(422);
    const report = await json(res);
    expect(report.errors.join('\n')).toContain('cameraMove');

    const res2 = await api(`/api/projects/${projectId}/storyboard?validate=1`, {
      method: 'POST',
      body: JSON.stringify({ ...bad, scenes: [{ ...bad.scenes[0], shots: [bad.scenes[0].shots[0]] }] }),
    });
    const errors = (await json(res2)).errors.join('\n');
    expect(errors).toContain('"Nowhere"');
    expect(errors).toContain('"Ghost"');
    expect(errors).toMatch(/durationSec: 30 s doesn't fit Wan 2\.2/);

    const ok = await json(api(`/api/projects/${projectId}/storyboard?validate=1`, { method: 'POST', body: JSON.stringify(PLAN) }));
    expect(ok.ok).toBe(true);
    expect(ok.previews).toHaveLength(3);
    expect(ok.previews[1]).toMatchObject({ mode: 'generate', keyframePrompt: expect.stringContaining('bar counter') });
    expect(ok.previews[0].visibleCharacters).toEqual(['Rook']);
    expect(ok.estimate).toMatchObject({ frames: 3, clips: 3 });
    expect(ok.estimate.minutes[0]).toBeGreaterThan(0);

    const detail = await json(api(`/api/projects/${projectId}`));
    expect(detail.scenes).toHaveLength(0);
    const cast = await json<any[]>(api('/api/characters'));
    expect(cast.some((c) => c.name === 'Rook')).toBe(false);
  });

  it('writes the plan with every shot field, and a retried key adds nothing', async () => {
    const send = () => api(`/api/projects/${projectId}/storyboard`, { method: 'POST', headers: { 'Idempotency-Key': 'closing-1' }, body: JSON.stringify(PLAN) });
    const first = await send();
    expect(first.status).toBe(201);
    const body = await json(first);
    const shots = body.project.scenes[0].shots;
    expect(shots).toHaveLength(3);
    expect(shots[1]).toMatchObject({
      dialogue: "We're closed.",
      shotSize: 'MS',
      cameraMove: 'static',
      durationSec: 5,
      keyframeMode: 'generate',
      keyframePrompt: 'two people across a bar counter, low light',
      motionPrompt: 'he leans forward slowly',
      seed: 42,
    });
    expect(shots[1].characterIds).toHaveLength(2);
    expect(shots[1].blocking).toHaveLength(1);
    expect(shots[1].camera.auto).toBe(true);
    expect(shots[2].camera).toMatchObject({ pos: { x: 2, y: 7 }, target: { x: 6, y: 4 }, auto: false });
    expect(body.project.scenes[0].blocking.map((m: any) => m.pos)).toEqual([
      { x: 5, y: 4 },
      { x: 7, y: 4 },
    ]);
    expect(body.project.project.logline).toBe(PLAN.logline);

    const again = await send();
    expect(again.status).toBe(201);
    const detail = await json(api(`/api/projects/${projectId}`));
    expect(detail.scenes).toHaveLength(1);
    expect((await json<any[]>(api('/api/characters'))).filter((c) => c.name === 'Rook')).toHaveLength(1);
  });
});

describe('review and download', () => {
  let videoId: string;
  let imageId: string;

  it.skipIf(!hasFfmpeg)('makes a small contact sheet of a clip and a downscaled image', async () => {
    const clip = path.join(dataDir, 'test-clip.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=3', '-pix_fmt', 'yuv420p', clip]);
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(clip)], { type: 'video/mp4' }), 'test-clip.mp4');
    const video = await json(api('/api/uploads', { method: 'POST', body: form }));
    videoId = video.id;

    const res = await api(`/api/assets/${videoId}/frames?n=6&width=320`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-grid')).toBe('3x2');
    expect(res.headers.get('x-frame-times')!.split(',')).toHaveLength(6);
    const sheet = Buffer.from(await res.arrayBuffer());
    expect(sheet.length).toBeLessThan(300_000);
    const { probeImageSize } = await import('./pipeline/media');
    expect(probeImageSize(sheet)).toEqual({ width: 960, height: 360 });

    const png = path.join(dataDir, 'test.png');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=2048x1152', '-frames:v', '1', png]);
    const form2 = new FormData();
    form2.append('file', new Blob([fs.readFileSync(png)], { type: 'image/png' }), 'test.png');
    imageId = (await json(api('/api/uploads', { method: 'POST', body: form2 }))).id;
    const small = await api(`/api/assets/${imageId}/frames?width=320`);
    expect(probeImageSize(Buffer.from(await small.arrayBuffer())).width).toBe(960);
  }, 30000);

  it('signed links work without credentials until they expire, and not when tampered with', async () => {
    const assets = await json(api('/api/assets?kind=image&limit=1'));
    const id = imageId ?? assets.items[0].id;
    const link = await json(api(`/api/assets/${id}/link`, { method: 'POST' }));
    expect(link.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/dl\//);
    expect(link.url).not.toContain(TOKEN);
    const ok = await fetch(link.url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toContain('attachment');
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const parts = link.path.split('/');
    parts[4] = parts[4].slice(0, -2) + (parts[4].endsWith('AA') ? 'BB' : 'AA');
    expect((await fetch(`${base}${parts.join('/')}`)).status).toBe(403);
    const longer = link.path.split('/');
    longer[3] = String(Number(longer[3]) + 3600);
    expect((await fetch(`${base}${longer.join('/')}`)).status).toBe(403);

    const { signedPath, verifyLink } = await import('./links');
    const old = signedPath(id, 'x.png', Date.now() - 16 * 60 * 1000);
    expect((await fetch(`${base}${old.path}`)).status).toBe(403);
    const [, , lid, exp, sig] = signedPath(id, 'x.png').path.split('/');
    expect(verifyLink(lid!, exp!, sig!)).toBe(true);
    expect(verifyLink(lid!, exp!, sig!, Date.now() + 16 * 60 * 1000)).toBe(false);
  });
});

describe('MCP server', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: 'agent-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  });

  afterAll(async () => {
    await client.close();
  });

  it('needs the token and rejects other sites (DNS rebinding)', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(init) })).status).toBe(401);
    const auth = { ...headers, Authorization: `Bearer ${TOKEN}` };
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: { ...auth, Origin: 'https://evil.example' }, body: JSON.stringify(init) })).status).toBe(403);
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: { ...auth, Origin: base }, body: JSON.stringify(init) })).status).toBe(200);
  });

  it('lists the tools, none of which delete anything', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'animate_shots',
        'build_reference_sheet',
        'cancel_job',
        'choose_take',
        'create_storyboard',
        'export_film',
        'generate_character_sheets',
        'generate_frames',
        'generate_voices',
        'get_download_link',
        'get_project',
        'preview_shot',
        'review_asset',
        'set_voice',
        'studio_status',
        'update_project',
        'update_scene',
        'update_shot',
        'wait_for_jobs',
      ].sort(),
    );
    expect(names.some((n) => /delete|remove|setting/.test(n))).toBe(false);
    for (const t of tools) expect(t.description!.length).toBeGreaterThan(20);
    const storyboard = tools.find((t) => t.name === 'create_storyboard')!;
    expect(JSON.stringify(storyboard.inputSchema)).toContain('characterNames');
    expect(tools.find((t) => t.name === 'animate_shots')!.execution?.taskSupport).toBe('optional');
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: any[]; isError?: boolean };
    const textPart = res.content.find((c) => c.type === 'text');
    let data: any;
    try {
      data = textPart ? JSON.parse(textPart.text) : undefined;
    } catch {
      data = textPart?.text;
    }
    return { ...res, data };
  };

  const waitAll = async (jobIds: string[]) => {
    for (let i = 0; i < 20; i++) {
      const { data } = await call('wait_for_jobs', { jobIds, waitSec: 10 });
      if (data.allDone) return data;
    }
    throw new Error('jobs never finished');
  };

  it('makes a film end to end through /mcp only', async () => {
    const status = await call('studio_status');
    expect(status.data).toMatchObject({ engineOnline: true, clipSeconds: [2, 3, 4, 5, 6, 7] });

    const plan = { ...PLAN, characters: [{ name: 'Mara', description: 'a courier in a yellow raincoat' }], locations: [{ name: 'Pier 9', description: 'a foggy pier at night' }] };
    plan.scenes = [
      {
        title: 'EXT. PIER 9 - NIGHT',
        description: '',
        locationName: 'Pier 9',
        timeOfDay: 'night',
        blocking: [{ character: 'Mara', x: 6, y: 4, facingDeg: 180 }],
        shots: [
          { action: 'Mara checks her watch.', shotSize: 'MS', cameraMove: 'static', characterNames: ['Mara'], durationSec: 3 },
          { action: 'Mara looks out to sea.', shotSize: 'WS', cameraMove: 'pan_left', characterNames: ['Mara'], durationSec: 3 },
        ],
      },
    ] as any;
    const checked = await call('create_storyboard', { newProject: { name: 'Pier Nine', aspect: '16:9' }, plan, validate: true });
    expect(checked.data.ok).toBe(true);
    expect(checked.data.previews).toHaveLength(2);
    expect((await call('get_project')).data.some((p: any) => p.name === 'Pier Nine')).toBe(false);

    const created = await call('create_storyboard', { newProject: { name: 'Pier Nine', aspect: '16:9' }, plan, idempotencyKey: 'pier-1' });
    const projectId = created.data.project.project.id;
    // Retrying with the same key reuses the project instead of making another one.
    const retried = await call('create_storyboard', { newProject: { name: 'Pier Nine', aspect: '16:9' }, plan, idempotencyKey: 'pier-1' });
    expect(retried.data.project.project.id).toBe(projectId);
    expect(retried.data.project.scenes).toHaveLength(1);
    expect((await call('get_project')).data.filter((p: any) => p.name === 'Pier Nine')).toHaveLength(1);
    const shotIds = created.data.project.scenes[0].shots.map((s: any) => s.id);
    expect(shotIds).toHaveLength(2);

    const frames = await call('generate_frames', { projectId });
    expect(frames.data.jobIds.length).toBeGreaterThanOrEqual(2);
    expect(frames.data.next).toContain('wait_for_jobs');
    const framesDone = await waitAll(frames.data.jobIds);
    expect(framesDone.failed).toBe(0);

    const project = (await call('get_project', { projectId })).data;
    const shot = project.scenes[0].shots[0];
    expect(shot.status).toBe('keyframe_ready');
    const review = await call('review_asset', { assetId: shot.keyframeAssetId, width: 160 });
    const image = review.content.find((c: any) => c.type === 'image');
    expect(image.mimeType).toBe('image/jpeg');
    expect(Buffer.from(image.data, 'base64').length).toBeLessThan(300_000);

    const preview = await call('preview_shot', { shotId: shot.id });
    expect(preview.data.keyframePrompt).toContain('Mara');
    const updated = await call('update_shot', { shotId: shot.id, action: 'Mara checks her watch and frowns.' });
    expect(updated.data.action).toBe('Mara checks her watch and frowns.');

    const clips = await call('animate_shots', { projectId });
    expect(clips.data.jobIds).toHaveLength(2);
    expect((await waitAll(clips.data.jobIds)).failed).toBe(0);

    const film = await call('export_film', { projectId });
    const exported = await waitAll(film.data.jobIds);
    expect(exported.jobs[0].status).toBe('done');
    const exportAssetId = (await call('get_project', { projectId })).data.project.exportAssetId;
    expect(exportAssetId).toBeTruthy();
    const link = await call('get_download_link', { assetId: exportAssetId });
    expect((await fetch(link.data.url)).status).toBe(200);

    // Everything the agent queued is tagged as the agent's.
    const jobs = await json<any[]>(api(`/api/jobs?ids=${[...frames.data.jobIds, ...clips.data.jobIds].join(',')}`));
    expect(jobs.every((j) => j.actor === 'agent')).toBe(true);
  }, 90000);

  it('builds character sheets and a scene reference sheet, and sets scene previs fields, via MCP', async () => {
    const projects = (await call('get_project')).data;
    const projectId = projects.find((p: any) => p.name === 'Pier Nine').id;
    const before = (await call('get_project', { projectId })).data;
    const sceneId = before.scenes[0].id;
    expect(before.scenes[0].shots).toHaveLength(2);

    // MCP validation: previsCuts isn't an array of numbers → the REST route's 400 surfaces as a tool error.
    const badCuts = await call('update_scene', { sceneId, previsCuts: ['not-a-number' as unknown as number] });
    expect(badCuts.isError).toBe(true);

    const sheets = await call('generate_character_sheets', { characters: ['Mara'] });
    expect(sheets.data.jobIds).toHaveLength(2); // turnaround + face (Mara is a person, not a prop)
    expect((await waitAll(sheets.data.jobIds)).failed).toBe(0);

    // One fewer cut than the scene's 2 shots: sets shot 1's window to [0, 2) and recomputes its durationSec.
    const sceneUpdate = await call('update_scene', { sceneId, previsCuts: [2] });
    expect(sceneUpdate.data.previsCuts).toEqual([2]);
    const afterCuts = (await call('get_project', { projectId })).data;
    expect(afterCuts.scenes[0].shots[0].durationSec).toBe(2);

    const sheetJob = await call('build_reference_sheet', { sceneId });
    expect(sheetJob.data.id).toBeTruthy();
    expect((await waitAll([sheetJob.data.id])).failed).toBe(0);

    const finalProject = (await call('get_project', { projectId })).data;
    expect(finalProject.scenes[0].referenceSheetAssetId).toBeTruthy();
  }, 40000);

  it('returns tool errors the agent can act on', async () => {
    const res = await call('create_storyboard', { newProject: { name: 'Broken' }, plan: { scenes: [{ title: 'X', shots: [{ action: 'y', characterNames: ['Nobody'] }] }] }, validate: true });
    expect(res.data.ok).toBe(false);
    expect(res.data.errors.join()).toContain('"Nobody"');
    const missing = await call('get_project', { projectId: 'does-not-exist' });
    expect(missing.isError).toBe(true);
  });

  it('runs a long tool as an MCP task for clients that ask for one', async () => {
    const rpc = async (method: string, params: unknown, id: number) => {
      const res = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}`, 'MCP-Protocol-Version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      return (await res.json()) as any;
    };
    const projects = (await call('get_project')).data;
    const projectId = projects.find((p: any) => p.name === 'Pier Nine').id;
    const started = await rpc('tools/call', { name: 'generate_frames', arguments: { projectId, onlyMissing: false }, task: { ttl: 600000 } }, 10);
    const taskId = started.result.task.taskId;
    expect(taskId).toMatch(/^[0-9a-f]{32}$/);
    expect(started.result.task.status).toBe('working');
    let task = started.result.task;
    for (let i = 0; i < 60 && task.status === 'working'; i++) {
      await new Promise((r) => setTimeout(r, 250));
      task = (await rpc('tasks/get', { taskId }, 11)).result;
    }
    expect(task.status).toBe('completed');
    const result = (await rpc('tasks/result', { taskId }, 12)).result;
    expect(JSON.parse(result.content[0].text).allDone).toBe(true);
  }, 40000);
});

describe('logs', () => {
  it('never contain the agent token', () => {
    expect(logged.some((line) => line.includes('[agent]'))).toBe(true);
    expect(logged.join('\n')).not.toContain(TOKEN);
  });
});

describe('OpenAPI', () => {
  it('describes the agent routes, with the storyboard body from its schema', async () => {
    expect((await api('/api/openapi.json', { as: 'nobody' })).status).toBe(401);
    const doc = await json(api('/api/openapi.json'));
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api/projects/{id}/storyboard', '/api/jobs/{id}', '/api/assets/{id}/frames', '/api/assets/{id}/link']));
    const body = doc.paths['/api/projects/{id}/storyboard'].post.requestBody.content['application/json'].schema;
    expect(body.required).toEqual(['scenes']);
    expect(JSON.stringify(body)).toContain('characterNames');
    expect(doc.components.securitySchemes.agentToken.scheme).toBe('bearer');
  });
});

describe('storyboard env', () => {
  it('counts an edit model that is still downloading as coming, and says so', async () => {
    const { storyboardEnvFrom } = await import('./storyboard');
    const info = (editReady: boolean, enabled = true) =>
      ({
        videoModel: 'minimax_h3',
        comfy: { vramTotalMB: 32000 },
        engines: { qwen_edit: editReady },
        models: [{ id: 'edit', enabled, ready: editReady }],
      }) as any;
    expect(storyboardEnvFrom(info(false))).toMatchObject({ editEngineAvailable: true, editDownloading: true });
    expect(storyboardEnvFrom(info(true))).toMatchObject({ editEngineAvailable: true, editDownloading: false });
    expect(storyboardEnvFrom(info(false, false))).toMatchObject({ editEngineAvailable: false, editDownloading: false });
  });
});

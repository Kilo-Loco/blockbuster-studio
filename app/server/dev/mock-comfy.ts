// Fake ComfyUI server for local dev and e2e tests. Implements just enough of the real
// ComfyUI HTTP + WebSocket surface for server/comfy/client.ts to drive it end-to-end
// without a GPU or real ComfyUI install.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer, type WebSocket } from 'ws';
import { MODEL_FILES } from '../comfy/workflows';

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────── config ───────────────────────────────────────────

const PORT = Number(process.env.MOCK_COMFY_PORT ?? 8188);
const HOST = '0.0.0.0';
const MOCK_DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? '200');
const OUTPUT_ROOT = process.env.MOCK_COMFY_OUTPUT_DIR ?? path.join(os.tmpdir(), 'bb-mock-comfy');
const OUTPUT_DIR = path.join(OUTPUT_ROOT, 'output');
const INPUT_DIR = path.join(OUTPUT_ROOT, 'input');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(INPUT_DIR, { recursive: true });

// ─────────────────────────────────────────── known node types ───────────────────────────────────────────

const KNOWN_CLASS_TYPES = new Set([
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'LoraLoaderModelOnly',
  'ModelSamplingAuraFlow',
  'CLIPTextEncode',
  'ConditioningZeroOut',
  'EmptySD3LatentImage',
  'KSampler',
  'VAEDecode',
  'SaveImage',
  'LoadImage',
  'FluxKontextImageScale',
  'CFGNorm',
  'TextEncodeQwenImageEditPlus',
  'FluxKontextMultiReferenceLatentMethod',
  'VAEEncode',
  'ModelSamplingSD3',
  'KSamplerAdvanced',
  'WanImageToVideo',
  'WanFirstLastFrameToVideo',
  'EmptyHunyuanLatentVideo',
  'CreateVideo',
  'SaveVideo',
  // Wan Animate 2 (Perform)
  'CLIPVisionLoader',
  'CLIPVisionEncode',
  'WanAnimate2Cache',
  'WanAnimate2ToVideo',
  'BasicScheduler',
  'KSamplerSelect',
  'SamplerCustom',
  'TrimVideoLatent',
  'LoadVideo',
  'GetVideoComponents',
  'ResizeImageMaskNode',
  'GetImageSize',
  'ImageFromBatch',
  'BatchImagesNode',
  // MiniMax H3 (opt-in video backend)
  'MiniMaxH3ImageToVideo',
  'RandomNoise',
  'BasicGuider',
  'SamplerCustomAdvanced',
  'VAEDecodeAudio',
]);

type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } };
type ApiWorkflow = Record<string, ApiNode>;

// ─────────────────────────────────────────── in-memory state ───────────────────────────────────────────

interface HistoryEntry {
  status: { completed: boolean; status_str: string };
  outputs: Record<string, { images: Array<Record<string, unknown>> }>;
}

const history = new Map<string, HistoryEntry>();
const sockets = new Map<string, Set<WebSocket>>();
const allSockets = new Set<WebSocket>();
let queueCounter = 0;
let currentInterrupt: { promptId: string; cancel: () => void } | null = null;
let saveImageCounter = 0;
let saveVideoCounter = 0;

function broadcast(clientId: string | undefined, msg: unknown) {
  const payload = JSON.stringify(msg);
  const targets = clientId ? sockets.get(clientId) : undefined;
  if (targets && targets.size > 0) {
    for (const ws of targets) ws.readyState === ws.OPEN && ws.send(payload);
    return;
  }
  for (const ws of allSockets) ws.readyState === ws.OPEN && ws.send(payload);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────── minimal PNG encoder ───────────────────────────────────────────

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

/** Encode a simple colorful-gradient RGB PNG using only node's zlib. */
function encodeGradientPng(width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter type 0 (none)
    for (let x = 0; x < width; x++) {
      raw[offset++] = Math.floor((x / Math.max(1, width - 1)) * 255); // R
      raw[offset++] = Math.floor((y / Math.max(1, height - 1)) * 255); // G
      raw[offset++] = Math.floor(((x + y) / Math.max(1, width + height - 2)) * 255); // B
    }
  }
  const idat = zlib.deflateSync(raw);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ─────────────────────────────────────────── workflow inspection helpers ───────────────────────────────────────────

function findNodeByClass(workflow: ApiWorkflow, classType: string): ApiNode | undefined {
  return Object.values(workflow).find((n) => n.class_type === classType);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ─────────────────────────────────────────── output generation ───────────────────────────────────────────

async function produceSaveImageOutputs(node: ApiNode, workflow: ApiWorkflow): Promise<Array<Record<string, unknown>>> {
  const latentNode = findNodeByClass(workflow, 'EmptySD3LatentImage');
  const width = num(latentNode?.inputs.width, 1344);
  const height = num(latentNode?.inputs.height, 768);
  const batchSize = num(latentNode?.inputs.batch_size, 1);

  const prefix = String(node.inputs.filename_prefix ?? 'studio/image').replace(/\//g, '_');
  const subfolder = 'studio';
  const dir = path.join(OUTPUT_DIR, subfolder);
  await fsp.mkdir(dir, { recursive: true });

  const png = encodeGradientPng(width, height);
  const images: Array<Record<string, unknown>> = [];
  for (let i = 0; i < batchSize; i++) {
    saveImageCounter++;
    const filename = `${prefix}_${saveImageCounter}_.png`;
    await fsp.writeFile(path.join(dir, filename), png);
    images.push({ filename, subfolder, type: 'output' });
  }
  return images;
}

let cachedPlaceholderMp4: Buffer | null = null;
let ffmpegChecked = false;
let ffmpegAvailable = false;

async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked) return ffmpegAvailable;
  ffmpegChecked = true;
  try {
    await execFileAsync('which', ['ffmpeg']);
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

async function produceSaveVideoOutputs(node: ApiNode, workflow: ApiWorkflow): Promise<Array<Record<string, unknown>>> {
  const createVideoNode = findNodeByClass(workflow, 'CreateVideo');
  const fps = num(createVideoNode?.inputs.fps, 16);
  const latentSourceNode =
    findNodeByClass(workflow, 'WanImageToVideo') ??
    findNodeByClass(workflow, 'WanFirstLastFrameToVideo') ??
    findNodeByClass(workflow, 'EmptyHunyuanLatentVideo');
  const width = num(latentSourceNode?.inputs.width, 832);
  const height = num(latentSourceNode?.inputs.height, 480);
  const length = num(latentSourceNode?.inputs.length, 49);

  const prefix = String(node.inputs.filename_prefix ?? 'studio/video').replace(/\//g, '_');
  const subfolder = 'studio';
  const dir = path.join(OUTPUT_DIR, subfolder);
  await fsp.mkdir(dir, { recursive: true });

  saveVideoCounter++;
  const filename = `${prefix}_${saveVideoCounter}_.mp4`;
  const outPath = path.join(dir, filename);

  if (await hasFfmpeg()) {
    const durationSec = Math.max(0.5, length / Math.max(1, fps));
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${width}x${height}:rate=${fps}`,
      '-t',
      String(durationSec),
      '-pix_fmt',
      'yuv420p',
      outPath,
    ]);
  } else {
    if (!cachedPlaceholderMp4) cachedPlaceholderMp4 = Buffer.from('mock-mp4');
    await fsp.writeFile(outPath, cachedPlaceholderMp4);
  }

  return [{ filename, subfolder, type: 'output', animated: [true] }];
}

// ─────────────────────────────────────────── execution simulation ───────────────────────────────────────────

async function runPrompt(promptId: string, workflow: ApiWorkflow, clientId: string) {
  history.set(promptId, { status: { completed: false, status_str: 'running' }, outputs: {} });

  let interrupted = false;
  const cancel = () => {
    interrupted = true;
  };
  currentInterrupt = { promptId, cancel };

  broadcast(clientId, { type: 'execution_start', data: { prompt_id: promptId } });

  const nodeIds = Object.keys(workflow);
  const perNodeDelay = Math.max(1, Math.floor(MOCK_DELAY_MS / Math.max(1, nodeIds.length)));

  for (const nodeId of nodeIds) {
    if (interrupted) break;
    const node = workflow[nodeId]!;
    broadcast(clientId, { type: 'executing', data: { node: nodeId, prompt_id: promptId } });

    if (/KSampler|SamplerCustom/.test(node.class_type)) {
      const steps = num(node.inputs.steps, 4);
      const frames = Math.min(steps, 5) || 1;
      const stepDelay = Math.max(1, Math.floor(perNodeDelay / frames));
      for (let i = 0; i <= frames; i++) {
        if (interrupted) break;
        const value = Math.round((i / frames) * steps);
        broadcast(clientId, { type: 'progress', data: { node: nodeId, value, max: steps, prompt_id: promptId } });
        await sleep(stepDelay);
      }
    } else {
      await sleep(perNodeDelay);
    }

    if (interrupted) break;

    if (node.class_type === 'SaveImage') {
      const images = await produceSaveImageOutputs(node, workflow);
      const entry = history.get(promptId);
      if (entry) entry.outputs[nodeId] = { images };
    } else if (node.class_type === 'SaveVideo') {
      const images = await produceSaveVideoOutputs(node, workflow);
      const entry = history.get(promptId);
      if (entry) entry.outputs[nodeId] = { images };
    }
  }

  if (currentInterrupt?.promptId === promptId) currentInterrupt = null;

  if (interrupted) {
    const entry = history.get(promptId);
    if (entry) entry.status = { completed: false, status_str: 'error' };
    broadcast(clientId, { type: 'execution_interrupted', data: { prompt_id: promptId } });
    return;
  }

  broadcast(clientId, { type: 'executing', data: { node: null, prompt_id: promptId } });
  const entry = history.get(promptId);
  if (entry) entry.status = { completed: true, status_str: 'success' };
  broadcast(clientId, { type: 'execution_success', data: { prompt_id: promptId } });
}

// ─────────────────────────────────────────── object_info / models ───────────────────────────────────────────

// MOCK_MINIMAX=1 also "installs" the opt-in MiniMax H3 files.
const H3 = process.env.MOCK_MINIMAX === '1' ? MODEL_FILES.minimax : undefined;
const ALL_UNET_FILES = [MODEL_FILES.zimage.unet, MODEL_FILES.qwenEdit.unet, MODEL_FILES.animate.unet, ...(H3 ? [H3.unet] : [])];
const ALL_CLIP_FILES = [MODEL_FILES.zimage.clip, MODEL_FILES.qwenEdit.clip, MODEL_FILES.wan.clip, ...(H3 ? [H3.clip] : [])];
const ALL_VAE_FILES = [MODEL_FILES.zimage.vae, MODEL_FILES.qwenEdit.vae, MODEL_FILES.wan.vae, ...(H3 ? [H3.vae, H3.audioVae] : [])];
const ALL_LORA_FILES = [
  ...(H3 ? [H3.turbo] : []),
  MODEL_FILES.qwenEdit.lightning,
  MODEL_FILES.qwenEdit.angles,
  MODEL_FILES.wan.i2vHigh,
  MODEL_FILES.wan.i2vLow,
  MODEL_FILES.wan.i2vLightningHigh,
  MODEL_FILES.wan.i2vLightningLow,
  MODEL_FILES.wan.t2vHigh,
  MODEL_FILES.wan.t2vLow,
  MODEL_FILES.wan.t2vLightningHigh,
  MODEL_FILES.wan.t2vLightningLow,
];

// diffusion_models folder also hosts the Wan unet-style checkpoints.
const DIFFUSION_MODELS_FOLDER = [
  ...ALL_UNET_FILES,
  MODEL_FILES.wan.i2vHigh,
  MODEL_FILES.wan.i2vLow,
  MODEL_FILES.wan.t2vHigh,
  MODEL_FILES.wan.t2vLow,
];

function buildObjectInfo(): Record<string, unknown> {
  return {
    UNETLoader: { input: { required: { unet_name: [ALL_UNET_FILES] } } },
    CLIPLoader: { input: { required: { clip_name: [ALL_CLIP_FILES] } } },
    VAELoader: { input: { required: { vae_name: [ALL_VAE_FILES] } } },
    LoraLoaderModelOnly: { input: { required: { lora_name: [ALL_LORA_FILES] } } },
    CLIPVisionLoader: { input: { required: { clip_name: [[MODEL_FILES.animate.clipVision]] } } },
    ...(H3 ? { MiniMaxH3ImageToVideo: { input: { required: {} } } } : {}),
  };
}

const MODELS_BY_FOLDER: Record<string, string[]> = {
  diffusion_models: DIFFUSION_MODELS_FOLDER,
  text_encoders: ALL_CLIP_FILES,
  vae: ALL_VAE_FILES,
  loras: ALL_LORA_FILES,
};

// ─────────────────────────────────────────── HTTP routes ───────────────────────────────────────────

const app = new Hono();

app.post('/prompt', async (c) => {
  const body = await c.req.json<{ prompt: ApiWorkflow; client_id: string }>().catch(() => null);
  if (!body || !body.prompt) {
    return c.json({ error: 'invalid prompt', node_errors: {} }, 400);
  }
  const nodeErrors: Record<string, unknown> = {};
  for (const [nodeId, node] of Object.entries(body.prompt)) {
    if (!KNOWN_CLASS_TYPES.has(node.class_type)) {
      nodeErrors[nodeId] = { type: 'invalid_class_type', message: `Unknown class_type: ${node.class_type}` };
    }
  }
  if (Object.keys(nodeErrors).length > 0) {
    return c.json({ error: 'invalid prompt', node_errors: nodeErrors }, 400);
  }

  const promptId = crypto.randomUUID();
  const number = ++queueCounter;
  void runPrompt(promptId, body.prompt, body.client_id);
  return c.json({ prompt_id: promptId, number, node_errors: {} });
});

app.get('/history/:id', (c) => {
  const id = c.req.param('id');
  const entry = history.get(id);
  if (!entry) return c.json({});
  return c.json({ [id]: { status: entry.status, outputs: entry.outputs } });
});

app.get('/view', async (c) => {
  const filename = c.req.query('filename') ?? '';
  const subfolder = c.req.query('subfolder') ?? '';
  const filePath = path.join(OUTPUT_DIR, subfolder, filename);
  try {
    const data = await fsp.readFile(filePath);
    const contentType = filename.endsWith('.mp4') ? 'video/mp4' : filename.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': contentType } });
  } catch {
    return c.text('not found', 404);
  }
});

app.post('/upload/image', async (c) => {
  const form = await c.req.formData();
  const file = form.get('image');
  if (!file || typeof file === 'string') {
    return c.json({ error: 'missing image field' }, 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const name = (file as File).name || `upload_${crypto.randomUUID()}.png`;
  await fsp.writeFile(path.join(INPUT_DIR, name), buf);
  return c.json({ name, subfolder: '', type: 'input' });
});

app.post('/interrupt', async (c) => {
  currentInterrupt?.cancel();
  return c.json({});
});

app.post('/free', async (c) => {
  await c.req.json().catch(() => ({}));
  return c.json({});
});

app.get('/system_stats', (c) => {
  return c.json({
    system: {},
    devices: [
      {
        name: 'NVIDIA GeForce RTX 4090',
        vram_total: 24564 * 1024 * 1024,
        vram_free: 20000 * 1024 * 1024,
      },
    ],
  });
});

app.get('/queue', (c) => {
  return c.json({ queue_running: [], queue_pending: [] });
});

app.get('/object_info', (c) => {
  return c.json(buildObjectInfo());
});

app.get('/object_info/:nodeClass', (c) => {
  const nodeClass = c.req.param('nodeClass');
  const info = buildObjectInfo();
  return c.json({ [nodeClass]: info[nodeClass] ?? { input: { required: {} } } });
});

app.get('/models/:folder', (c) => {
  const folder = c.req.param('folder');
  return c.json(MODELS_BY_FOLDER[folder] ?? []);
});

// ─────────────────────────────────────────── server + websocket ───────────────────────────────────────────

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`Mock ComfyUI listening on http://${HOST}:${info.port}`);
});

const wss = new WebSocketServer({ server: server as unknown as import('node:http').Server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const clientId = url.searchParams.get('clientId') ?? undefined;

  allSockets.add(ws);
  if (clientId) {
    if (!sockets.has(clientId)) sockets.set(clientId, new Set());
    sockets.get(clientId)!.add(ws);
  }

  ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } } } }));

  ws.on('close', () => {
    allSockets.delete(ws);
    if (clientId) sockets.get(clientId)?.delete(ws);
  });
});

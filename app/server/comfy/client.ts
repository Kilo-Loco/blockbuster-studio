// ComfyUI HTTP/WS client: queue prompts, track progress, fetch outputs.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { ApiWorkflow } from './workflows';
import { COMFY_OUTPUT_DIR } from '../config';

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string; // 'output' | 'temp' | 'input'
  isVideo: boolean;
}

export interface SystemStats {
  online: boolean;
  gpuName?: string;
  vramTotalMB?: number;
  vramFreeMB?: number;
  queueRemaining: number;
}

interface NodeErrorPayload {
  error?: unknown;
  node_errors?: Record<string, unknown>;
}

function formatNodeErrors(body: NodeErrorPayload): string {
  const parts: string[] = [];
  if (body.error) parts.push(typeof body.error === 'string' ? body.error : JSON.stringify(body.error));
  const nodeErrors = body.node_errors ?? {};
  for (const [nodeId, err] of Object.entries(nodeErrors)) {
    parts.push(`node ${nodeId}: ${JSON.stringify(err)}`);
  }
  return parts.length ? parts.join('; ') : 'ComfyUI rejected the prompt';
}

type WsMessage = { type: string; data: any };
type PromptWaiter = {
  promptId: string;
  samplerIds: string[];
  nodeOrder: string[];
  progressByNode: Map<string, number>;
  currentNode: string | null;
  seenNodes: Set<string>;
  onProgress?: (frac: number, stage?: string) => void;
  resolve: () => void;
  reject: (err: Error) => void;
  settled: boolean;
  pollTimer?: NodeJS.Timeout;
};

export class ComfyClient {
  readonly baseUrl: string;
  readonly clientId: string;
  private ws: WebSocket | null = null;
  private wsConnecting = false;
  private reconnectDelay = 1000;
  private waiters = new Map<string, PromptWaiter>();
  private closed = false;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.clientId = crypto.randomUUID();
    this.connectWs();
  }

  private wsUrl(): string {
    return this.baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${this.clientId}`;
  }

  private connectWs() {
    if (this.closed || this.wsConnecting) return;
    this.wsConnecting = true;
    let sock: WebSocket;
    try {
      sock = new WebSocket(this.wsUrl());
    } catch {
      this.wsConnecting = false;
      this.scheduleReconnect();
      return;
    }
    sock.on('open', () => {
      this.wsConnecting = false;
      this.reconnectDelay = 1000;
    });
    sock.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        this.handleMessage(msg);
      } catch {
        // ignore malformed frames
      }
    });
    sock.on('close', () => {
      this.wsConnecting = false;
      this.ws = null;
      this.scheduleReconnect();
    });
    sock.on('error', () => {
      // 'close' follows; nothing else to do here
    });
    this.ws = sock;
  }

  private scheduleReconnect() {
    if (this.closed) return;
    setTimeout(() => this.connectWs(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private handleMessage(msg: WsMessage) {
    const data = msg.data ?? {};
    const promptId: string | undefined = data.prompt_id;
    if (!promptId) return;
    const waiter = this.waiters.get(promptId);
    if (!waiter || waiter.settled) return;

    if (msg.type === 'executing') {
      const node: string | null = data.node ?? null;
      if (node === null) {
        // Execution finished for this prompt (Comfy sends node:null when the queue item completes).
        this.settleWaiter(waiter, () => waiter.resolve());
        return;
      }
      if (waiter.currentNode && waiter.samplerIds.includes(waiter.currentNode)) {
        waiter.progressByNode.set(waiter.currentNode, 1);
      }
      waiter.currentNode = node;
      waiter.seenNodes.add(node);
      this.reportProgress(waiter);
    } else if (msg.type === 'progress') {
      const node: string | undefined = data.node;
      const value = Number(data.value ?? 0);
      const max = Number(data.max ?? 1) || 1;
      if (node) waiter.progressByNode.set(node, Math.min(1, value / max));
      this.reportProgress(waiter);
    } else if (msg.type === 'execution_success') {
      this.settleWaiter(waiter, () => waiter.resolve());
    } else if (msg.type === 'execution_error') {
      const message = data.exception_message || data.exception_type || 'ComfyUI execution error';
      this.settleWaiter(waiter, () => waiter.reject(new Error(`ComfyUI execution error: ${message}`)));
    } else if (msg.type === 'execution_interrupted') {
      this.settleWaiter(waiter, () => waiter.reject(new Error('canceled')));
    }
  }

  private reportProgress(waiter: PromptWaiter) {
    if (!waiter.onProgress) return;
    let frac: number;
    if (waiter.samplerIds.length > 0) {
      const sum = waiter.samplerIds.reduce((acc, id) => acc + (waiter.progressByNode.get(id) ?? 0), 0);
      frac = sum / waiter.samplerIds.length;
    } else {
      const total = Math.max(1, waiter.nodeOrder.length);
      const idx = waiter.currentNode ? waiter.nodeOrder.indexOf(waiter.currentNode) : 0;
      const within = waiter.currentNode ? (waiter.progressByNode.get(waiter.currentNode) ?? 0) : 0;
      frac = Math.max(0, idx) / total + within / total;
    }
    waiter.onProgress(Math.max(0, Math.min(1, frac)), waiter.currentNode ?? undefined);
  }

  private settleWaiter(waiter: PromptWaiter, action: () => void) {
    if (waiter.settled) return;
    waiter.settled = true;
    if (waiter.pollTimer) clearInterval(waiter.pollTimer);
    this.waiters.delete(waiter.promptId);
    action();
  }

  async queuePrompt(workflow: ApiWorkflow): Promise<string> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    const body = (await res.json().catch(() => ({}))) as { prompt_id?: string } & NodeErrorPayload;
    const hasNodeErrors = body.node_errors && Object.keys(body.node_errors).length > 0;
    if (!res.ok || !body.prompt_id || hasNodeErrors) {
      throw new Error(formatNodeErrors(body));
    }
    return body.prompt_id;
  }

  /** Wait for a queued prompt to finish, reporting fractional progress (0..1). */
  async waitFor(promptId: string, workflow: ApiWorkflow, onProgress?: (frac: number, stage?: string) => void): Promise<void> {
    const nodeOrder = Object.keys(workflow);
    const samplerIds = nodeOrder.filter((id) => /KSampler|SamplerCustom/.test(workflow[id]!.class_type));

    return new Promise<void>((resolve, reject) => {
      const waiter: PromptWaiter = {
        promptId,
        samplerIds,
        nodeOrder,
        progressByNode: new Map(),
        currentNode: null,
        seenNodes: new Set(),
        onProgress,
        resolve,
        reject,
        settled: false,
      };
      this.waiters.set(promptId, waiter);

      // Polling fallback in case the websocket drops: check /history every 3s.
      waiter.pollTimer = setInterval(async () => {
        try {
          const hist = await this.getHistory(promptId);
          if (!hist) return;
          const status = hist.status;
          if (status?.completed === true || status?.status_str === 'success') {
            this.settleWaiter(waiter, () => resolve());
          } else if (status?.status_str === 'error') {
            this.settleWaiter(waiter, () => reject(new Error('ComfyUI execution error (from history)')));
          }
        } catch {
          // ComfyUI unreachable; keep waiting, ws reconnect logic handles it
        }
      }, 3000);
    });
  }

  private async getHistory(promptId: string): Promise<{ outputs?: Record<string, any>; status?: any } | undefined> {
    const res = await fetch(`${this.baseUrl}/history/${promptId}`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, any>;
    return body[promptId];
  }

  async getOutputs(promptId: string): Promise<ComfyOutputFile[]> {
    const hist = await this.getHistory(promptId);
    const files: ComfyOutputFile[] = [];
    const outputs = hist?.outputs ?? {};
    for (const node of Object.values(outputs) as any[]) {
      const images = node.images ?? node.gifs ?? [];
      for (const img of images) {
        // Only saved results. Nodes like LoadVideo also report a UI preview of their *input*
        // (type 'input'), and preview nodes write to 'temp'; neither is a generation result.
        if ((img.type ?? 'output') !== 'output') continue;
        const animated = Array.isArray(img.animated) ? img.animated.some(Boolean) : Boolean(img.animated);
        const isVideo = animated || /\.(mp4|webm|mov)$/i.test(img.filename ?? '');
        files.push({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output', isVideo });
      }
    }
    return files;
  }

  async downloadOutput(file: ComfyOutputFile): Promise<Buffer> {
    if (COMFY_OUTPUT_DIR) {
      const p = path.join(COMFY_OUTPUT_DIR, file.subfolder, file.filename);
      return fs.readFile(p);
    }
    const qs = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
    const res = await fetch(`${this.baseUrl}/view?${qs.toString()}`);
    if (!res.ok) throw new Error(`Failed to download ${file.filename} from ComfyUI: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Upload a local buffer as a ComfyUI input image; returns the name to use in LoadImage. */
  async uploadImage(buffer: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(buffer)]), filename);
    form.append('overwrite', 'true');
    const res = await fetch(`${this.baseUrl}/upload/image`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Failed to upload image to ComfyUI: ${res.status}`);
    const body = (await res.json()) as { name: string; subfolder?: string };
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  }

  async interrupt(): Promise<void> {
    await fetch(`${this.baseUrl}/interrupt`, { method: 'POST' }).catch(() => undefined);
  }

  async free(): Promise<void> {
    await fetch(`${this.baseUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    }).catch(() => undefined);
  }

  async systemStats(): Promise<SystemStats> {
    try {
      const [statsRes, queueRes] = await Promise.all([
        fetch(`${this.baseUrl}/system_stats`, { signal: AbortSignal.timeout(4000) }),
        fetch(`${this.baseUrl}/queue`, { signal: AbortSignal.timeout(4000) }),
      ]);
      if (!statsRes.ok) return { online: false, queueRemaining: 0 };
      const stats = (await statsRes.json()) as { devices?: any[] };
      const device = stats.devices?.[0];
      let queueRemaining = 0;
      if (queueRes.ok) {
        const q = (await queueRes.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
        queueRemaining = (q.queue_running?.length ?? 0) + (q.queue_pending?.length ?? 0);
      }
      return {
        online: true,
        // ComfyUI reports e.g. "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync"; keep just the model name.
        gpuName: device?.name?.replace(/^cuda:\d+\s+/, "").replace(/\s+:\s+\S+$/, "").replace(/^NVIDIA (GeForce )?/, ""),
        vramTotalMB: device?.vram_total ? Math.round(device.vram_total / (1024 * 1024)) : undefined,
        vramFreeMB: device?.vram_free ? Math.round(device.vram_free / (1024 * 1024)) : undefined,
        queueRemaining,
      };
    } catch {
      return { online: false, queueRemaining: 0 };
    }
  }

  async isOnline(): Promise<boolean> {
    return (await this.systemStats()).online;
  }

  async objectInfo(nodeClass?: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/object_info${nodeClass ? '/' + nodeClass : ''}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`object_info failed: ${res.status}`);
    return res.json();
  }
}

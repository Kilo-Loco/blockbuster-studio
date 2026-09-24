// ComfyUI API-format workflow builders.
//
// Every graph here mirrors a Comfy-Org official template (workflow_templates repo, Sept 2026):
//   image_z_image_turbo.json, image_qwen_image_edit_2511.json, video_wan2_2_14B_i2v.json, video_wan2_2_14B_t2v.json
// and is validated against a real ComfyUI instance by `npm run validate:workflows`.

export type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } };
export type ApiWorkflow = Record<string, ApiNode>;
type Link = [string, number];

export const MODEL_FILES = {
  zimage: {
    unet: 'z_image_turbo_bf16.safetensors',
    clip: 'qwen_3_4b.safetensors',
    vae: 'ae.safetensors',
  },
  qwenEdit: {
    unet: 'qwen_image_edit_2511_fp8mixed.safetensors',
    clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    lightning: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
    angles: 'qwen-image-edit-2511-multiple-angles-lora.safetensors',
  },
  wan: {
    clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    vae: 'wan_2.1_vae.safetensors',
    i2vHigh: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    i2vLow: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
    i2vLightningHigh: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
    i2vLightningLow: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    t2vHigh: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
    t2vLow: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
    t2vLightningHigh: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
    t2vLightningLow: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
  },
} as const;

export interface LoraFile {
  filename: string;
  strength: number;
  /** Wan only. */
  expert?: 'high' | 'low' | 'both';
}

/** Small graph builder with auto-incrementing string IDs. */
class Graph {
  private n = 0;
  readonly nodes: ApiWorkflow = {};
  add(class_type: string, inputs: Record<string, unknown>, title?: string): string {
    const id = String(++this.n);
    this.nodes[id] = { class_type, inputs, ...(title ? { _meta: { title } } : {}) };
    return id;
  }
  out(id: string, index = 0): Link {
    return [id, index];
  }
}

function chainLoras(g: Graph, model: Link, loras: LoraFile[]): Link {
  let m = model;
  for (const l of loras) {
    if (!l.filename || l.strength === 0) continue;
    m = g.out(g.add('LoraLoaderModelOnly', { model: m, lora_name: l.filename, strength_model: l.strength }));
  }
  return m;
}

const clampSeed = (seed: number) => Math.abs(Math.floor(seed)) % 2 ** 50;

// ───────────────────────────── Z-Image Turbo (text → image) ─────────────────────────────

export interface ZImageParams {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  batch?: number;
  steps?: number; // template: 8
  loras?: LoraFile[];
  filenamePrefix?: string;
}

export function buildZImage(p: ZImageParams): ApiWorkflow {
  const g = new Graph();
  const unet = g.add('UNETLoader', { unet_name: MODEL_FILES.zimage.unet, weight_dtype: 'default' });
  const clip = g.add('CLIPLoader', { clip_name: MODEL_FILES.zimage.clip, type: 'lumina2', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: MODEL_FILES.zimage.vae });
  const model = chainLoras(g, g.out(unet), p.loras ?? []);
  const sampling = g.add('ModelSamplingAuraFlow', { model, shift: 3 });
  const pos = g.add('CLIPTextEncode', { text: p.prompt, clip: g.out(clip) });
  const neg = g.add('ConditioningZeroOut', { conditioning: g.out(pos) });
  const latent = g.add('EmptySD3LatentImage', { width: p.width, height: p.height, batch_size: p.batch ?? 1 });
  const ks = g.add('KSampler', {
    model: g.out(sampling),
    seed: clampSeed(p.seed),
    steps: p.steps ?? 8,
    cfg: 1,
    sampler_name: 'res_multistep',
    scheduler: 'simple',
    denoise: 1,
    positive: g.out(pos),
    negative: g.out(neg),
    latent_image: g.out(latent),
  });
  const dec = g.add('VAEDecode', { samples: g.out(ks), vae: g.out(vae) });
  g.add('SaveImage', { images: g.out(dec), filename_prefix: p.filenamePrefix ?? 'studio/zimage' }, 'output');
  return g.nodes;
}

// ───────────────────────────── Qwen-Image-Edit 2511 (image(s) + instruction → image) ─────────────────────────────

export interface QwenEditParams {
  /** ComfyUI input filenames (already uploaded). 1..3; image 1 is the canvas/base. */
  images: string[];
  prompt: string;
  seed: number;
  /** Use the multi-angle LoRA (prompt must then be `<sks> …`). */
  angles?: boolean;
  loras?: LoraFile[];
  /** Lightning 4-step (default) or the full 40-step / cfg 3 path. */
  fast?: boolean;
  filenamePrefix?: string;
}

export function buildQwenEdit(p: QwenEditParams): ApiWorkflow {
  if (p.images.length < 1 || p.images.length > 3) throw new Error('Qwen edit needs 1–3 images');
  const fast = p.fast ?? true;
  const g = new Graph();
  const unet = g.add('UNETLoader', { unet_name: MODEL_FILES.qwenEdit.unet, weight_dtype: 'default' });
  const clip = g.add('CLIPLoader', { clip_name: MODEL_FILES.qwenEdit.clip, type: 'qwen_image', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: MODEL_FILES.qwenEdit.vae });

  const loaded = p.images.map((image) => g.add('LoadImage', { image }));
  const base = g.add('FluxKontextImageScale', { image: g.out(loaded[0]) });
  const imageInputs: Record<string, Link> = { image1: g.out(base) };
  loaded.slice(1).forEach((id, i) => (imageInputs[`image${i + 2}`] = g.out(id)));

  // Model chain matches the template: AuraFlow shift → CFGNorm → Lightning LoRA → extra LoRAs.
  const sampling = g.add('ModelSamplingAuraFlow', { model: g.out(unet), shift: 3.1 });
  const cfgNorm = g.add('CFGNorm', { model: g.out(sampling), strength: 1 });
  const extra: LoraFile[] = [
    ...(fast ? [{ filename: MODEL_FILES.qwenEdit.lightning, strength: 1 }] : []),
    ...(p.angles ? [{ filename: MODEL_FILES.qwenEdit.angles, strength: 1 }] : []),
    ...(p.loras ?? []),
  ];
  const model = chainLoras(g, g.out(cfgNorm), extra);

  const posEnc = g.add('TextEncodeQwenImageEditPlus', { clip: g.out(clip), vae: g.out(vae), prompt: p.prompt, ...imageInputs });
  const negEnc = g.add('TextEncodeQwenImageEditPlus', { clip: g.out(clip), vae: g.out(vae), prompt: '', ...imageInputs });
  const pos = g.add('FluxKontextMultiReferenceLatentMethod', { conditioning: g.out(posEnc), reference_latents_method: 'index_timestep_zero' });
  const neg = g.add('FluxKontextMultiReferenceLatentMethod', { conditioning: g.out(negEnc), reference_latents_method: 'index_timestep_zero' });
  const latent = g.add('VAEEncode', { pixels: g.out(base), vae: g.out(vae) });
  const ks = g.add('KSampler', {
    model,
    seed: clampSeed(p.seed),
    steps: fast ? 4 : 40,
    cfg: fast ? 1 : 3,
    sampler_name: 'euler',
    scheduler: 'simple',
    denoise: 1,
    positive: g.out(pos),
    negative: g.out(neg),
    latent_image: g.out(latent),
  });
  const dec = g.add('VAEDecode', { samples: g.out(ks), vae: g.out(vae) });
  g.add('SaveImage', { images: g.out(dec), filename_prefix: p.filenamePrefix ?? 'studio/qwen_edit' }, 'output');
  return g.nodes;
}

// ───────────────────────────── Wan 2.2 A14B (image → video, text → video) ─────────────────────────────

export interface WanParams {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  length: number; // frames, 4n+1
  fps: number; // 16
  seed: number;
  /** Lightning 4-step (default) vs. the 20-step cfg 3.5 path. */
  fast?: boolean;
  loras?: LoraFile[];
  filenamePrefix?: string;
}

export interface WanI2VParams extends WanParams {
  /** ComfyUI input filename of the start frame. */
  startImage: string;
  /** Optional last frame → WanFirstLastFrameToVideo. */
  endImage?: string;
}

function wanExperts(g: Graph, high: string, low: string, lightningHigh: string, lightningLow: string, p: WanParams) {
  const fast = p.fast ?? true;
  const unetHigh = g.add('UNETLoader', { unet_name: high, weight_dtype: 'default' });
  const unetLow = g.add('UNETLoader', { unet_name: low, weight_dtype: 'default' });
  const user = p.loras ?? [];
  const highLoras: LoraFile[] = [
    ...(fast ? [{ filename: lightningHigh, strength: 1 }] : []),
    ...user.filter((l) => l.expert === 'high' || l.expert === 'both'),
  ];
  const lowLoras: LoraFile[] = [
    ...(fast ? [{ filename: lightningLow, strength: 1 }] : []),
    ...user.filter((l) => (l.expert ?? 'low') === 'low' || l.expert === 'both'),
  ];
  const mHigh = g.add('ModelSamplingSD3', { model: chainLoras(g, g.out(unetHigh), highLoras), shift: 5 });
  const mLow = g.add('ModelSamplingSD3', { model: chainLoras(g, g.out(unetLow), lowLoras), shift: 5 });
  return { mHigh, mLow, fast };
}

function wanSampleAndSave(
  g: Graph,
  experts: { mHigh: string; mLow: string; fast: boolean },
  positive: Link,
  negative: Link,
  latent: Link,
  vae: string,
  p: WanParams,
) {
  const steps = experts.fast ? 4 : 20;
  const cfg = experts.fast ? 1 : 3.5;
  const split = experts.fast ? 2 : 10;
  const seed = clampSeed(p.seed);
  const k1 = g.add('KSamplerAdvanced', {
    model: g.out(experts.mHigh),
    add_noise: 'enable',
    noise_seed: seed,
    steps,
    cfg,
    sampler_name: 'euler',
    scheduler: 'simple',
    positive,
    negative,
    latent_image: latent,
    start_at_step: 0,
    end_at_step: split,
    return_with_leftover_noise: 'enable',
  });
  const k2 = g.add('KSamplerAdvanced', {
    model: g.out(experts.mLow),
    add_noise: 'disable',
    noise_seed: 0,
    steps,
    cfg,
    sampler_name: 'euler',
    scheduler: 'simple',
    positive,
    negative,
    latent_image: g.out(k1),
    start_at_step: split,
    end_at_step: 10000,
    return_with_leftover_noise: 'disable',
  });
  const dec = g.add('VAEDecode', { samples: g.out(k2), vae: g.out(vae) });
  const video = g.add('CreateVideo', { images: g.out(dec), fps: p.fps });
  g.add(
    'SaveVideo',
    { video: g.out(video), filename_prefix: p.filenamePrefix ?? 'studio/wan', format: 'mp4', 'format.codec': 'h264' },
    'output',
  );
}

export function buildWanI2V(p: WanI2VParams): ApiWorkflow {
  const g = new Graph();
  const clip = g.add('CLIPLoader', { clip_name: MODEL_FILES.wan.clip, type: 'wan', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: MODEL_FILES.wan.vae });
  const w = MODEL_FILES.wan;
  const experts = wanExperts(g, w.i2vHigh, w.i2vLow, w.i2vLightningHigh, w.i2vLightningLow, p);
  const pos = g.add('CLIPTextEncode', { text: p.prompt, clip: g.out(clip) });
  const neg = g.add('CLIPTextEncode', { text: p.negativePrompt, clip: g.out(clip) });
  const start = g.add('LoadImage', { image: p.startImage });
  const common = {
    positive: g.out(pos),
    negative: g.out(neg),
    vae: g.out(vae),
    width: p.width,
    height: p.height,
    length: p.length,
    batch_size: 1,
  };
  let cond: string;
  if (p.endImage) {
    const end = g.add('LoadImage', { image: p.endImage });
    cond = g.add('WanFirstLastFrameToVideo', { ...common, start_image: g.out(start), end_image: g.out(end) });
  } else {
    cond = g.add('WanImageToVideo', { ...common, start_image: g.out(start) });
  }
  wanSampleAndSave(g, experts, g.out(cond, 0), g.out(cond, 1), g.out(cond, 2), vae, p);
  return g.nodes;
}

export function buildWanT2V(p: WanParams): ApiWorkflow {
  const g = new Graph();
  const clip = g.add('CLIPLoader', { clip_name: MODEL_FILES.wan.clip, type: 'wan', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: MODEL_FILES.wan.vae });
  const w = MODEL_FILES.wan;
  const experts = wanExperts(g, w.t2vHigh, w.t2vLow, w.t2vLightningHigh, w.t2vLightningLow, p);
  const pos = g.add('CLIPTextEncode', { text: p.prompt, clip: g.out(clip) });
  const neg = g.add('CLIPTextEncode', { text: p.negativePrompt, clip: g.out(clip) });
  const latent = g.add('EmptyHunyuanLatentVideo', { width: p.width, height: p.height, length: p.length, batch_size: 1 });
  wanSampleAndSave(g, experts, g.out(pos), g.out(neg), g.out(latent), vae, p);
  return g.nodes;
}

/** Model files an engine needs (used to compute availability). */
export const ENGINE_FILES = {
  zimage: [MODEL_FILES.zimage.unet, MODEL_FILES.zimage.clip, MODEL_FILES.zimage.vae],
  qwen_edit: [MODEL_FILES.qwenEdit.unet, MODEL_FILES.qwenEdit.clip, MODEL_FILES.qwenEdit.vae, MODEL_FILES.qwenEdit.lightning],
  qwen_angle: [MODEL_FILES.qwenEdit.unet, MODEL_FILES.qwenEdit.clip, MODEL_FILES.qwenEdit.vae, MODEL_FILES.qwenEdit.lightning, MODEL_FILES.qwenEdit.angles],
  wan_i2v: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.wan.i2vHigh, MODEL_FILES.wan.i2vLow, MODEL_FILES.wan.i2vLightningHigh, MODEL_FILES.wan.i2vLightningLow],
  wan_t2v: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.wan.t2vHigh, MODEL_FILES.wan.t2vLow, MODEL_FILES.wan.t2vLightningHigh, MODEL_FILES.wan.t2vLightningLow],
} as const;

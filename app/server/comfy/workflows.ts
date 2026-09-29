// ComfyUI API-format workflow builders.
//
// Every graph here mirrors a Comfy-Org official template (workflow_templates repo, Sept 2026):
//   image_z_image_turbo.json, image_qwen_image_edit_2511.json, video_wan2_2_14B_i2v.json, video_wan2_2_14B_t2v.json,
//   video_minimax_h3_i2v.json, video_ltx2_5_i2v.json, video_ltx2_5_t2v.json, video_ltx2_5_flf2v.json
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
  animate: {
    unet: 'wan_animate_2_distill_int8_convrot.safetensors',
    clipVision: 'clip_vision_h.safetensors',
  },
  control: {
    high: 'wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors',
    low: 'wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors',
  },
  vace: {
    high: 'wan2.2_fun_vace_high_noise_14B_fp8_scaled.safetensors',
    low: 'wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors',
  },
  minimax: {
    unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    vae: 'minimax_h3_video_vae_int8_convrot.safetensors',
    audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
    turbo: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
    ref2va: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    refTurbo: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
  },
  ltx: {
    unet: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
    clip: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
    vae: 'ltx-2.5-video-vae-bf16.safetensors',
    audioVae: 'ltx-2.5-audio-vae-bf16.safetensors',
    upscaler: 'ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors',
    icLora: 'ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors',
    icLoraIngredients: 'ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors',
  },
} as const;

export interface LoraFile {
  filename: string;
  strength: number;
  /** Which base model the LoRA was made for (the video backend routes Wan / MiniMax H3 / LTX-2.5 LoRAs). */
  family?: import('../../shared/types').LoraFamily;
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
  trimLatent?: Link,
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
  // VACE prepends the reference-image latent frame(s); trim them off before decoding (its own trim_latent output).
  const samples = trimLatent ? g.out(g.add('TrimVideoLatent', { samples: g.out(k2), trim_amount: trimLatent })) : g.out(k2);
  const dec = g.add('VAEDecode', { samples, vae: g.out(vae) });
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

export interface WanControlParams extends WanParams {
  /** ComfyUI input filename of the control video (any footage: a depth or edge render, a 3D blockout, a phone clip). */
  controlVideo: string;
  /** Optional reference image for identity and look (a keyframe, a character reference). */
  refImage?: string;
  /** 'canny' runs Comfy's edge detector over the frames first (the official template's setting, right for RGB
   *  footage and gray blockouts); 'none' feeds the frames as they are (for depth or edge renders). */
  preprocess?: 'none' | 'canny';
}

// ───────────────────────────── Wan 2.2 Fun-Control (control video + reference image → that motion, rendered) ─────────────────────────────
// Ports Comfy-Org's video_wan2_2_14B_fun_control.json: LoadVideo → GetVideoComponents → (Canny 0.1/0.6) →
// Wan22FunControlToVideo(ref_image, control_video) → the same two-expert sampler as I2V, with the I2V
// lightx2v 4-step LoRAs (the template's fast path) or 20 steps at cfg 3.5. The node only reads the first
// `length` control frames, so the caller resamples the video to 16 fps and trims it to the clip length.
export function buildWanFunControl(p: WanControlParams): ApiWorkflow {
  const g = new Graph();
  const clip = g.add('CLIPLoader', { clip_name: MODEL_FILES.wan.clip, type: 'wan', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: MODEL_FILES.wan.vae });
  const w = MODEL_FILES.wan;
  const experts = wanExperts(g, MODEL_FILES.control.high, MODEL_FILES.control.low, w.i2vLightningHigh, w.i2vLightningLow, p);
  const pos = g.add('CLIPTextEncode', { text: p.prompt, clip: g.out(clip) });
  const neg = g.add('CLIPTextEncode', { text: p.negativePrompt, clip: g.out(clip) });
  const video = g.add('LoadVideo', { file: p.controlVideo });
  const frames = g.add('GetVideoComponents', { video: g.out(video) });
  const control = (p.preprocess ?? 'canny') === 'canny' ? g.add('Canny', { image: g.out(frames, 0), low_threshold: 0.1, high_threshold: 0.6 }) : undefined;
  const cond = g.add('Wan22FunControlToVideo', {
    positive: g.out(pos),
    negative: g.out(neg),
    vae: g.out(vae),
    width: p.width,
    height: p.height,
    length: p.length,
    batch_size: 1,
    control_video: control ? g.out(control) : g.out(frames, 0),
    ...(p.refImage ? { ref_image: g.out(g.add('LoadImage', { image: p.refImage })) } : {}),
  });
  wanSampleAndSave(g, experts, g.out(cond, 0), g.out(cond, 1), g.out(cond, 2), vae, { ...p, filenamePrefix: p.filenamePrefix ?? 'studio/wan_control' });
  return g.nodes;
}

export interface WanVaceParams extends WanParams {
  /** ComfyUI input filename of the control video (e.g. a Blender greybox previs, resampled to `fps` and trimmed
   *  to `length` frames). */
  controlVideo: string;
  /** Optional single reference image for identity (a character/prop sheet, or several sheets already composited
   *  side by side into one image server-side — WanVaceToVideo takes exactly one reference image). */
  refImage?: string;
  /** 'canny' (default) runs Comfy's edge detector over the control frames first; 'none' feeds them as they are. */
  preprocess?: 'none' | 'canny';
  /** VACE conditioning strength (WanVaceToVideo's own `strength`, distinct from LoRA strength). Default 1. */
  strength?: number;
}

// ───────────────────────────── Wan 2.2 VACE-Fun (control video + 1..N reference sheets → that motion, keeping identity) ─────────────────────────────
// Built from the core WanVaceToVideo node (comfy_extras/nodes_wan.py) per docs.comfy.org's "Wan Vace To Video"
// built-in node page: LoadVideo → GetVideoComponents → (Canny 0.1/0.6, as wan_control) → WanVaceToVideo(vae,
// width, height, length, strength, control_video, reference_image) → the same two-expert high/low-noise sampler
// as I2V/Fun-Control, with the I2V lightx2v 4-step LoRAs on the VACE-Fun 14B checkpoints. WanVaceToVideo accepts
// only a single reference_image; multiple sheets are composited side by side into one image before upload (see
// media.ts compositeReferenceImages). Its `trim_latent` output reports how many latent frames the reference
// image added at the front of the sequence; TrimVideoLatent (wanSampleAndSave) drops them before decoding, the
// same pattern Wan Animate 2 already uses.
export function buildWanVace(p: WanVaceParams): ApiWorkflow {
  const g = new Graph();
  const clip = g.add('CLIPLoader', { clip_name: MODEL_FILES.wan.clip, type: 'wan', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: MODEL_FILES.wan.vae });
  const w = MODEL_FILES.wan;
  const experts = wanExperts(g, MODEL_FILES.vace.high, MODEL_FILES.vace.low, w.i2vLightningHigh, w.i2vLightningLow, p);
  const pos = g.add('CLIPTextEncode', { text: p.prompt, clip: g.out(clip) });
  const neg = g.add('CLIPTextEncode', { text: p.negativePrompt, clip: g.out(clip) });
  const video = g.add('LoadVideo', { file: p.controlVideo });
  const frames = g.add('GetVideoComponents', { video: g.out(video) });
  const control = (p.preprocess ?? 'canny') === 'canny' ? g.add('Canny', { image: g.out(frames, 0), low_threshold: 0.1, high_threshold: 0.6 }) : undefined;
  const cond = g.add('WanVaceToVideo', {
    positive: g.out(pos),
    negative: g.out(neg),
    vae: g.out(vae),
    width: p.width,
    height: p.height,
    length: p.length,
    batch_size: 1,
    strength: p.strength ?? 1,
    control_video: control ? g.out(control) : g.out(frames, 0),
    ...(p.refImage ? { reference_image: g.out(g.add('LoadImage', { image: p.refImage })) } : {}),
  });
  wanSampleAndSave(g, experts, g.out(cond, 0), g.out(cond, 1), g.out(cond, 2), vae, { ...p, filenamePrefix: p.filenamePrefix ?? 'studio/wan_vace' }, p.refImage ? g.out(cond, 3) : undefined);
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

// ───────────────────────────── Wan Animate 2 (your video + character image → character performs it) ─────────────────────────────
// Mirrors Comfy-Org's video_wan_animate2_distilled.json: the raw driving frames condition the pose
// branch directly (no skeleton extraction), the reference image sets identity, and the prompt sets
// the background. Long clips are rendered as chained 81-frame segments: each segment continues from
// the previous segment's frames (continue_motion) and advances through the driving video
// (video_frame_offset), dropping its first overlapping frame. Output keeps the recording's fps + audio.

export interface WanAnimateParams {
  /** ComfyUI input filenames. */
  referenceImage: string;
  drivingVideo: string;
  /** Character appearance + background description. */
  prompt: string;
  /** Description of the motion in the recording (pose branch prompt). */
  motionPrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  /** Number of 81-frame segments to render (1 ≈ 81 frames of the recording). */
  segments: number;
  seed: number;
  filenamePrefix?: string;
}

export function buildWanAnimate2(p: WanAnimateParams): ApiWorkflow {
  const g = new Graph();
  const unet = g.add('UNETLoader', { unet_name: MODEL_FILES.animate.unet, weight_dtype: 'default' });
  const clip = g.add('CLIPLoader', { clip_name: MODEL_FILES.wan.clip, type: 'wan', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: MODEL_FILES.wan.vae });
  const clipVision = g.add('CLIPVisionLoader', { clip_name: MODEL_FILES.animate.clipVision });
  const cached = g.add('WanAnimate2Cache', { model: g.out(unet), device: 'gpu', dtype: 'int8' });
  const model = g.add('ModelSamplingSD3', { model: g.out(cached), shift: 5 });
  const sigmas = g.add('BasicScheduler', { model: g.out(cached), scheduler: 'simple', steps: 10, denoise: 1 });
  const sampler = g.add('KSamplerSelect', { sampler_name: 'lcm' });

  const pos = g.add('CLIPTextEncode', { text: p.prompt, clip: g.out(clip) });
  const neg = g.add('CLIPTextEncode', { text: p.negativePrompt, clip: g.out(clip) });
  const posePos = g.add('CLIPTextEncode', { text: p.motionPrompt, clip: g.out(clip) });

  const refImg = g.add('LoadImage', { image: p.referenceImage });
  const video = g.add('LoadVideo', { file: p.drivingVideo });
  const components = g.add('GetVideoComponents', { video: g.out(video) });
  const drive = g.add('ResizeImageMaskNode', {
    input: g.out(components, 0),
    resize_type: 'scale dimensions',
    'resize_type.width': p.width,
    'resize_type.height': p.height,
    'resize_type.crop': 'center',
    scale_method: 'area',
  });
  const size = g.add('GetImageSize', { image: g.out(drive) });
  const ref = g.add('ResizeImageMaskNode', {
    input: g.out(refImg),
    resize_type: 'scale dimensions',
    'resize_type.width': g.out(size, 0),
    'resize_type.height': g.out(size, 1),
    'resize_type.crop': 'center',
    scale_method: 'area',
  });
  const refVision = g.add('CLIPVisionEncode', { clip_vision: g.out(clipVision), image: g.out(ref), crop: 'none' });
  const firstFrame = g.add('ImageFromBatch', { image: g.out(drive), batch_index: 0, length: 1 });
  const poseVision = g.add('CLIPVisionEncode', { clip_vision: g.out(clipVision), image: g.out(firstFrame), crop: 'none' });

  const seed = clampSeed(p.seed);
  const segmentImages: Link[] = [];
  let prevFrames: Link | undefined;
  let prevOffset: Link | undefined;
  const segments = Math.max(1, Math.min(8, Math.floor(p.segments)));
  for (let i = 0; i < segments; i++) {
    const cond = g.add('WanAnimate2ToVideo', {
      positive: g.out(pos),
      negative: g.out(neg),
      vae: g.out(vae),
      width: g.out(size, 0),
      height: g.out(size, 1),
      length: 81,
      batch_size: 1,
      video_frame_offset: prevOffset ?? 0,
      pose_strength: 1,
      pose_start_percent: 0,
      pose_end_percent: 1,
      reference_image_strength: 1,
      reference_image: g.out(ref),
      pose_video: g.out(drive),
      clip_vision_output: g.out(refVision),
      positive_pose: g.out(posePos),
      clip_vision_output_pose: g.out(poseVision),
      ...(prevFrames ? { continue_motion: prevFrames } : {}),
    });
    const sampled = g.add('SamplerCustom', {
      model: g.out(model),
      add_noise: true,
      noise_seed: seed + i,
      cfg: 1,
      positive: g.out(cond, 0),
      negative: g.out(cond, 1),
      sampler: g.out(sampler),
      sigmas: g.out(sigmas),
      latent_image: g.out(cond, 2),
    });
    const trimmed = g.add('TrimVideoLatent', { samples: g.out(sampled), trim_amount: g.out(cond, 3) });
    const frames = g.add('VAEDecode', { samples: g.out(trimmed), vae: g.out(vae) });
    // Continuation segments start with a frame that duplicates the previous segment's last one.
    segmentImages.push(i === 0 ? g.out(frames) : g.out(g.add('ImageFromBatch', { image: g.out(frames), batch_index: 1, length: 4096 })));
    prevFrames = g.out(frames);
    prevOffset = g.out(cond, 5);
  }

  const images =
    segmentImages.length === 1
      ? segmentImages[0]
      : g.out(g.add('BatchImagesNode', Object.fromEntries(segmentImages.map((l, i) => [`images.image${i}`, l]))));
  const out = g.add('CreateVideo', { images, fps: g.out(components, 2), audio: g.out(components, 1) });
  g.add(
    'SaveVideo',
    { video: g.out(out), filename_prefix: p.filenamePrefix ?? 'studio/perform', format: 'mp4', 'format.codec': 'h264' },
    'output',
  );
  return g.nodes;
}

// ───────────────────────────── MiniMax H3 (opt-in: text/image/first-last-frame → video with sound) ─────────────────────────────
// Mirrors Comfy-Org's video_minimax_h3_i2v.json (t2va / fl2va via MiniMaxH3ImageToVideo) with the 4-step
// turbo LoRA: no negative prompt, CFG 1 (BasicGuider), res_multistep, simple schedule. The AV latent
// decodes to frames (video VAE) and stereo audio (audio VAE), muxed at 24 fps.

export const H3_FPS = 24;

/** H3 frame counts live on a 17k+5 grid at 24 fps (124 ≈ 5 s); trained range ≈ 124–362. */
export function h3FramesForDuration(sec: number): number {
  let n = Math.max(5, Math.round(sec * H3_FPS));
  while (n % 17 !== 5) n++;
  return n;
}

export interface MiniMaxH3Params {
  prompt: string;
  width: number;
  height: number;
  /** Frames at 24 fps, already on the 17k+5 grid (see h3FramesForDuration). */
  length: number;
  seed: number;
  /** ComfyUI input filenames. */
  startImage?: string;
  endImage?: string;
  steps?: number; // turbo LoRA: 4
  /** User MiniMax H3 LoRAs, applied on top of the turbo LoRA. */
  loras?: LoraFile[];
  filenamePrefix?: string;
}

export interface MiniMaxH3RefParams {
  /** Full Ref2VA prompt (subject_definitions … non_diegetic_music); see formatH3RefPrompt. */
  prompt: string;
  width: number;
  height: number;
  length: number; // frames, 17n+5
  seed: number;
  /** ComfyUI input filenames: up to 9 reference images (character sheets, vehicle sheets, location plates). */
  refImages: string[];
  /** ComfyUI input filenames: up to 3 reference videos, 24 fps, 2–15 s (a previs playblast, footage to edit). */
  refVideos?: string[];
  /** 'match' scales references to the render size; 'max' keeps a 2048 px short edge (better identity, several times slower). */
  refImageSize?: 'match' | 'max';
  steps?: number;
  loras?: LoraFile[];
  filenamePrefix?: string;
}

// ───────────────────────────── MiniMax H3 reference-to-video ─────────────────────────────
// Mirrors Comfy-Org's video_minimax_h3_r2v.json: the Ref2VA checkpoint, MiniMaxH3ReferenceToVideo with the
// references as autogrow inputs (ref_images.ref_image_N, ref_videos.ref_video_N), the 4-step ref2v turbo LoRA
// and the same res_multistep sampler as image-to-video. Reference videos are frame batches at 24 fps.
export function buildMiniMaxH3Ref(p: MiniMaxH3RefParams): ApiWorkflow {
  const g = new Graph();
  const f = MODEL_FILES.minimax;
  const unet = g.add('UNETLoader', { unet_name: f.ref2va, weight_dtype: 'default' });
  const model = chainLoras(g, g.out(unet), [{ filename: f.refTurbo, strength: 1 }, ...(p.loras ?? [])]);
  const clip = g.add('CLIPLoader', { clip_name: f.clip, type: 'minimax', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: f.vae });
  const audioVae = g.add('VAELoader', { vae_name: f.audioVae });
  const refs: Record<string, Link> = {};
  p.refImages.slice(0, 9).forEach((name, i) => {
    refs[`ref_images.ref_image_${i}`] = g.out(g.add('LoadImage', { image: name }));
  });
  (p.refVideos ?? []).slice(0, 3).forEach((name, i) => {
    const video = g.add('LoadVideo', { file: name });
    const parts = g.add('GetVideoComponents', { video: g.out(video) });
    refs[`ref_videos.ref_video_${i}`] = g.out(parts, 0);
  });
  const cond = g.add('MiniMaxH3ReferenceToVideo', {
    clip: g.out(clip),
    vae: g.out(vae),
    audio_vae: g.out(audioVae),
    prompt: p.prompt,
    width: p.width,
    height: p.height,
    length: p.length,
    ref_image_size: p.refImageSize ?? 'match',
    ...refs,
  });
  const noise = g.add('RandomNoise', { noise_seed: clampSeed(p.seed) });
  const sampler = g.add('KSamplerSelect', { sampler_name: 'res_multistep' });
  const sigmas = g.add('BasicScheduler', { model, scheduler: 'simple', steps: p.steps ?? 4, denoise: 1 });
  const guider = g.add('BasicGuider', { model, conditioning: g.out(cond, 0) });
  const sampled = g.add('SamplerCustomAdvanced', { noise: g.out(noise), guider: g.out(guider), sampler: g.out(sampler), sigmas: g.out(sigmas), latent_image: g.out(cond, 1) });
  const frames = g.add('VAEDecode', { samples: g.out(sampled), vae: g.out(vae) });
  const audio = g.add('VAEDecodeAudio', { samples: g.out(sampled), vae: g.out(audioVae) });
  const video = g.add('CreateVideo', { images: g.out(frames), audio: g.out(audio), fps: H3_FPS });
  g.add('SaveVideo', { video: g.out(video), filename_prefix: p.filenamePrefix ?? 'studio/h3_ref', format: 'mp4', 'format.codec': 'h264' }, 'output');
  return g.nodes;
}

export function buildMiniMaxH3(p: MiniMaxH3Params): ApiWorkflow {
  const g = new Graph();
  const f = MODEL_FILES.minimax;
  const unet = g.add('UNETLoader', { unet_name: f.unet, weight_dtype: 'default' });
  const model = chainLoras(g, g.out(unet), [{ filename: f.turbo, strength: 1 }, ...(p.loras ?? [])]);
  const clip = g.add('CLIPLoader', { clip_name: f.clip, type: 'minimax', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: f.vae });
  const audioVae = g.add('VAELoader', { vae_name: f.audioVae });
  const cond = g.add('MiniMaxH3ImageToVideo', {
    clip: g.out(clip),
    vae: g.out(vae),
    prompt: p.prompt,
    width: p.width,
    height: p.height,
    length: p.length,
    ...(p.startImage ? { first_frame: g.out(g.add('LoadImage', { image: p.startImage })) } : {}),
    ...(p.endImage ? { last_frame: g.out(g.add('LoadImage', { image: p.endImage })) } : {}),
  });
  const noise = g.add('RandomNoise', { noise_seed: clampSeed(p.seed) });
  const sampler = g.add('KSamplerSelect', { sampler_name: 'res_multistep' });
  const sigmas = g.add('BasicScheduler', { model, scheduler: 'simple', steps: p.steps ?? 4, denoise: 1 });
  const guider = g.add('BasicGuider', { model, conditioning: g.out(cond, 0) });
  const sampled = g.add('SamplerCustomAdvanced', {
    noise: g.out(noise),
    guider: g.out(guider),
    sampler: g.out(sampler),
    sigmas: g.out(sigmas),
    latent_image: g.out(cond, 1),
  });
  const frames = g.add('VAEDecode', { samples: g.out(sampled), vae: g.out(vae) });
  const audio = g.add('VAEDecodeAudio', { samples: g.out(sampled), vae: g.out(audioVae) });
  const video = g.add('CreateVideo', { images: g.out(frames), audio: g.out(audio), fps: H3_FPS });
  g.add(
    'SaveVideo',
    { video: g.out(video), filename_prefix: p.filenamePrefix ?? 'studio/h3', format: 'mp4', 'format.codec': 'h264' },
    'output',
  );
  return g.nodes;
}

// ───────────────────── LTX-2.5 (opt-in; image/text → video with sound) ─────────────────────
// Mirrors Comfy-Org's video_ltx2_5_i2v.json / video_ltx2_5_t2v.json: a half-size pass, the x2 latent
// upscaler, then a short refine pass at full size (the start image is re-applied after upscaling). With an
// end image it follows video_ltx2_5_flf2v.json instead: one full-size pass with LTXVAddGuide keyframes at
// the first and last frame, cropped off before decoding. Distilled transformer, CFG 1 for video and audio,
// euler_ancestral on the templates' manual sigmas, tiled VAE decode. The templates' optional Gemma prompt
// enhancer is left out: the studio writes its own prompts (see ltx_prompt.ts).

export const LTX_FPS = 24;
const LTX_NEGATIVE = 'pc game, console game, video game, cartoon, childish, ugly';
const LTX_SIGMAS = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0';
const LTX_REFINE_SIGMAS = '0.85, 0.7250, 0.4219, 0.0';

/** LTX frame counts live on an 8k+1 grid (121 = 5 s at 24 fps). */
export function ltxFramesForDuration(sec: number): number {
  return Math.max(1, Math.round((sec * LTX_FPS) / 8)) * 8 + 1;
}

export interface Ltx25Params {
  prompt: string;
  negativePrompt?: string;
  /** Output size; multiples of 64 (the first pass renders at half size on LTX's 32 px latent grid). */
  width: number;
  height: number;
  /** Frames at 24 fps on the 8k+1 grid (see ltxFramesForDuration). */
  length: number;
  seed: number;
  /** ComfyUI input filenames. */
  startImage?: string;
  endImage?: string;
  /** User LTX-2.x LoRAs. */
  loras?: LoraFile[];
  /** A ComfyUI input WAV to use as the clip's soundtrack (e.g. a character's recorded line, padded to the
   *  clip length): LTX animates the picture to it instead of generating sound, as in Comfy-Org's
   *  video_ltx2_3_ia2v.json (audio encoded, then held fixed with a zero noise mask). */
  audioFile?: string;
  filenamePrefix?: string;
}

export function buildLtx25(p: Ltx25Params): ApiWorkflow {
  const g = new Graph();
  const f = MODEL_FILES.ltx;
  const unet = g.add('UNETLoader', { unet_name: f.unet, weight_dtype: 'default' });
  const model = chainLoras(g, g.out(unet), p.loras ?? []);
  const clip = g.add('CLIPLoader', { clip_name: f.clip, type: 'ltxv', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: f.vae });
  const audioVae = g.add('VAELoader', { vae_name: f.audioVae });
  const pos = g.add('CLIPTextEncode', { text: p.prompt, clip: g.out(clip) });
  const neg = g.add('CLIPTextEncode', { text: p.negativePrompt || LTX_NEGATIVE, clip: g.out(clip) });
  const cond = g.add('LTXVConditioning', { positive: g.out(pos), negative: g.out(neg), frame_rate: LTX_FPS });
  const audioLatent = p.audioFile
    ? g.add('SetLatentNoiseMask', {
        samples: g.out(g.add('LTXVAudioVAEEncode', { audio: g.out(g.add('LoadAudio', { audio: p.audioFile })), audio_vae: g.out(audioVae) })),
        mask: g.out(g.add('SolidMask', { value: 0, width: 512, height: 512 })),
      })
    : g.add('LTXVEmptyLatentAudio', { audio_vae: g.out(audioVae), frames_number: p.length, frame_rate: LTX_FPS, batch_size: 1 });
  const image = (name: string) => g.out(g.add('LTXVPreprocess', { image: g.out(g.add('LoadImage', { image: name })), img_compression: 18 }));
  const sample = (guider: string, sampler: string, sigmas: string, latent: Link, seed: number, output: number) =>
    g.out(
      g.add('SamplerCustomAdvanced', {
        noise: g.out(g.add('RandomNoise', { noise_seed: seed })),
        guider: g.out(guider),
        sampler: g.out(sampler),
        sigmas: g.out(g.add('ManualSigmas', { sigmas })),
        latent_image: latent,
      }),
      output,
    );
  const guide = (positive: Link, negative: Link) =>
    g.add('LTXVDualCFGGuider', { model, positive, negative, video_cfg: 1, audio_cfg: 1 });

  let frames: Link;
  let audio: Link;
  if (p.endImage) {
    // First/last-frame: keyframe guides pin both ends of the clip.
    let positive: Link = g.out(cond, 0);
    let negative: Link = g.out(cond, 1);
    let latent: Link = g.out(g.add('EmptyLTXVLatentVideo', { width: p.width, height: p.height, length: p.length, batch_size: 1 }));
    for (const [name, frameIdx] of [[p.startImage, 0], [p.endImage, -1]] as const) {
      if (!name) continue;
      const guided = g.add('LTXVAddGuide', { positive, negative, vae: g.out(vae), latent, image: image(name), frame_idx: frameIdx, strength: 0.7 });
      [positive, negative, latent] = [g.out(guided, 0), g.out(guided, 1), g.out(guided, 2)];
    }
    const av = g.add('LTXVConcatAVLatent', { video_latent: latent, audio_latent: g.out(audioLatent) });
    const sampler = g.add('SamplerEulerAncestral', { eta: 0, s_noise: 1 });
    const split = g.add('LTXVSeparateAVLatent', { av_latent: sample(guide(positive, negative), sampler, LTX_SIGMAS, g.out(av), clampSeed(p.seed), 1) });
    const cropped = g.add('LTXVCropGuides', { positive, negative, latent: g.out(split, 0) });
    frames = g.out(cropped, 2);
    audio = g.out(split, 1);
  } else {
    // Image/text → video: half-size pass, x2 latent upscale, refine at full size.
    const start = p.startImage ? image(p.startImage) : undefined;
    const withStart = (latent: Link, strength: number): Link =>
      start ? g.out(g.add('LTXVImgToVideoInplace', { vae: g.out(vae), image: start, latent, strength, bypass: false })) : latent;
    const sampler = g.add('KSamplerSelect', { sampler_name: 'euler_ancestral' });
    const guider = guide(g.out(cond, 0), g.out(cond, 1));
    const empty = g.add('EmptyLTXVLatentVideo', { width: p.width / 2, height: p.height / 2, length: p.length, batch_size: 1 });
    const av1 = g.add('LTXVConcatAVLatent', { video_latent: withStart(g.out(empty), 0.7), audio_latent: g.out(audioLatent) });
    const split1 = g.add('LTXVSeparateAVLatent', { av_latent: sample(guider, sampler, LTX_SIGMAS, g.out(av1), clampSeed(p.seed), 0) });
    const upscaler = g.add('LatentUpscaleModelLoader', { model_name: f.upscaler });
    const upscaled = g.add('LTXVLatentUpsampler', { samples: g.out(split1, 0), upscale_model: g.out(upscaler), vae: g.out(vae) });
    const av2 = g.add('LTXVConcatAVLatent', { video_latent: withStart(g.out(upscaled), 1), audio_latent: g.out(split1, 1) });
    // The template refines with a fixed noise seed.
    const split2 = g.add('LTXVSeparateAVLatent', { av_latent: sample(guider, sampler, LTX_REFINE_SIGMAS, g.out(av2), 42, 0) });
    frames = g.out(split2, 0);
    audio = g.out(split2, 1);
  }
  const decoded = g.add('VAEDecodeTiled', { samples: frames, vae: g.out(vae), tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 });
  const sound = g.add('LTXVAudioVAEDecode', { samples: audio, audio_vae: g.out(audioVae) });
  const video = g.add('CreateVideo', { images: g.out(decoded), audio: g.out(sound), fps: LTX_FPS });
  g.add(
    'SaveVideo',
    { video: g.out(video), filename_prefix: p.filenamePrefix ?? 'studio/ltx', format: 'mp4', 'format.codec': 'h264' },
    'output',
  );
  return g.nodes;
}

// ───────────────────── LTX-2.5 IC-LoRA union control (opt-in; control video + optional reference image → video with sound) ─────────────────────
// Built from core ComfyUI nodes per Lightricks' own official example workflow (ComfyUI-LTXVideo repo,
// example_workflows/2.5/LTX-2.5_ICLoRA_Union_Control_Distilled.json — verified from the raw JSON, Sept 2026),
// which pairs this "2.3" IC-LoRA with the ltx-2.5-22b-distilled-transformer base model: the union-control
// IC-LoRA (ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors) applied through the ordinary LoraLoaderModelOnly
// (chainLoras) already used everywhere else in this file, GetICLoRAParameters reads its reference_downscale_factor
// from the LoRA's own safetensors metadata, and LTXVAddGuide (with that iclora_parameters input) injects the
// control frames as a guide — the same core nodes_lt.py primitives buildLtx25's first/last-frame branch already
// uses for LTXVAddGuide/LTXVCropGuides, no custom node package required. The official template preprocesses the
// control video with a depth or canny annotator from a separate custom-node pack; this studio has no custom
// nodes installed (docker/Dockerfile: "core nodes only"), so it reuses the core `Canny` node already used by
// wan_control instead (greybox previs has clean geometric edges).
//
// `twoStage` (quality 'hd') reproduces the official template's own two-stage "Sampler - Distilled (8 steps)" /
// "Upscale and re-sampler (3 steps)" subgraphs, confirmed by decoding the workflow's `definitions.subgraphs`
// (the JSON stores UI subgraphs, not the flat API graph): stage 1 runs the same 8-step distilled pass at half
// size; its guide frames are then cropped off (LTXVCropGuides) *before* the upscale, exactly as the official
// graph wires LTXVCropGuides' output into the "Upscale and re-sampler" subgraph's `samples` input (the
// subgraph's un-cropped `audio_latent` input is fed straight from stage 1's audio split — audio is never
// upscaled or re-cropped); LTXVLatentUpsampler (core, comfy_extras/nodes_lt_upsampler.py) 2x's the cropped
// video latent using the same LatentUpscaleModelLoader + ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors
// this repo already downloads for buildLtx25; the reference image (if any) is re-applied on the upscaled
// latent via LTXVImgToVideoInplace, matching the official note "The original image is used here again for
// conditioning, if you entered one" (the control-video IC-LoRA guide is *not* reapplied — it was already
// cropped out, same as the official graph never re-runs its `LTXAddVideoICLoRAGuide`); the 3-step refine then
// runs on the resulting AV latent with the official's own sigmas/sampler, read verbatim off its "Upscale and
// re-sampler" instance node (id 5517: widgets `[bypass_i2v, img_strength, sampler_name, cfg, noise_seed]` =
// `[false, 1, 'euler', 1, 42]`, ManualSigmas `'0.909375, 0.725, 0.421875, 0.0'`) — note stage 2 uses plain
// 'euler', not the stage-1 'euler_ancestral'. 'fast' (quality default) keeps today's original single full-size
// pass unchanged. Not GPU-verified — flagged for a follow-up quality check once a pod is available.
//
// Item 1 (2026-09 LTX best-practices research): Lightricks' official workflows never run LTXVPreprocess (JPEG
// compression) on the control frames or a start image for this IC-LoRA family — that only appears in the
// official I2V template buildLtx25 mirrors — so neither the control video nor the optional reference image is
// compressed here.
//
// Keyframes and the Ingredients reference-sheet mode (2026-09 LTX best-practices research, `keyframes` /
// `referenceSheetVideo` below) were decoded from Lightricks' official example workflows
// (ComfyUI-LTXVideo/example_workflows/2.5/LTX-2.5_ICLoRA_Ingredients_Single_Stage_Distilled.json, fetched and
// parsed directly since it stores its guide/loader nodes inside `definitions.subgraphs`, which most JSON
// summarizers omit): a single reference-sheet still is held on every frame with core `RepeatImageBatch`-
// equivalent behavior (this studio builds that hold as a real looped video server-side with ffmpeg instead —
// see media.ts buildReferenceSheetVideo — matching the task's own ffmpeg-first-class pattern rather than an
// in-graph repeat node) and injected via the pack's custom `LTXAddVideoICLoRAGuide` node at frame_idx 0,
// strength 1, latent_downscale_factor 1 (its own reference_downscale_factor metadata) — the same shape core's
// `LTXVAddGuide` + `GetICLoRAParameters` already reproduces for the union-control LoRA above, so the mapping is
// identical: LoraLoaderModelOnly → GetICLoRAParameters → LTXVAddGuide(iclora_parameters=...). The example's
// "Load Models" subgraph instantiates the Ingredients LoRA at strength 1.3 (its own node default is 1; the
// model card calls it "pre-scaled to 1.0") — we follow the actual shipped workflow's 1.3, not the card. Its
// sampler ("Sampler - Distilled (8 steps)"): RandomNoise seed 42, CFGGuider cfg 1 (mapped to our
// LTXVDualCFGGuider video_cfg/audio_cfg 1, since we always sample a concatenated AV latent), KSamplerSelect
// euler_ancestral, ManualSigmas identical to this file's own LTX_SIGMAS, LTXVSeparateAVLatent then
// LTXVCropGuides. No two-stage Ingredients workflow exists in that folder, so 'hd' reuses this file's existing
// two-stage pattern. The example has no start image/LTXVImgToVideoInplace — the sheet is guide-only, matching
// the model card ("does not become the first frame").
//
// LTXVAddGuide's own alignment rule (core comfy_extras/nodes_lt.py, `get_latent_index`): a multi-frame guide's
// frame_idx must satisfy `frame_idx == 0 || (frame_idx - 1) % 8 == 0`, otherwise the node rounds it down to the
// nearest value that does; a *single-frame* guide (every keyframe here is one image) is explicitly exempt from
// this ("any frame_idx value is acceptable"). We snap anyway (ltxKeyframeFrameIdx below) so keyframes land on
// the same grid as the clip's own frame count and never collide under the node's own rounding. A negative
// frame_idx is a special case handled inside the node itself (counts back from the true last frame), which is
// what an end frame (timeSec at or past the clip's duration) uses instead of a computed index.
const LTX_IC_STAGE2_SIGMAS = '0.909375, 0.725, 0.421875, 0.0';
/** Lightricks/LTX-2.5-22b-IC-LoRA-Ingredients model card negative prompt. */
export const LTX_INGREDIENTS_NEGATIVE = 'worst quality, inconsistent motion, blurry, jittery, distorted';
/** The Ingredients IC-LoRA's trained bucket (768x448 @ 121 frames, 24 fps) sets the reference sheet's minimum
 *  frame count; media.ts's buildReferenceSheetVideo uses this alongside the clip's own length. */
export const LTX_INGREDIENTS_MIN_FRAMES = 121;

/** Resolves a keyframe's requested time into an LTXVAddGuide frame_idx, snapped onto the 8n+1 grid (see the
 *  alignment-rule comment above `LTX_IC_STAGE2_SIGMAS`). `length` is the clip's frame count *before* any
 *  end-frame extension. A keyframe at or past the last frame (timeSec * fps >= length - 1) is an end frame:
 *  the caller extends the clip by 8 frames and this returns frame_idx -1 (LTXVAddGuide's own "true last frame"
 *  sentinel) so the guide lands on the extended clip's real end rather than a computed index. */
export function ltxKeyframeFrameIdx(timeSec: number, length: number, fps: number = LTX_FPS): { frameIdx: number; isEnd: boolean } {
  const raw = Math.max(0, Math.round(timeSec * fps));
  if (raw >= length - 1) return { frameIdx: -1, isEnd: true };
  const snapped = raw <= 1 ? 0 : Math.floor((raw - 1) / 8) * 8 + 1;
  return { frameIdx: Math.min(snapped, Math.max(0, length - 1)), isEnd: false };
}

export interface LtxIcKeyframe {
  /** ComfyUI input filename of an image asset. */
  image: string;
  /** Seconds into the clip; at or past the clip's duration makes this an end frame (see ltxKeyframeFrameIdx). */
  timeSec: number;
  /** LTXVAddGuide strength. Default 0.7 (stage 1's official image-guide strength); reapplied at 1.0 in stage 2. */
  strength?: number;
}

export interface LtxIcParams {
  prompt: string;
  negativePrompt?: string;
  /** Final output size; multiples of 64 (stage 1 renders at half size on LTX's 32 px latent grid when
   *  `twoStage` is set). */
  width: number;
  height: number;
  length: number; // frames, 8k+1 (see ltxFramesForDuration)
  seed: number;
  /** ComfyUI input filename of the control video (e.g. a Blender greybox previs, resampled to 24 fps and
   *  trimmed to `length` frames). Optional when `referenceSheetVideo` is given (sheet-only mode). */
  controlVideo?: string;
  /** Optional single reference image for identity/look (the previs's first frame, or a composited sheet);
   *  equivalent to a `keyframes` entry at timeSec 0, kept as its own field/strength (1, not 0.7) for backward
   *  compatibility with requests made before `keyframes` existed. */
  refImage?: string;
  /** 'canny' (default) runs Comfy's edge detector over the control frames first; 'none' feeds them as they are. */
  preprocess?: 'none' | 'canny';
  /** User LTX-2.x LoRAs, applied alongside the IC-LoRA(s). */
  loras?: LoraFile[];
  /** Lightricks' official second stage: half-size 8-step pass, core 2x latent upscale, 3-step refine at full
   *  size (see the comment above). Set for quality 'hd'; 'fast' stays the original single pass. */
  twoStage?: boolean;
  filenamePrefix?: string;
  /** The union-control IC-LoRA loader strength (Lightricks: 1.0 full adherence, 0.5–0.8 softer). Default 1.0;
   *  only used when `controlVideo` is given. */
  controlStrength?: number;
  /** Extra single-image guides beyond `refImage`, each its own chained LTXVAddGuide. */
  keyframes?: LtxIcKeyframe[];
  /** Lightricks/LTX-2.5-22b-IC-LoRA-Ingredients: a pre-built ComfyUI input filename of the static "reference
   *  sheet" video (the still looped to the output length/fps at output resolution, >=121 frames — see
   *  media.ts buildReferenceSheetVideo). Combined with `controlVideo` this stacks both IC-LoRAs
   *  (experimental / untested combo per docs/research/2026-09-ltx-best-practices.md). */
  referenceSheetVideo?: string;
}

export function buildLtxIc(p: LtxIcParams): ApiWorkflow {
  const g = new Graph();
  const f = MODEL_FILES.ltx;
  const unet = g.add('UNETLoader', { unet_name: f.unet, weight_dtype: 'default' });
  const usingSheet = Boolean(p.referenceSheetVideo);

  // Load the IC-LoRA(s), each immediately followed by its own GetICLoRAParameters so it reads that specific
  // LoRA's own safetensors metadata (reference_downscale_factor) rather than whichever LoRA loaded last.
  // Control-only (no sheet) keeps the exact original single-chain shape: one LoraLoaderModelOnly carrying the
  // union-control LoRA and every user LoRA together, then one GetICLoRAParameters.
  let model: Link = g.out(unet);
  let controlIcParams: Link | undefined;
  let sheetIcParams: Link | undefined;
  if (usingSheet) {
    if (p.controlVideo) {
      model = g.out(g.add('LoraLoaderModelOnly', { model, lora_name: f.icLora, strength_model: p.controlStrength ?? 1 }));
      controlIcParams = g.out(g.add('GetICLoRAParameters', { iclora_model: model }));
    }
    model = g.out(g.add('LoraLoaderModelOnly', { model, lora_name: f.icLoraIngredients, strength_model: 1.3 }));
    sheetIcParams = g.out(g.add('GetICLoRAParameters', { iclora_model: model }));
    model = chainLoras(g, model, p.loras ?? []);
  } else {
    model = chainLoras(g, model, [{ filename: f.icLora, strength: p.controlStrength ?? 1 }, ...(p.loras ?? [])]);
    controlIcParams = g.out(g.add('GetICLoRAParameters', { iclora_model: model }));
  }

  const clip = g.add('CLIPLoader', { clip_name: f.clip, type: 'ltxv', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: f.vae });
  const audioVae = g.add('VAELoader', { vae_name: f.audioVae });
  const pos0 = g.add('CLIPTextEncode', { text: p.prompt, clip: g.out(clip) });
  const neg0 = g.add('CLIPTextEncode', { text: p.negativePrompt || LTX_NEGATIVE, clip: g.out(clip) });
  const condStart = g.add('LTXVConditioning', { positive: g.out(pos0), negative: g.out(neg0), frame_rate: LTX_FPS });
  let positive: Link = g.out(condStart, 0);
  let negative: Link = g.out(condStart, 1);

  // An end keyframe needs 8 extra frames past the clip (kept on the 8n+1 grid), trimmed back off the decoded
  // video below — a community fix for artifacts LTX otherwise leaves on the true last frame.
  const hasEndKeyframe = (p.keyframes ?? []).some((k) => ltxKeyframeFrameIdx(k.timeSec, p.length).isEnd);
  const length = hasEndKeyframe ? p.length + 8 : p.length;

  const genWidth = p.twoStage ? p.width / 2 : p.width;
  const genHeight = p.twoStage ? p.height / 2 : p.height;
  let latent: Link = g.out(g.add('EmptyLTXVLatentVideo', { width: genWidth, height: genHeight, length, batch_size: 1 }));
  const audioLatent = g.out(g.add('LTXVEmptyLatentAudio', { audio_vae: g.out(audioVae), frames_number: length, frame_rate: LTX_FPS, batch_size: 1 }));
  const loadRaw = (image: string) => g.out(g.add('LoadImage', { image }));

  const refImageRaw = p.refImage ? loadRaw(p.refImage) : undefined;
  let refReapply: Link | undefined; // the frame-0 image, reapplied via LTXVImgToVideoInplace in stage 2
  if (refImageRaw) {
    const guided = g.add('LTXVAddGuide', { positive, negative, vae: g.out(vae), latent, image: refImageRaw, frame_idx: 0, strength: 1 });
    [positive, negative, latent] = [g.out(guided, 0), g.out(guided, 1), g.out(guided, 2)];
    refReapply = refImageRaw;
  }

  if (p.controlVideo) {
    const video = g.add('LoadVideo', { file: p.controlVideo });
    const frames = g.add('GetVideoComponents', { video: g.out(video) });
    const control = (p.preprocess ?? 'canny') === 'canny' ? g.out(g.add('Canny', { image: g.out(frames, 0), low_threshold: 0.1, high_threshold: 0.6 })) : g.out(frames, 0);
    const guidedControl = g.add('LTXVAddGuide', { positive, negative, vae: g.out(vae), latent, image: control, frame_idx: 0, strength: 1, iclora_parameters: controlIcParams });
    [positive, negative, latent] = [g.out(guidedControl, 0), g.out(guidedControl, 1), g.out(guidedControl, 2)];
  }

  if (usingSheet) {
    const video = g.add('LoadVideo', { file: p.referenceSheetVideo! });
    const sheetFrames = g.out(g.add('GetVideoComponents', { video: g.out(video) }), 0);
    const guidedSheet = g.add('LTXVAddGuide', { positive, negative, vae: g.out(vae), latent, image: sheetFrames, frame_idx: 0, strength: 1, iclora_parameters: sheetIcParams });
    [positive, negative, latent] = [g.out(guidedSheet, 0), g.out(guidedSheet, 1), g.out(guidedSheet, 2)];
  }

  // Chained keyframes: each is its own LTXVAddGuide at its resolved frame index. Stage 2 (below) re-applies
  // each one at strength 1 on the upscaled latent, per the official two-stage pattern.
  const stage2Keyframes: { image: Link; frameIdx: number; strength: number }[] = [];
  for (const kf of p.keyframes ?? []) {
    const { frameIdx, isEnd } = ltxKeyframeFrameIdx(kf.timeSec, p.length);
    const image = loadRaw(kf.image);
    const strength = kf.strength ?? 0.7;
    const resolvedFrameIdx = isEnd ? -1 : frameIdx;
    const guided = g.add('LTXVAddGuide', { positive, negative, vae: g.out(vae), latent, image, frame_idx: resolvedFrameIdx, strength });
    [positive, negative, latent] = [g.out(guided, 0), g.out(guided, 1), g.out(guided, 2)];
    stage2Keyframes.push({ image, frameIdx: resolvedFrameIdx, strength: 1 });
  }

  const av = g.add('LTXVConcatAVLatent', { video_latent: latent, audio_latent: audioLatent });
  const sampler = g.add('SamplerEulerAncestral', { eta: 0, s_noise: 1 });
  const guider = g.add('LTXVDualCFGGuider', { model, positive, negative, video_cfg: 1, audio_cfg: 1 });
  const sampled = g.out(
    g.add('SamplerCustomAdvanced', {
      noise: g.out(g.add('RandomNoise', { noise_seed: clampSeed(p.seed) })),
      guider: g.out(guider),
      sampler: g.out(sampler),
      sigmas: g.out(g.add('ManualSigmas', { sigmas: LTX_SIGMAS })),
      latent_image: g.out(av),
    }),
  );
  const split = g.add('LTXVSeparateAVLatent', { av_latent: sampled });

  let frames2: Link;
  let audio2: Link;
  if (p.twoStage) {
    // Crop the guide frames off the video latent before upscaling (mirrors the official graph, which wires
    // LTXVCropGuides between stage 1 and the "Upscale and re-sampler" subgraph); stage 1's audio latent is
    // passed straight through, uncropped and unscaled.
    const cropped = g.add('LTXVCropGuides', { positive, negative, latent: g.out(split, 0) });
    let stage2Positive: Link = g.out(cropped, 0);
    let stage2Negative: Link = g.out(cropped, 1);
    const upscaler = g.add('LatentUpscaleModelLoader', { model_name: f.upscaler });
    let stage2Latent: Link = g.out(g.add('LTXVLatentUpsampler', { samples: g.out(cropped, 2), upscale_model: g.out(upscaler), vae: g.out(vae) }));
    // Re-apply the frame-0 reference image on the upscaled latent, as the official note says ("The original
    // image is used here again for conditioning, if you entered one").
    if (refReapply) {
      stage2Latent = g.out(g.add('LTXVImgToVideoInplace', { vae: g.out(vae), image: refReapply, latent: stage2Latent, strength: 1, bypass: false }));
    }
    // Re-apply every other keyframe with a fresh LTXVAddGuide on the upscaled latent (strength 1), then crop
    // those guide frames back off before decoding — the control-video/sheet IC-LoRA guides are never
    // reapplied, since they were already cropped out above, matching the official graph.
    for (const kf of stage2Keyframes) {
      const guided = g.add('LTXVAddGuide', { positive: stage2Positive, negative: stage2Negative, vae: g.out(vae), latent: stage2Latent, image: kf.image, frame_idx: kf.frameIdx, strength: kf.strength });
      [stage2Positive, stage2Negative, stage2Latent] = [g.out(guided, 0), g.out(guided, 1), g.out(guided, 2)];
    }
    const av2 = g.add('LTXVConcatAVLatent', { video_latent: stage2Latent, audio_latent: g.out(split, 1) });
    const guider2 = g.add('LTXVDualCFGGuider', { model, positive: stage2Positive, negative: stage2Negative, video_cfg: 1, audio_cfg: 1 });
    const sampler2 = g.add('KSamplerSelect', { sampler_name: 'euler' });
    const sampled2 = g.out(
      g.add('SamplerCustomAdvanced', {
        noise: g.out(g.add('RandomNoise', { noise_seed: 42 })),
        guider: g.out(guider2),
        sampler: g.out(sampler2),
        sigmas: g.out(g.add('ManualSigmas', { sigmas: LTX_IC_STAGE2_SIGMAS })),
        latent_image: g.out(av2),
      }),
    );
    const split2 = g.add('LTXVSeparateAVLatent', { av_latent: sampled2 });
    if (stage2Keyframes.length) {
      const cropped2 = g.add('LTXVCropGuides', { positive: stage2Positive, negative: stage2Negative, latent: g.out(split2, 0) });
      frames2 = g.out(cropped2, 2);
    } else {
      frames2 = g.out(split2, 0);
    }
    audio2 = g.out(split2, 1);
  } else {
    const cropped = g.add('LTXVCropGuides', { positive, negative, latent: g.out(split, 0) });
    frames2 = g.out(cropped, 2);
    audio2 = g.out(split, 1);
  }

  let decodedImages: Link = g.out(g.add('VAEDecodeTiled', { samples: frames2, vae: g.out(vae), tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 }));
  if (hasEndKeyframe) {
    // Community end-frame fix: trim the 8 extra frames back off the decoded picture. The decoded audio is not
    // trimmed to match (no core node for it verified here) — unverified without a GPU, see the task report.
    decodedImages = g.out(g.add('ImageFromBatch', { image: decodedImages, batch_index: 0, length: p.length }));
  }
  const sound = g.add('LTXVAudioVAEDecode', { samples: audio2, audio_vae: g.out(audioVae) });
  const outVideo = g.add('CreateVideo', { images: decodedImages, audio: g.out(sound), fps: LTX_FPS });
  g.add('SaveVideo', { video: g.out(outVideo), filename_prefix: p.filenamePrefix ?? 'studio/ltx_ic', format: 'mp4', 'format.codec': 'h264' }, 'output');
  return g.nodes;
}

/** Files the opt-in MiniMax H3 video backend needs. */
export const H3_FILES = [MODEL_FILES.minimax.unet, MODEL_FILES.minimax.clip, MODEL_FILES.minimax.vae, MODEL_FILES.minimax.audioVae, MODEL_FILES.minimax.turbo];

/** Files the opt-in LTX-2.5 video backend needs. */
export const LTX_FILES = [MODEL_FILES.ltx.unet, MODEL_FILES.ltx.clip, MODEL_FILES.ltx.vae, MODEL_FILES.ltx.audioVae, MODEL_FILES.ltx.upscaler];

/** Files the opt-in Ingredients reference-sheet mode needs, alongside the base 'ltx' group's files
 *  (ltx_ic's own control-video mode needs MODEL_FILES.ltx.icLora instead; either or both may be installed). */
export const LTX_INGREDIENTS_FILES = [MODEL_FILES.ltx.unet, MODEL_FILES.ltx.clip, MODEL_FILES.ltx.vae, MODEL_FILES.ltx.audioVae, MODEL_FILES.ltx.icLoraIngredients];

/** Model files an engine needs (used to compute availability). */
export const ENGINE_FILES = {
  zimage: [MODEL_FILES.zimage.unet, MODEL_FILES.zimage.clip, MODEL_FILES.zimage.vae],
  qwen_edit: [MODEL_FILES.qwenEdit.unet, MODEL_FILES.qwenEdit.clip, MODEL_FILES.qwenEdit.vae, MODEL_FILES.qwenEdit.lightning],
  qwen_angle: [MODEL_FILES.qwenEdit.unet, MODEL_FILES.qwenEdit.clip, MODEL_FILES.qwenEdit.vae, MODEL_FILES.qwenEdit.lightning, MODEL_FILES.qwenEdit.angles],
  wan_i2v: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.wan.i2vHigh, MODEL_FILES.wan.i2vLow, MODEL_FILES.wan.i2vLightningHigh, MODEL_FILES.wan.i2vLightningLow],
  wan_t2v: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.wan.t2vHigh, MODEL_FILES.wan.t2vLow, MODEL_FILES.wan.t2vLightningHigh, MODEL_FILES.wan.t2vLightningLow],
  wan_animate: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.animate.unet, MODEL_FILES.animate.clipVision],
  wan_control: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.control.high, MODEL_FILES.control.low, MODEL_FILES.wan.i2vLightningHigh, MODEL_FILES.wan.i2vLightningLow],
  wan_vace: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.vace.high, MODEL_FILES.vace.low, MODEL_FILES.wan.i2vLightningHigh, MODEL_FILES.wan.i2vLightningLow],
  h3_ref: [MODEL_FILES.minimax.clip, MODEL_FILES.minimax.vae, MODEL_FILES.minimax.audioVae, MODEL_FILES.minimax.ref2va, MODEL_FILES.minimax.refTurbo],
  ltx_ic: [MODEL_FILES.ltx.unet, MODEL_FILES.ltx.clip, MODEL_FILES.ltx.vae, MODEL_FILES.ltx.audioVae, MODEL_FILES.ltx.icLora],
} as const;

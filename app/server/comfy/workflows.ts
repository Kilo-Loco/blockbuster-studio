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
  animate: {
    unet: 'wan_animate_2_distill_int8_convrot.safetensors',
    clipVision: 'clip_vision_h.safetensors',
  },
  minimax: {
    unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    vae: 'minimax_h3_video_vae_int8_convrot.safetensors',
    audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
    turbo: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
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
  filenamePrefix?: string;
}

export function buildMiniMaxH3(p: MiniMaxH3Params): ApiWorkflow {
  const g = new Graph();
  const f = MODEL_FILES.minimax;
  const unet = g.add('UNETLoader', { unet_name: f.unet, weight_dtype: 'default' });
  const model = chainLoras(g, g.out(unet), [{ filename: f.turbo, strength: 1 }]);
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

/** Files the opt-in MiniMax H3 video backend needs. */
export const H3_FILES = [MODEL_FILES.minimax.unet, MODEL_FILES.minimax.clip, MODEL_FILES.minimax.vae, MODEL_FILES.minimax.audioVae, MODEL_FILES.minimax.turbo];

/** Model files an engine needs (used to compute availability). */
export const ENGINE_FILES = {
  zimage: [MODEL_FILES.zimage.unet, MODEL_FILES.zimage.clip, MODEL_FILES.zimage.vae],
  qwen_edit: [MODEL_FILES.qwenEdit.unet, MODEL_FILES.qwenEdit.clip, MODEL_FILES.qwenEdit.vae, MODEL_FILES.qwenEdit.lightning],
  qwen_angle: [MODEL_FILES.qwenEdit.unet, MODEL_FILES.qwenEdit.clip, MODEL_FILES.qwenEdit.vae, MODEL_FILES.qwenEdit.lightning, MODEL_FILES.qwenEdit.angles],
  wan_i2v: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.wan.i2vHigh, MODEL_FILES.wan.i2vLow, MODEL_FILES.wan.i2vLightningHigh, MODEL_FILES.wan.i2vLightningLow],
  wan_t2v: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.wan.t2vHigh, MODEL_FILES.wan.t2vLow, MODEL_FILES.wan.t2vLightningHigh, MODEL_FILES.wan.t2vLightningLow],
  wan_animate: [MODEL_FILES.wan.clip, MODEL_FILES.wan.vae, MODEL_FILES.animate.unet, MODEL_FILES.animate.clipVision],
} as const;

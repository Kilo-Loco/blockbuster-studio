// One entry point for "render this clip": picks Wan 2.2 or an opt-in backend (MiniMax H3, LTX-2.5).
//
// An opt-in backend is used when its files are installed (DOWNLOAD_MINIMAX_MODELS / DOWNLOAD_LTX_MODELS),
// H3 first, except when the request carries Wan LoRAs and Wan is installed too (neither can load Wan
// LoRAs). Each model only receives the LoRAs of its own family, and prompts are rewritten into the
// model's prompt structure. Engine ids stay wan_i2v / wan_t2v so the UI, queue and storyboard code don't
// need a second path; the asset's params record which model actually rendered it (`videoModel`).
import type { AspectRatio, VideoModelId, VideoQuality } from '../../shared/types';
import { VIDEO_SIZES, WAN_FPS, clampDuration, framesForDuration } from '../../shared/presets';
import {
  H3_FPS,
  LTX_FPS,
  buildLtx25,
  buildMiniMaxH3,
  buildWanI2V,
  buildWanT2V,
  h3FramesForDuration,
  ltxFramesForDuration,
  type ApiWorkflow,
  type LoraFile,
} from '../comfy/workflows';
import { computeFileAvailability } from '../system';
import { formatH3Prompt } from './h3_prompt';
import { formatLtxPrompt } from './ltx_prompt';
import type { ComfyClient, ComfyOutputFile } from '../comfy/client';

export type VideoModel = VideoModelId;

export interface ClipRequest {
  prompt: string;
  negativePrompt: string;
  aspect: AspectRatio;
  quality: VideoQuality;
  durationSec: number;
  seed: number;
  /** ComfyUI input filenames. Without startImage this is text-to-video. */
  startImage?: string;
  endImage?: string;
  /** Video LoRAs; each backend uses the ones of its own family (wan22 / minimax_h3 / ltx2). */
  loras: LoraFile[];
  /** GPU memory, for the longest HD clips (see durationsFor). */
  vramTotalMB?: number;
  /** LTX-2.5 only: a ComfyUI input WAV (the shot's recorded line, already clip length) the clip is animated
   *  to, so the character speaks in their own voice. Other models ignore it. */
  audioFile?: string;
}

export interface ClipResult {
  files: ComfyOutputFile[];
  fps: number;
  model: VideoModel;
}

/** Wan's sizes snapped to a model's grid: H3 needs 32 px (Wan's 720p sizes are 16-aligned); LTX-2.5 needs
 *  64 px because its first pass renders at half size on a 32 px latent grid. */
export function gridSize(quality: VideoQuality, aspect: AspectRatio, grid: 32 | 64): { width: number; height: number } {
  const s = VIDEO_SIZES[quality][aspect];
  const r = (v: number) => Math.max(grid, Math.round(v / grid) * grid);
  return { width: r(s.width), height: r(s.height) };
}

/** LoRAs without a family predate MiniMax support and are Wan LoRAs. */
const isWanLora = (l: LoraFile) => (l.family ?? 'wan22') === 'wan22';

export async function pickVideoModel(comfy: ComfyClient, opts: { loras: LoraFile[]; textOnly: boolean; prefer?: VideoModel }): Promise<VideoModel | null> {
  const av = await computeFileAvailability(comfy);
  const wan = opts.textOnly ? av.wan_t2v || (av.zimage && av.wan_i2v) : av.wan_i2v;
  // A shot's explicit choice wins when that model is installed; otherwise fall through to the default order.
  if (opts.prefer === 'minimax_h3' && av.minimax_h3) return 'minimax_h3';
  if (opts.prefer === 'ltx_2_5' && av.ltx_2_5) return 'ltx_2_5';
  if (opts.prefer === 'wan' && wan) return 'wan';
  if (!(opts.loras.some(isWanLora) && wan)) {
    if (av.minimax_h3) return 'minimax_h3';
    if (av.ltx_2_5) return 'ltx_2_5';
  }
  return wan ? 'wan' : null;
}

export function buildClipWorkflow(model: VideoModel, req: ClipRequest, wanT2VInstalled: boolean): { workflow: ApiWorkflow; fps: number } {
  if (model === 'minimax_h3') {
    const size = gridSize(req.quality, req.aspect, 32);
    return {
      workflow: buildMiniMaxH3({
        prompt: formatH3Prompt(req.prompt, { firstFrame: Boolean(req.startImage) }),
        width: size.width,
        height: size.height,
        length: h3FramesForDuration(clampDuration(req.durationSec, 'minimax_h3', { quality: req.quality, vramTotalMB: req.vramTotalMB })),
        seed: req.seed,
        startImage: req.startImage,
        endImage: req.endImage,
        loras: req.loras.filter((l) => l.family === 'minimax_h3'),
      }),
      fps: H3_FPS,
    };
  }
  if (model === 'ltx_2_5') {
    const size = gridSize(req.quality, req.aspect, 64);
    return {
      workflow: buildLtx25({
        prompt: formatLtxPrompt(req.prompt, { firstFrame: Boolean(req.startImage), lastFrame: Boolean(req.endImage) }),
        width: size.width,
        height: size.height,
        length: ltxFramesForDuration(clampDuration(req.durationSec, 'ltx_2_5', { quality: req.quality, vramTotalMB: req.vramTotalMB })),
        seed: req.seed,
        startImage: req.startImage,
        endImage: req.endImage,
        loras: req.loras.filter((l) => l.family === 'ltx2'),
        audioFile: req.audioFile,
      }),
      fps: LTX_FPS,
    };
  }
  const size = VIDEO_SIZES[req.quality][req.aspect];
  const common = {
    prompt: req.prompt,
    negativePrompt: req.negativePrompt,
    width: size.width,
    height: size.height,
    length: framesForDuration(clampDuration(req.durationSec, 'wan')),
    fps: WAN_FPS,
    seed: req.seed,
    loras: req.loras.filter(isWanLora),
  };
  if (req.startImage) return { workflow: buildWanI2V({ ...common, startImage: req.startImage, endImage: req.endImage }), fps: WAN_FPS };
  if (!wanT2VInstalled) throw new Error('Text-to-video needs a keyframe first on this pod');
  return { workflow: buildWanT2V(common), fps: WAN_FPS };
}

/** Queue one clip and wait for it. `onProgress` gets 0..1. */
export async function renderClip(
  comfy: ComfyClient,
  model: VideoModel,
  req: ClipRequest,
  onProgress: (frac: number) => void,
): Promise<ClipResult> {
  const av = model === 'wan' && !req.startImage ? await computeFileAvailability(comfy) : undefined;
  const vramTotalMB = model !== 'wan' && req.quality === 'hd' ? (await comfy.systemStats()).vramTotalMB : undefined;
  const { workflow, fps } = buildClipWorkflow(model, { vramTotalMB, ...req }, av?.wan_t2v ?? true);
  const promptId = await comfy.queuePrompt(workflow);
  await comfy.waitFor(promptId, workflow, onProgress);
  return { files: await comfy.getOutputs(promptId), fps, model };
}

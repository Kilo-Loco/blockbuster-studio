// One entry point for "render this clip": picks Wan 2.2 or the opt-in MiniMax H3 backend.
//
// H3 is used when its files are installed (DOWNLOAD_MINIMAX_MODELS=true), except when the request
// carries Wan LoRAs and Wan is installed too (H3 can't load Wan LoRAs). Engine ids stay
// wan_i2v / wan_t2v so the UI, queue and storyboard code don't need a second path; the asset's
// params record which model actually rendered it (`videoModel`).
import type { AspectRatio, VideoQuality } from '../../shared/types';
import { VIDEO_SIZES, WAN_FPS, framesForDuration } from '../../shared/presets';
import { H3_FPS, buildMiniMaxH3, buildWanI2V, buildWanT2V, h3FramesForDuration, type ApiWorkflow, type LoraFile } from '../comfy/workflows';
import { computeFileAvailability } from '../system';
import type { ComfyClient, ComfyOutputFile } from '../comfy/client';

export type VideoModel = 'wan' | 'minimax_h3';

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
  /** Wan LoRAs (ignored by H3). */
  loras: LoraFile[];
}

export interface ClipResult {
  files: ComfyOutputFile[];
  fps: number;
  model: VideoModel;
}

/** H3 needs width/height on a 32 px grid (Wan's 720p sizes are 16-aligned). */
export function h3Size(quality: VideoQuality, aspect: AspectRatio): { width: number; height: number } {
  const s = VIDEO_SIZES[quality][aspect];
  const r = (v: number) => Math.max(32, Math.round(v / 32) * 32);
  return { width: r(s.width), height: r(s.height) };
}

export async function pickVideoModel(comfy: ComfyClient, opts: { hasLoras: boolean; textOnly: boolean }): Promise<VideoModel | null> {
  const av = await computeFileAvailability(comfy);
  const wan = opts.textOnly ? av.wan_t2v || (av.zimage && av.wan_i2v) : av.wan_i2v;
  if (av.minimax_h3 && !(opts.hasLoras && wan)) return 'minimax_h3';
  return wan ? 'wan' : null;
}

export function buildClipWorkflow(model: VideoModel, req: ClipRequest, wanT2VInstalled: boolean): { workflow: ApiWorkflow; fps: number } {
  if (model === 'minimax_h3') {
    const size = h3Size(req.quality, req.aspect);
    return {
      workflow: buildMiniMaxH3({
        prompt: req.prompt,
        width: size.width,
        height: size.height,
        length: h3FramesForDuration(req.durationSec),
        seed: req.seed,
        startImage: req.startImage,
        endImage: req.endImage,
      }),
      fps: H3_FPS,
    };
  }
  const size = VIDEO_SIZES[req.quality][req.aspect];
  const common = {
    prompt: req.prompt,
    negativePrompt: req.negativePrompt,
    width: size.width,
    height: size.height,
    length: framesForDuration(req.durationSec),
    fps: WAN_FPS,
    seed: req.seed,
    loras: req.loras,
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
  const { workflow, fps } = buildClipWorkflow(model, req, av?.wan_t2v ?? true);
  const promptId = await comfy.queuePrompt(workflow);
  await comfy.waitFor(promptId, workflow, onProgress);
  return { files: await comfy.getOutputs(promptId), fps, model };
}

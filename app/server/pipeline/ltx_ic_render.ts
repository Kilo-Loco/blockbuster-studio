// Shared upload/prep logic for LTX-2.5's IC-LoRA union-control + Ingredients graph (buildLtxIc in
// comfy/workflows.ts): resolves a control video and/or reference sheet/image and any keyframes into the
// ComfyUI input filenames and frame geometry buildLtxIc needs. Used by both generate.ts's `ltx_ic` engine case
// and shot_video.ts's scene-previs branch, so the two don't duplicate the size/duration/upload logic.
import type { AspectRatio, Asset, VideoQuality } from '../../shared/types';
import { clampDuration } from '../../shared/presets';
import { LTX_FPS, LTX_INGREDIENTS_MIN_FRAMES, ltxFramesForDuration, type LtxIcKeyframe } from '../comfy/workflows';
import { gridSize } from './video_backend';
import { assetDiskPath, buildReferenceSheetVideo, fitImageToFrame, prepareControlVideo, uploadAssetToComfy } from './media';
import type { ComfyClient } from '../comfy/client';

export interface LtxIcRenderKeyframeInput {
  asset: Asset;
  timeSec: number;
  strength?: number;
}

export interface LtxIcRenderInput {
  comfy: ComfyClient;
  aspect: AspectRatio;
  quality: VideoQuality;
  /** Requested clip length; clamped into LTX-2.5's range and, when a control video is given, to its own
   *  duration (never render past the source). */
  durationSec: number;
  /** The control video (a Blender previs, previs depth pass, or any footage) and how to read it. */
  control?: { asset: Asset; preprocess?: 'none' | 'canny'; startSec?: number };
  /** A single reference image (equivalent to a keyframe at time 0, kept separate for the plain refImage field). */
  refImage?: Asset;
  /** An Ingredients reference sheet (a still composited image, looped into a static video). */
  sheet?: Asset;
  keyframes?: LtxIcRenderKeyframeInput[];
}

export interface LtxIcRenderPlan {
  width: number;
  height: number;
  length: number;
  twoStage: boolean;
  controlVideo?: string;
  refImage?: string;
  referenceSheetVideo?: string;
  keyframes?: LtxIcKeyframe[];
}

/** Resolves inputs into everything buildLtxIc needs, uploading control/reference media to ComfyUI along the
 *  way. Does not queue or wait on anything — the caller builds the prompt, LoRAs and workflow itself. */
export async function prepareLtxIcRender(input: LtxIcRenderInput): Promise<LtxIcRenderPlan> {
  const { comfy, control, quality } = input;
  // The union-control IC-LoRA's reference_downscale_factor (2) needs an even latent grid; two-stage hd samples
  // stage 1 at half size, so the full size must be a multiple of 128 with a control video (16:9 hd -> 1280x768).
  const size = gridSize(quality, input.aspect, control && quality === 'hd' ? 128 : 64);
  const maxSec = control ? Math.max(1, control.asset.durationSec ?? input.durationSec) : Infinity;
  const sec = Math.min(clampDuration(input.durationSec, 'ltx_2_5', { quality }), maxSec);
  const length = ltxFramesForDuration(sec);

  const controlVideo = control
    ? await comfy.uploadImage(
        await prepareControlVideo(assetDiskPath(control.asset), { fps: LTX_FPS, width: size.width, height: size.height, frames: length, startSec: control.startSec }),
        `${control.asset.id}_control.mp4`,
      )
    : undefined;
  const refImage = input.refImage ? await comfy.uploadImage(await fitImageToFrame(assetDiskPath(input.refImage), size.width, size.height, 'crop'), `${input.refImage.id}_ref.png`) : undefined;
  const referenceSheetVideo = input.sheet
    ? await comfy.uploadImage(
        await buildReferenceSheetVideo(assetDiskPath(input.sheet), { fps: LTX_FPS, width: size.width, height: size.height, frames: Math.max(LTX_INGREDIENTS_MIN_FRAMES, length) }),
        `${input.sheet.id}_sheet.mp4`,
      )
    : undefined;
  const keyframes = input.keyframes?.length
    ? await Promise.all(input.keyframes.map(async (kf) => ({ image: await uploadAssetToComfy(comfy, kf.asset), timeSec: kf.timeSec, strength: kf.strength })))
    : undefined;

  return { width: size.width, height: size.height, length, twoStage: quality === 'hd', controlVideo, refImage, referenceSheetVideo, keyframes };
}

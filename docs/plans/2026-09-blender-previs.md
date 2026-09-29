# Blender previs → AI video: what the workflow is, and what of it belongs in the studio

Source: "How To Save AI Credits With Higgsfield + Blender" (youtube.com/watch?v=OiULPvTJ-0E,
transcribed 2026-09-27). The video sells a Higgsfield Blender plug-in, but the method underneath it is
model-agnostic. This note strips the method out, checks each piece against what Blockbuster Studio already
does, and records what we added and what we deliberately left out.

## The advice, deconstructed

| # | Claim in the video | What it really is | Evidence offered |
|---|---|---|---|
| 1 | "Build the entire scene first in Blender, every camera angle, every move, every second, before spending a single credit." | **Previs**: gray-box geometry + keyframed cameras on a timeline. Film has done this for decades; the new part is that an LLM can build the blockout from a sentence. | The corridor shot: text-only prompting "burns credits and the camera still drifts"; the blocked version matched the intended move. |
| 2 | Render the blockout as a playblast (1080p, 24 fps), then ask the LLM to "write a prompt second by second to match the camera moves in the clip". | **Timed prompt from the blocking**: the blocking video is the source of truth for timing; the prompt is derived from it, not written from imagination. | The reveal, tilt and profile tracking "hit on cue" in the generated clip. |
| 3 | Feed the blocking video + character sheet + assets to the model. "The gray box handles camera timing, the references handle visuals." | **Two-layer prompt**: a *structural* layer (cuts, camera, timing, blocking) and a *style* layer (what the world looks like). | Same edit rendered in 2.5D, 2D ink and toy-box 3D "frame for frame". |
| 4 | Dialogue scenes: six people, four cuts, who sits where, eyelines, the 180° rule, all locked by the blockout. | **Spatial continuity from geometry**, not from prose. | Without the blockout "people swap seats every take"; ~5,000 credits burned. |
| 5 | Camera tricks (orbit, floor rise, robo-arm whip) described "like talking to a DOP": rails, targets, specific cuts; the camera tracks a target offset from the head; subtle handheld noise. | **Camera rigging vocabulary** the LLM can execute in 3D: path + target + lens, noise modifier for handheld. | Text-only versions "spun 180° on their own axis". |
| 6 | Product ads: the can is a cylinder, ice is cubes; leave liquid blank and let the AI fill it; client changes are re-cuts of the blockout, not re-prompts; speed ramps set in the blocking. | **Cheap iteration lives in the blockout**; timing changes never touch the prompt. | Ad re-cut with a new opening and speed ramp "on the first try". |
| 7 | "Every prompt has two halves: the structural lock (the reference video) that never changes, and the style layer." Pitch three worlds from one edit. | The general principle behind 3, restated as a production strategy. | Night-chase blockout rendered in three styles. |

What the video does *not* say: which model feature makes the blocking video steer the render. In Higgsfield
it is a reference-video (video-to-video) mode; the playblast itself is fed to the model. On self-hosted
models that capability is a **control video** (depth / canny / pose), which is a separate model or LoRA
per family, not something the base models do (see "Research" below).

## Where Blockbuster Studio already does this

- **Blocking and cameras exist, in 2D.** A location has a top-down map in metres, scene/shot blocking
  marks, and a per-shot camera (position, target, height). `shared/camera.ts` turns that into the angle
  plate, screen placements and prompt phrases. That is a floor-plan previs without the time axis.
- **Keyframe-first generation.** Every shot renders a still (compose from references, or generate),
  which is reviewed before the clip is animated from it. The video's "lock the structure first" is the
  same discipline, one level down (a frame instead of a timeline).
- **Camera-move vocabulary.** 17 presets (`CAMERA_MOVES`) with model-specific phrasing (H3's
  type + amplitude + speed). The video's DOP-style requests map onto these.
- **Agents.** `/mcp` lets Claude drive the whole pipeline; the storyboard plan already carries blocking
  and cameras per shot, so a previs tool can feed it directly.

## What was missing, and what we added (2026-09-27)

1. **End frame per shot** (`Shot.endKeyframeAssetId`). All three video builders already supported an
   end image (`WanFirstLastFrameToVideo`, H3 `end_image`, LTX `LTXVAddGuide` at −1) but nothing exposed
   it. Now: `POST /api/shots/:id/select {endKeyframeAssetId}`, `update_shot` in MCP, "As end frame" in the
   gallery's *Add to shot*, an *End frame* row in the shot panel, and `/api/generate` `wan_i2v` takes a
   second input image. This is the cheapest way to hold a previs camera move on our stack: the first and
   last frames of a shot come from the blockout (restyled), and the model interpolates the move between
   them.
2. **Video model per shot** (`Shot.videoModel`, `SystemInfo.videoModels`, storyboard `videoModel`,
   shot-panel *Video model* segment when more than one is installed). Needed as soon as a pod has both
   MiniMax H3 and LTX-2.5: dialogue on LTX (lip sync), long sound-bearing shots on H3.
3. **A Blender previs skill** (`.claude/skills/blender-previs/`): a reproducible headless `build.py`
   template (gray-box set, mannequins, one camera per shot bound to timeline markers, playblast, per-shot
   first/last frames, depth pass, contact sheet, `camera_log.json`) and the prompt recipes per model.
   The agent uses it to write the *structural* half of every prompt from `camera_log.json`, then adds
   the *style* half per shot. See the skill for the exact prompt shapes.

## Added after the first showcase (same day)

The first film proved the diagnosis in the video: first/last frames lock compositions, but each clip still
animates on its own, so motion never connects across cuts. The fix is the video's actual mechanism, a
**control video**: the whole blockout, animated, drives the render.

4. **Control video per shot** (`Shot.controlVideoAssetId`, `controlPreprocess`; engine `wan_control`;
   model group `control`, opt-in `DOWNLOAD_CONTROL_MODELS`). Wan 2.2 Fun-Control was chosen over
   VACE-Fun, LTX IC-LoRA and H3's ControlNet on community adoption, native ComfyUI support, 24 GB fit and the
   uncensored/Apache-2.0 requirement (`docs/research/2026-09-model-review.md`, "Control video"). The gallery's
   *Add to shot* offers *As control video* for any video; the keyframe is the reference image.
5. **Reference-to-video per shot** (`Shot.referenceAssetIds`, `Shot.referenceVideoAssetId`; engine
   `h3_ref`; model group `minimax_ref`, opt-in `DOWNLOAD_MINIMAX_REF_MODELS`). Added after the control-video
   cut moved right but did not look real: MiniMax H3 Ref2VA takes up to 9 reference images (character,
   vehicle and prop sheets, location plates) and 3 reference videos (the playblast), so identity comes from
   the sheets and camera, framing and timing from the blockout without its geometry leaking into the render.
   The gallery's *Add to shot* offers *As reference* for images and *As reference video* for videos
   (`docs/research/2026-09-quarter-mile-showcase.md`, "Second pass").

## What we deliberately did not add

- **A 3D scene editor in the studio.** Blender is free, scriptable and better at this than anything we
  would build; the skill drives it headless. The studio keeps its 2D map.
- **Depth estimation from arbitrary footage.** Edges (Canny) are extracted on the pod by default; a Blender
  depth pass is fed as is. Depth-from-RGB (Depth Anything) is a preprocessor for a later day.

## How the 20-second showcase was made with it

`docs/research/2026-09-first-step-showcase.md` (third film, reference-to-video with the finished loop),
`docs/research/2026-09-quarter-mile-showcase.md` (second) and `docs/research/2026-09-paper-boat-showcase.md` record the story bibles, the Blender build, the prompts
per shot and model, and what worked.

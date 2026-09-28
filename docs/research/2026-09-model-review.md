# Model stack review — 2026-09-25

Question: for each job in Blockbuster Studio, is our model still the best open-weights option that
runs on one 24 GB RTX 4090 in ComfyUI? Sources: Artificial Analysis arenas (open-weights views),
ComfyUI blog/templates, Hugging Face model cards and licenses, community write-ups. Four parallel
research passes plus direct checks of the leaderboards and licenses.

## Summary

| Job | Current | Best-ranked usable alternative | Verdict |
|---|---|---|---|
| Text → image | Z-Image Turbo (Apache-2.0) | FLUX.2 [klein] 4B (Apache-2.0) ranks below it; Qwen-Image-2.1 (#1 open, Elo 1033 vs 940) is **research/non-commercial**; FLUX.2 [dev] non-commercial | **Keep** |
| Single-image edit | Qwen-Image-Edit-2511 + Lightning (Apache-2.0) | HunyuanImage 3.0 Instruct is #1 open (1029 vs 1025) but 80B MoE, 5–10 min/image on a 4090 | **Keep** |
| Multi-reference composition | Qwen-Image-Edit-2511 | Qwen-Image-2.1 (up to 10 refs, released 2026-09-20) — research license, ComfyUI/4090 fit unverified | **Keep; watch 2.1** |
| Camera angles | fal Multiple-Angles LoRA on 2511 | No shipped novel-view model with ComfyUI support | **Keep** |
| Image → video / text → video | Wan 2.2 A14B + lightx2v (Apache-2.0) | **LTX-2.5** (Lightricks, Aug 2026): LTX-2 already beat Wan 2.2 A14B in both arenas (AA, Jan 2026); LTX-2.5 is #2–3 open with audio (I2V 1036, T2V 1055). Native audio, ComfyUI day-one. License free under $10M revenue, no regional exclusion | **Compare side by side** |
| Video (opt-in) | MiniMax H3 | #1 open (I2V 1181, T2V 1220); license excludes US/EU/UK/KR | Keep as opt-in |
| Perform (video → video) | Wan Animate 2 distilled (Apache-2.0) | H3 Fun ControlNet-Union 2.0 (MiniMax license, pose-skeleton driven); Wan 2.2 Fun VACE (older) | **Keep** |

Newer Wan versions (2.7, 3.0) appear on the arena as **closed** models; open Wan weights stop at 2.2
(plus Animate 2). MAGI-2 (#2 open I2V) needs 8× Hopper. HunyuanVideo 1.5 (8.3B, ~75 s/clip on a
4090) and Kandinsky 5 (Apache-2.0) are "watch" — no arena placement found / no native ComfyUI.

## Licenses that matter

- **LTX-2.x Community License**: commercial use free for entities under $10M annual revenue (paid
  agreement above); excludes only sanctioned countries / restricted parties; acceptable-use list
  (minors, deception, non-consensual deepfakes, weapons…); outputs distributed must be disclosed as
  machine-generated; no training other models on outputs for commercial use.
  https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x
- **Qwen-Image-2.1**: research license, commercial use needs a separate agreement.
- **FLUX.2 [dev] / [klein] 9B**: FLUX non-commercial. [klein] 4B: Apache-2.0.
- **MiniMax H3 (+ Fun ControlNet)**: MiniMax Community License, excludes US/EU/UK/KR.

## Open questions to settle by testing (on a real 4090)

1. LTX-2.5 vs Wan 2.2 on our own shots: I2V of storyboard keyframes (identity, motion, camera-move
   adherence), T2V, speed and VRAM fit (22B; fp8/distilled variants), audio quality, LoRA ecosystem.
2. Qwen-Image-2.1 multi-reference composition vs Qwen-Image-Edit-2511, once ComfyUI support and a
   4090-fitting quant are confirmed (would be opt-in only, given its license).
3. H3 Fun ControlNet-Union 2.0 vs Wan Animate 2 on the same recording (opt-in path for H3 users).

## Test: LTX-2.5 vs Wan 2.2 (2026-09-25)

RTX 5090 capped to 24 GB (`--reserve-vram 8`), same keyframes/prompts/camera moves/seed. Wan via the
studio's builders (832×480, 16 fps, lightx2v 4-step); LTX-2.5 via the official distilled template
(896×512, 24 fps, two-stage + audio). One seed per case.

| Case | Wan 2.2 | LTX-2.5 |
|---|---|---|
| Speed, 5 s 480p (warm) | 40–43 s | 32–33 s (+ audio) |
| Speed, 5 s HD | 143 s (1280×720) | 57 s (1280×704) |
| Peak VRAM | 25.3–26.5 GB | 24.8–25.1 GB |
| Ramen (push in) | Identity rock-solid; push-in barely visible | Push-in clear, eating more natural; face/hair drift from keyframe |
| Hank dialogue (static) | Identity solid, silent | **Speaks the line** ("Rough night, huh?" transcribed verbatim); face drifts, leans back unnaturally |
| Alley (orbit left) | Turns and walks away, faithful | More dynamic walk; neon text changes |
| Diner (pan right) | Wrong actor pours (the man) | Waitress acts, man walks out of frame |
| T2V dog (tracking) | Clean, sharp, dog barely moves | Energetic tracking, crowd reacts; dog "walks" on the board |
| T2V alley (pull out) | Bright, sharp, faithful | Moodier, visible heavy rain, darker faces |

Reading: LTX-2.5 wins on speed, frame rate, sound and dialogue; Wan 2.2 wins on identity fidelity to
the keyframe — the property the storyboard pipeline depends on.

### Retest: LTX stage-1 image strength 1.0 (2026-09-25)

Same four I2V cases and seed, stage-1 `LTXVImgToVideoInplace` strength 0.7 → 1.0, with and without
the template's "Use the provided start image as the first frame." prefix. (Timings not comparable:
that host's 5090 was power-capped to 400 W.)

Result: **no meaningful change.** Frames at 0.5 s match the keyframe in every variant, and the
later frames are nearly identical to the 0.7 run. The drift is not a first-frame problem: LTX-2.5
takes bigger liberties over the clip (larger body motion, faces turning into new angles, characters
walking out of frame — in the diner case at 1.0 both characters leave and the camera settles on an
empty counter). Wan 2.2 keeps the cast and composition of the keyframe for the whole shot, which is
what storyboard continuity needs. (Hank leaning back was in the prompt; LTX obeyed it, Wan didn't.)

Decision input: keep Wan 2.2 as the storyboard/I2V default. LTX-2.5 is the better choice when a clip
needs sound or spoken dialogue, or for free-form text-to-video, but its files are HF-gated
(accept terms + token).

## Sources

- https://artificialanalysis.ai/image/leaderboard/text-to-image/open-weights
- https://artificialanalysis.ai/image/leaderboard/editing/open-weights
- https://artificialanalysis.ai/video/leaderboard/image-to-video/open-weights
- https://artificialanalysis.ai/video/leaderboard/text-to-video/open-weights
- https://x.com/ArtificialAnlys/status/2012256702788153604 (LTX-2 surpasses Wan 2.2 A14B, T2V and I2V)
- https://comfyui-wiki.com/en/news/2026-08-11-ltx-2-5-open-weights-release
- https://blog.comfy.org/p/ltx-2-open-source-audio-video-ai
- https://byteiota.com/qwen-image-2-1-open-weights-come-with-a-license-trap/
- https://github.com/QwenLM/Qwen-Image-2.1
- https://huggingface.co/black-forest-labs/FLUX.2-klein-4B
- https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA
- https://blog.comfy.org/p/wan-animate-2-is-now-available-in
- https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0
- https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5
- https://comfyui-wiki.com/en/news/2026-08-05-magi-2-preview

## MiniMax H3: long clips, steps and 2K (2026-09-27)

RTX 5090 with ComfyUI capped to ~24 GB (`--reserve-vram 8`), 4-step turbo LoRA unless noted, same seed.
Peak VRAM is `nvidia-smi` for the whole GPU. Times are 5090 times; a 4090 is slower.

| Clip | Size | Time | Peak VRAM | Result |
|---|---|---|---|---|
| 5 s text | 832×480 | 47 s | 24.9 GB | ok |
| 10 s text | 832×480 | 97 s | 24.7 GB | ok |
| 15 s text | 832×480 | 160 s | 24.7 GB | ok, holds together; mild lighting drift |
| 15 s image | 832×480 | 162 s | 25.2 GB | ok, identity held for the whole clip |
| 5 s text | 1344×768 | 125 s | 24.7 GB | ok |
| 10 s text | 1280×736 | 277 s | 24.8 GB | ok |
| 15 s text | 1280×736 | 495 s | 29.0 GB | ok only because the card has 32 GB |
| 15 s text | 1344×768 | — | 31.3 GB | out of memory, ComfyUI crashed |

Decisions: 480p offers 4–15 s everywhere. HD offers up to 10 s, and 15 s only on GPUs with 30 GB or
more. HD stays at 1280×736; the native 1344×768 costs the same at 5 s but runs out of memory at 15 s.

Steps (fast skateboard kickflip, 832×480, 5 s): 4 steps 51 s, 6 steps 56 s, 8 steps 69 s, and the
8-step LoRA at 8 steps 71 s; at 1344×768, 4 steps 124 s vs 8 steps 210 s. In still frames the
differences are small: the 8-step LoRA followed "steep hill" most closely and the 4-step runs framed
the skater a little farther away. Motion smear can't be judged from stills, so we keep 4 steps.

2K: not available locally. MiniMax makes 2K with "H3-Regenerate-2K", which runs only on their hosted
service (they plan to open-source it "once this set of technologies becomes stable":
https://huggingface.co/MiniMaxAI/MiniMax-H3/discussions/39). The open weights and the 4-step LoRA
target 768p (https://docs.comfy.org/tutorials/video/minimax/minimax-h3). No official VRAM table by
resolution or duration exists.

## LTX-2.5 as default? License and content check (2026-09-27)

Kyle asked to make LTX-2.5 the default video model (quality first, Wan as an env-var fallback),
provided it is at least as good and uncensored. Two findings kept it opt-in:

- **License, missed in the 09-25 review.** The LTX-2.x Community License (LICENSE-2_x, 2026-08-11),
  Attachment A: item 20 forbids using LTX-2.x "in any product, service, or application that directly
  competes with Licensor's commercial products or services" without a separate commercial license
  (Lightricks sells LTX Studio, an AI film/storyboard studio); item 19 forbids circumventing its safety
  features or content filters (so no abliterated Gemma encoder swap); item 5 requires disclosing
  distributed outputs as machine-generated. The $10M revenue threshold still applies on top.
  https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x
- **Content.** Nothing in the model blocks prompts, but it was trained on mostly SFW data, so NSFW output
  is poor without fine-tunes; the Wan 2.2 LoRA ecosystem is far larger. The stock Gemma encoder can also
  mangle some prompts. Not "uncensored" in the sense Kyle asked for.

Decision (Kyle): **LTX-2.5 ships as an opt-in** (`DOWNLOAD_LTX_MODELS=true`), exactly like MiniMax H3:
off by default, replaces the Wan I2V/T2V downloads when on, the deployer checks the license. H3 wins if
both are on. Files come from the gated `Lightricks/LTX-2.5` repo (gating "auto": accept terms + `HF_TOKEN`);
no third-party mirrors. The builder ports Comfy-Org's `video_ltx2_5_{i2v,t2v,flf2v}.json` templates; for
storyboard shots with an end keyframe it uses the first/last-frame guides (`LTXVAddGuide` at 0 and -1),
the documented way to hold a shot to its keyframes. Still to measure on a 4090: time and peak VRAM for
5 s / 10 s at 480p and HD (HD is capped at 5 s on 24 GB until then), and drift on the 09-25 cases with
the end-frame guide.

### Measured on a Runpod RTX 4090 (2026-09-27)

Secure-cloud RTX 4090 (24 GB, host CUDA 13.0), published image plus this branch's downloader, ComfyUI at
the pinned commit, `--cache-lru 32`. `buildLtx25` graphs queued straight to ComfyUI; keyframe from Z-Image.
Peak VRAM sits at ~24 GB in every run because ComfyUI streams the 21.5 GB transformer and 15.4 GB
Gemma encoder into whatever is free; nothing ran out of memory.

| Case | Size | Time | Result |
|---|---|---|---|
| I2V 5 s, first run after boot | 832×512 | 133 s | speaks "Rough night, huh?" verbatim; identity holds |
| I2V 5 s, warm | 832×512 | 41 s | same |
| I2V 10 s | 832×512 | 73 s | ok |
| I2V 5 s | 1280×704 | 78–80 s | line verbatim |
| I2V 8 s | 1280×704 | 159 s | ok |
| I2V 10 s | 1280×704 | 151 s | line verbatim; identity holds for the full 10 s |
| T2V 5 s (dog, tracking) | 832×512 | 82 s | energetic, clean; ambient audio |
| First/last frame 5 s | 832×512 | 92 s | lands on the end keyframe |
| First/last frame 5 s | 1280×704 | 111 s | ok |

Every clip is 24 fps h264 with 48 kHz stereo AAC. Changes from this run: HD is offered up to 10 s on
24 GB (the provisional 5 s cap is gone), Composer estimates use these timings, and file availability now
reads the `["COMBO", {options}]` dropdown format that `LatentUpscaleModelLoader` returns (the classic
`[[…]]` check alone would never have marked LTX as installed).

On this keyframe the drift seen on 09-25 didn't show: the face, shirt and diner stayed put for 10 s,
and the man set his cup down and turned to speak as prompted. One keyframe is not a verdict on identity;
the storyboard cases from 09-25 are the fair comparison.

## Control video (video-to-video from a blockout), 2026-09-27

Question: which open-weight model turns a control video (a depth or edge render of a Blender blockout, or any
footage) plus a reference image and a prompt into a clip, on one 24–32 GB GPU in ComfyUI, without a content
filter? Two research passes (candidates, then community sentiment and the uncensored criterion).

| Model | Verdict |
|---|---|
| **Wan 2.2 Fun-Control** (alibaba-pai, Apache-2.0) | **Chosen.** Native `Wan22FunControlToVideo`, official template `video_wan2_2_14B_fun_control.json`, fp8 files in Comfy-Org's repackaged repo, 640×640×81 frames in ~80–140 s on a 4090 with the I2V lightx2v 4-step LoRAs. The model the community actually demonstrates on Blender depth passes (Playbook3D's "Graybox to Rendered Sequence", docs.comfy.org, comfyui-wiki). No content restriction; the Wan 2.2 LoRA ecosystem on Civitai is the largest of any candidate. Weakest point: identity from the reference image is good, not VACE-strong. |
| Wan 2.1 VACE 14B | Best identity from a reference ("king of the controlnets"), but a 2.1 backbone. Fallback if identity beats 2.2 fidelity. |
| Wan 2.2 VACE-Fun-A14B | Real and Apache-2.0, but few workflows or reports yet. Watch. |
| Wan 2.2 Animate | Character/pose transfer, not general structural control. Already shipped as Perform. |
| LTX-2.3/2.5 IC-LoRA | Published for 2.3, docs ask for 32 GB+, and the LTX license forbids removing its safety features and bans explicit content. Out on the uncensored criterion. |
| MiniMax H3 Fun ControlNet-Union 2.0 | Tightest adherence on paper, native support merged 2026-09-22, but the license excludes the US/EU/UK/KR and forbids bypassing safeguards, and it adds 13.5 GB to an already large model. Out. |
| HunyuanVideo 1.5, Kandinsky 5 | No general depth/edge control model. |

Implementation (this branch): model group `control` (`DOWNLOAD_CONTROL_MODELS`, opt-in, ~29 GB), engine
`wan_control` (`buildWanFunControl`, a port of the template: LoadVideo → Canny 0.1/0.6 by default →
Wan22FunControlToVideo with `ref_image` → the two-expert sampler), `Shot.controlVideoAssetId` /
`controlPreprocess` in the shot pipeline with the keyframe as the reference image. The control video is re-timed
to 16 fps and cut to 81 frames per clip. Sources: docs.comfy.org/tutorials/video/wan/wan2-2-fun-control,
huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control, huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged,
civitai.com (Wan 2.2 NSFW LoRAs and workflows), github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x,
huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE.

## Reference-to-video (identity from sheets, camera from a playblast), 2026-09-28

The control-video pass moved right but was judged not to look real. Higgsfield's workflows (Elements, the
character-sheet skill, omni-reference models) point at the missing piece: reference images of every recurring
subject fed into a video model that takes references, with the previs only as a loose guide. On our stack:

| Model | Verdict |
|---|---|
| **MiniMax H3 Ref2VA** (`minimax_h3_ref2va_pruned_int8_convrot` + `ref2v_turbo_4step` LoRA, node `MiniMaxH3ReferenceToVideo`, official ComfyUI template) | **Chosen.** Up to 9 reference images and 3 reference videos, sound included, 4 steps: 480p/4 s in ~85 s, 768p/5 s in ~4 min on an RTX PRO 4500. Same license as the H3 already shipped. Retention levels per reference (`fully_preserved` … `weak_reference`) give per-subject control the control models lack. |
| Wan 2.1 VACE / 2.2 VACE-Fun | Reference + control in one, but one reference image and a 2.1 backbone or a thin ecosystem. |
| LTX-2.5 | No multi-reference mode; license issue as above. |

Implementation (this branch): model group `minimax_ref` (`DOWNLOAD_MINIMAX_REF_MODELS`, opt-in), engine
`h3_ref` (`buildMiniMaxH3Ref`), `Shot.referenceAssetIds` / `referenceVideoAssetId`, plain prompts wrapped into
H3's six-field reference format (`formatH3RefPrompt`), reference videos re-timed to 24 fps and capped at 15 s.
Findings and the graded prompt recipe: `2026-09-quarter-mile-showcase.md`, "Second pass". Sources:
huggingface.co/MiniMaxAI/MiniMax-H3 (docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md), docs.comfy.org MiniMax H3
reference-to-video template, higgsfield.ai (Elements, character-sheet skill).

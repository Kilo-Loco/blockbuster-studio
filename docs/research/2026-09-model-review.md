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

# LTX-2.5 best practices for the previs pipeline (Sept 2026)

Research for making LTX-2.5 a template default: official Lightricks docs (docs.ltx.io, model cards, the
ComfyUI-LTXVideo example workflows and Gemma system prompts, ComfyUI core `comfy_extras/nodes_lt.py`), community
reports, and an audit of our graphs (`buildLtxIc`, `buildLtx25`). Measured results from the Coast Road bake-off are in
[2026-09-model-ledger.md](2026-09-model-ledger.md).

## What the Coast Road tests already showed
- LTX follows the previs frame for frame (cuts exact) but only sees one opening frame, so identity drifts (the face
  changes mid-grin, a headscarf shrinks). H3 keeps its reference sheets for the whole clip and holds identity.
- Prompt wording fixed the headscarf ("tied snugly over all of her hair" instead of "scarf tails fluttering").
- A Blender depth pass (inverse depth, near-bright) beat Canny edges: no phantom second car, cleaner roads.
- Lightricks' two-stage (half size, 2x latent upscale, 3 refine steps) works and gives 1280x704.

## Identity: character and prop sheets
- **Ingredients IC-LoRA** (`Lightricks/LTX-2.5-22b-IC-LoRA-Ingredients`, gated; 2.3 version too) is the one official
  identity path beyond the first frame. One composite reference sheet on black, no text: per character a front close-up
  plus a turnaround, props as product-style renders, the location; bigger panels carry over better; only what is on the
  sheet is reproduced. The sheet is looped into a static video of the output length (>=121 frames) and fed as the
  IC-LoRA reference at output resolution. Prompt in two parts: `Reference sheet: <panels>` / `Generated video: <action>`.
  Card settings: LoRA strength 1.4, 30 steps, CFG 4.0 (the dev model, not distilled), trained bucket 768x448 @ 121 f,
  negative "worst quality, inconsistent motion, blurry, jittery, distorted". Community: good for one character plus
  props; several characters on one sheet degrade. Untested: stacking it with the union-control IC-LoRA.
- **Keyframes**: core `LTXVAddGuide` chains; each call appends a guide at any `frame_idx` (negative counts from the end)
  with its own `strength` (noise mask = 1 - strength). So one generation can pin the first frame of every shot.
  Official image-guide strengths: 0.7 in stage 1 (room for motion), 1.0 in stage 2.
- **End frame**: supported (frame_idx -1); community fix for end artifacts: place it 8 frames past the end and trim 8.
  No official local first/last-frame workflow exists (only the cloud-API template), so our FLF branch is a synthesis.
- **Character LoRA** (LTX trainer, ai-toolkit or musubi-tuner; 20-50 images, ~2,000 steps, hours on 24-48 GB):
  community reports modest identity gains. A fallback, not the first lever.
- Consensus caveat: no LTX setup fully solves identity; plan for QC and retakes.

## Control video (the Blender previs)
- Union control IC-LoRA (one checkpoint for depth/canny/pose), `ref0.5` = control at half the output resolution
  (metadata `reference_downscale_factor` 2, handled correctly by core `GetICLoRAParameters`). Official default annotator
  is depth. Strength 1.0 = full adherence; 0.5-0.8 = softer, more texture and freedom (one community guide: depth
  0.6-0.75). Match control resolution and fps to the generation.
- Official graph does not JPEG-compress control frames (`LTXVPreprocess` only on a start image); ours does -> remove.

## Prompting
- Gemma 4 12B encoder, no published token limit. Single shot: 4-8 concrete sentences, one flowing paragraph, present
  tense; longer only while every sentence adds concrete visual or audio detail. Padding hurts.
- Native multi-shot (2.5): 2-4 shots per generation, prose not shot lists; at each cut name the transition ("A hard cut
  transitions to..."), re-establish scale/angle/light, keep identity wording identical, state audio continuity.
- From the shipped enhancer rules: no invented camera moves, dialogue or cuts; restrained plain wording (plain colour
  and light terms); start directly with the scene; weave sound through the action, not at the end; for image-to-video
  describe changes from the image, since inaccurate restatement "may cause scene cuts".
- Distilled model: CFG 1.0-1.5 only; raising it does not help.

## Length and chunks
- Frames 8n+1, sizes multiples of 32; two-stage output = 2x the base grid.
- No official extend/continuation for LTX-2.5 (hosted `/extend` is 2.3-pro only). Chunk with the previous chunk's last
  frame as the next opening guide and restate identity in every chunk's prompt. No official cross-chunk audio method.

## Licence
LTX-2 Community License (in the LoRA metadata): free under $10M annual revenue, but Attachment A item 20 bars use "in
any product, service, or application that directly competes with Licensor's commercial products or services" without
a commercial licence. Lightricks sells LTX Studio; a video-generation studio template may count. Needs a legal read
before LTX becomes a default.

## Changes to our engine (from the audit)
1. Control frames without JPEG compression (official does none on control).
2. Keyframes: a list of `{image, frameIdx, strength}` guides (0.7 stage 1 / 1.0 stage 2), end frame +8 then trim.
3. Control strength parameter (default 1.0; test 0.7).
4. Ingredients mode: dev transformer (`ltx-2.5-22b-dev-transformer-comfy-int8-convrot`, 21.5 GB) + Ingredients LoRA
   (1.3 GB), reference sheet looped to a video, two-part prompt, 30 steps / CFG 4.
5. `formatLtxPrompt`: drop the invented end-frame sentence; fold "Sound:" into the prose.
6. `buildLtx25` audio-file branch: mux the original waveform instead of VAE-decoding it (official A2V does).

## Measured on Coast Road chunk 2 (5 s, HD two-stage, v5 previs depth pass, seed 7)
| Test | Result |
|---|---|
| T0 depth 1.0 + one opening frame | filmic; face drifts to a different woman, scarf becomes a headband |
| T1 + keyframes at each shot start and an end frame (0.7) | end composition pinned; face unchanged from T0 |
| T2 T1 with control 0.7 | same as T1 |
| T3 Ingredients sheet only | best wardrobe fidelity; ignores the previs (own shots, own order) |
| T4 sheet + depth 1.0 | the two IC-LoRAs fight: scarf lost, identity weak |
| T5 sheet + keyframes, no depth | stays in one shot, ignores the cut |
| **T6 sheet + depth 0.5** | **previs structure kept, scarf tied with pattern, dark hair; grin smaller than H3** |
Chunk 1 with sheet + depth 0.5 skipped the aerial->wheel cut; at 0.7 it cut on 3.00 s exactly. Full film: cuts 3.00 / 5.00 / 7.50.
Rule so far: Ingredients sheet + depth control at 0.5-0.7 (raise it until every previs cut lands). HD with control needs a 128-px grid (16:9 renders 1280x768, crop to 720).

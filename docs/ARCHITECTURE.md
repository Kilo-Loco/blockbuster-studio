# Blockbuster Studio: architecture

A self-hosted AI film studio that runs on **one rented GPU** (default: Runpod RTX 4090 24 GB).
The user clicks **Deploy on Runpod** on our website, sets a password, and opens the pod's proxy URL.
Everything (UI, API, ComfyUI engine, models, LoRA trainer) lives inside one container and the
`/workspace` volume.

```
Browser ──HTTPS (Runpod proxy :3000)──▶ Studio server (Node 22, Hono)
                                          │  REST /api/*  +  SSE /api/events  +  /media/*
                                          │  SQLite (/workspace/studio/studio.db)
                                          │  single GPU job queue
                                          ├──HTTP/WS 127.0.0.1:8188──▶ ComfyUI (headless, unmodified, GPL-3.0)
                                          ├──spawn──▶ ai-toolkit (LoRA training, installed on first use)
                                          ├──spawn──▶ ffmpeg (posters, timeline export)
                                          └──HTTPS──▶ optional LLM (Anthropic or any OpenAI-compatible) for script breakdown
start.sh ──▶ model downloader (python, hf_xet) ──▶ /workspace/models  (status → /workspace/studio/models-status.json)
```

## Repo layout

```
app/                      Node package (TypeScript, ESM)
  shared/                 types + pure logic shared by server and web (no Node/DOM APIs)
    types.ts              data model + API contract (source of truth)
    camera.ts             location-map camera math → multi-angle prompt, screen placement
    presets.ts            aspect ratios, resolutions, durations, camera moves, shot sizes
    models.ts             model manifest (reads config/models.json)
  server/
    index.ts              Hono app, static web, SSE, startup
    config.ts             env config
    db.ts                 better-sqlite3 schema + tiny repository helpers
    auth.ts               password login, HMAC cookie
    events.ts             SSE event bus
    comfy/client.ts       ComfyUI HTTP/WS client
    comfy/workflows.ts    API-format workflow builders (validated against real ComfyUI)
    pipeline/queue.ts     persistent single-worker GPU queue
    pipeline/*.ts         job runners (image, video, edit, angle, shot keyframe/video, export, train)
    pipeline/prompts.ts   prompt assembly from storyboard data
    ai/llm.ts             provider-agnostic LLM call (Anthropic / OpenAI-compatible)
    ai/breakdown.ts       script → characters/locations/scenes/shots
    loras/*.ts            import (Civitai / Hugging Face / URL / upload), training via ai-toolkit
    routes/*.ts           REST routes
    dev/mock-comfy.ts     fake ComfyUI for local development and e2e tests
  web/                    Vite + React 19 SPA
config/models.json        model manifest (used by both the Node server and the Python downloader)
docker/                   Dockerfile, start.sh, download_models.py, extra_model_paths.yaml
runpod/                   template definition + create/update script (needs RUNPOD_API_KEY)
site/                     static landing page with the Deploy on Runpod button
docs/                     this file, research
```

## Core concepts (see `app/shared/types.ts`)

- **Asset**: every image or video (generated or uploaded). It appears in the Studio gallery and can be
  reused as a reference, keyframe, character reference or location establishing shot.
- **Job**: one unit of GPU work (possibly several ComfyUI prompts chained together). Jobs run one at
  a time in a persistent FIFO queue. Progress is streamed over SSE.
- **Character**: name, description (prompt fragment), reference images, optional LoRA plus trigger word.
- **Location**: name, description, **establishing image** (the "front view" reference plate),
  a **top-down map** (meters; walls, props and zones drawn as shapes), a **reference camera** marking
  where on the map the establishing image was taken from, and cached **angle views**.
- **Style**: prompt suffix + optional LoRA, applied project-wide.
- **LoRA**: file in `/workspace/models/loras`, tagged with a base model family
  (`zimage` | `wan22` | `qwen_edit`) and a kind (character | location | style | motion | other).
- **Project (film)** → **Scenes** (each has a location, time of day and scene-level blocking, meaning
  character marks on the location map) → **Shots** (shot size, camera placement on the map, camera move,
  duration, action, dialogue, characters, keyframe asset, video asset).

## The shot pipeline (what makes this more than a prompt box)

Storyboards start from an idea or script: New film → AI breakdown (characters, locations, scenes,
shots) → review → "Create storyboard", which also draws the frames. Drawing frames
(`POST /api/projects/:id/render` with keyframes) first queues any missing character reference sheets
and location establishing images, so every keyframe below can use step 2 rather than text only.

1. **Angle plate**: the shot camera on the location map, relative to the location's reference camera,
   gives azimuth / elevation / distance (`shared/camera.ts`). Qwen-Image-Edit-2511 with the
   Multiple-Angles LoRA re-renders the establishing image from that angle, using the prompt
   `<sks> front-right quarter view elevated shot medium shot`. Plates are cached per
   location + angle bucket.
2. **Keyframe compose**: Qwen-Image-Edit-2511 takes image1 = plate and image2/3 = character reference
   images. The prompt comes from blocking: screen-space left/right and foreground/background of
   each character, projected through the shot camera, plus action and style.
   Fallback when the location has no establishing image: **Z-Image Turbo** text-to-image with character
   and style LoRAs and a prompt built from the same blocking.
3. **Motion**: Wan 2.2 I2V A14B (fp8 + lightx2v 4-step: two-pass high/low noise) from the keyframe,
   with a motion prompt of action + camera-move phrase. Wan LoRAs go on the low-noise expert by default.
   A shot may also carry an **end frame** (`Shot.endKeyframeAssetId`: a second keyframe, or a frame
   uploaded from a previs render); the clip then renders in first/last-frame mode on whichever model is
   installed (`WanFirstLastFrameToVideo`, H3's `end_image`, LTX's `LTXVAddGuide` at frame −1), which is
   what holds a planned camera move. When several video models are installed, `Shot.videoModel` picks one
   (`SystemInfo.videoModels`); otherwise `pickVideoModel`'s order applies.
4. **Timeline**: shots in scene order. Export = ffmpeg normalise + concat → MP4.

The Studio page offers the same engines free-form, like Higgsfield: image, video, edit, angles,
camera-motion presets, batch, and one-click "Animate" and "New angle" on any gallery item.

## GPU / VRAM policy (RTX 4090 24 GB)

- One job at a time. ComfyUI's smart memory offloads between models. Before LoRA training the
  server calls `POST /free {unload_models:true, free_memory:true}` and pauses the queue.
- Video defaults to 832×480 (or 480×832 or 624×624), 81 frames at 16 fps (5 s), 4-step Lightning,
  which takes about 1–2 minutes on a 4090. 720p is offered as "HD (slow)".
- **Opt-in MiniMax H3** (`DOWNLOAD_MINIMAX_MODELS=true`, restricted community license, off by
  default). When its files are installed, `server/pipeline/video_backend.ts` renders Video, Animate
  and storyboard clips with H3 instead of Wan (engine ids stay `wan_i2v`/`wan_t2v`; the asset's
  `params.videoModel` records `minimax_h3`). Enabling it also skips the Wan `video`/`t2v` download groups
  (manifest `replaces`), unless `MODEL_GROUPS` lists them explicitly; with both installed, requests
  carrying Wan LoRAs fall back to Wan. Perform always uses Wan Animate.
  LoRAs carry their family (`wan22` / `minimax_h3`) to the backend, which gives each model only its
  own; H3 LoRAs stack after the turbo LoRA. `server/pipeline/h3_prompt.ts` rewrites prompts into H3's
  official structure (image-alignment line for first-frame clips, `integrated_multimodal_description`
  / `overall_soundscape` / `non_diegetic_music`, camera presets as type + amplitude + speed, quoted
  speech as `<d>[English] …</d>`, "No music." unless the prompt asks for music). H3 renders 24 fps with a stereo soundtrack, sizes on a
  32 px grid (HD = 1280×736) and frame counts on a 17k+5 grid (5 s = 124 frames). Measured
  2026-09-25 on an RTX 5090 capped to 24 GB of VRAM (`--reserve-vram 8`) with nvfp4 emulated as on
  a 4090: 5 s at 864×480 in 42–51 s, 1280×736 in 110 s, peak VRAM 24.9 GB (ComfyUI's dynamic VRAM
  loading streams the 21 GB int8 DiT and the 15.7 GB nvfp4 Qwen3-VL-32B text encoder). Film export
  normalizes mixed Wan/H3 shots to one fps and gives silent shots a silent audio track.
- **Opt-in LTX-2.5** (`DOWNLOAD_LTX_MODELS=true`, LTX-2.x Community License, gated on Hugging Face,
  off by default). Same slot as H3: `video_backend.ts` picks H3, then LTX-2.5, then Wan
  (`params.videoModel` records `ltx_2_5`), the `ltx` group `replaces` the Wan `video`/`t2v` groups, and
  requests carrying Wan LoRAs fall back to Wan when it is installed. LTX LoRAs have the `ltx2` family.
  `buildLtx25` ports Comfy-Org's `video_ltx2_5_*` templates (all nodes ship in core ComfyUI): text/image
  to video renders a half-size pass, upscales the latent x2 and refines at full size; with an end
  keyframe it runs one full-size pass with `LTXVAddGuide` at the first and last frame (the documented way
  to hold a shot to its keyframes). Distilled int8 transformer, Gemma 4 12B text encoder, CFG 1 for video
  and audio, tiled VAE decode, 24 fps on an 8k+1 frame grid, sizes on a 64 px grid (HD = 1280×704).
  `server/pipeline/ltx_prompt.ts` adds the templates' start/end-image line, keeps quoted dialogue as
  written (LTX speaks it), moves `Audio:`/`Music:` to the end and asks for "No music." by default.
  Measured on a Runpod RTX 4090 (2026-09-27): 4–10 s at 832×512 and 1280×704 all fit, 5 s in ~40 s /
  ~80 s warm, 10 s HD in ~2.5 min. The upscaler loader is a newer ComfyUI node whose dropdown comes back
  as `["COMBO", {options}]` in /object_info; `computeFileAvailability` reads both formats. A gated download failure (no
  token, terms not accepted) shows an actionable message in Settings, and the downloader keeps the group
  waiting: it rechecks every 15 s for a new token saved on the Settings page (and every 5 min with the
  same token, in case the terms were accepted since) and resumes without a pod restart. See
  `docs/research/2026-09-model-review.md` for why it is opt-in rather than the default.
- **Character voices** (`DOWNLOAD_VOICE_MODELS`, on by default, Qwen3-TTS 1.7B VoiceDesign + Base,
  Apache-2.0). ComfyUI has no TTS nodes, so `docker/tts/server.py` runs Qwen3-TTS as a sidecar on
  127.0.0.1:8190, in its own venv (`/opt/tts-venv`, `--system-site-packages` for the base torch)
  because `qwen-tts` pins transformers 4.57.3. `start.sh` supervises it like ComfyUI; the server talks
  to it through `server/tts/client.ts` (`dev/mock-tts.ts` in development and tests). A voice is a
  reference clip plus its transcript (`Character.voice`): designed voices are VoiceDesign renders of a
  fixed ~8 s sentence with the description as `instruct`; uploaded clips are normalized to 24 kHz mono
  WAV. Every line is then cloned from that clip with the Base model (Qwen3-TTS's "design, then clone"
  recipe), which is what keeps a character's voice the same across shots; cloning takes no per-line
  instruction, so delivery follows the wording. Jobs: `character_voice` (design) and `dialogue_line`
  (a shot's line, or a preview with `{characterId, text}`), both in the queue's `tts` family. The queue
  frees ComfyUI's models before voice work and unloads the sidecar after it (`gpuHandoff`), so only one
  of them holds VRAM. ComfyUI's `/free` is asynchronous (its worker acts on the flag when it next wakes),
  so the queue waits until the GPU really has room (`ComfyClient.freeAndWait`, 10 GB); starting at once
  ran the sidecar out of memory on a 4090. Measured on a Runpod RTX 4090 (2026-09-27): both models
  loaded use 9.4 GB; designing a voice takes ~29 s cold / ~13 s warm, a line ~6–11 s (1–5 s of audio),
  reloading the Base model after ComfyUI work ~2 s, and ComfyUI released its memory 1.7 s after `/free`. `shared/dialogue.ts` resolves the speaker (`dialogueSpeakerId`, else the only
  character in the shot) and keys each rendered line on its text, speaker and voice
  (`dialogueAudioKey`), so edits re-record it: a PATCH of the line or speaker queues a render, and a new
  voice re-records that character's lines. Audio assets (`kind: 'audio'`) stay out of the gallery
  listing. Export mixes a shot's current line into clips without sound (`segmentArgs`: 0.25 s in, cut
  with the picture); clips with their own audio keep it. Lines get "room sound" (`server/voice/room.ts`:
  a low cut and two soft reflections), and a film with lines gets a quiet brown-noise room tone under its
  silent shots instead of digital silence. **Lip sync (LTX-2.5):** when a shot's line is current,
  `shot_video` hands LTX the line (room sound, clip length, 48 kHz stereo) as the clip's soundtrack;
  `buildLtx25({audioFile})` encodes it and holds it fixed (`SetLatentNoiseMask` with a zero `SolidMask`,
  as in Comfy-Org's `video_ltx2_3_ia2v.json`) so LTX animates the face to it. On the 4090 the clip's audio
  kept the character's voice (speaker similarity 0.98 vs 0.93 when LTX voices the line itself) and the
  words verbatim. Lip-synced shots render in HD (1280×704; the mouth is a few pixels wide at 832×512): an
  8 s close-up took 136 s. H3 can't take audio, so
  its clips keep their own voice. The AI
  breakdown and `create_storyboard` suggest a voice per speaking character (`voiceHint`), which
  "Record lines" / `generate_voices` turn into voices.

## Security

The Runpod proxy URLs are public, so every route except `/api/login`, `/api/health` and the login
page's static assets requires the session cookie. The password comes from `STUDIO_PASSWORD`; if it is
unset (or the template's `change-me` placeholder), the first visitor creates it, stored as a scrypt
hash in `/workspace/studio/password.json`. Setup is only accepted for `SETUP_WINDOW_MINUTES` (15)
after the server starts, so an unclaimed pod locks itself until restarted. There is no shared default
password, and the password is never logged. ComfyUI binds to 127.0.0.1 only.

Runpod returns a pod's environment variables in plain text through its console and API, so anything
with access to the account (including agents using a Runpod API key) can read `STUDIO_PASSWORD`,
`HF_TOKEN` or API keys set there. The docs steer secrets to the Settings page, whose values live in the
SQLite `kv` table on the volume and are never serialized back to the client, or to Runpod Secret
references (`{{ RUNPOD_SECRET_name }}`), which the API shows unresolved. The model downloader resolves
the Hugging Face token the same way the server does (Settings first, then `HF_TOKEN`), reading
`kv['settings'].hfToken` from `studio.db` read-only.

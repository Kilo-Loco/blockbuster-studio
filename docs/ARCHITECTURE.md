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
  carrying Wan LoRAs fall back to Wan. Perform always uses Wan Animate. H3 renders 24 fps with a stereo soundtrack, sizes on a
  32 px grid (HD = 1280×736) and frame counts on a 17k+5 grid (5 s = 124 frames). Measured
  2026-09-25 on an RTX 5090 capped to 24 GB of VRAM (`--reserve-vram 8`) with nvfp4 emulated as on
  a 4090: 5 s at 864×480 in 42–51 s, 1280×736 in 110 s, peak VRAM 24.9 GB (ComfyUI's dynamic VRAM
  loading streams the 21 GB int8 DiT and the 15.7 GB nvfp4 Qwen3-VL-32B text encoder). Film export
  normalizes mixed Wan/H3 shots to one fps and gives silent shots a silent audio track.

## Security

The Runpod proxy URLs are public, so every route except `/api/login`, `/api/health` and the login
page's static assets requires the session cookie. The password comes from `STUDIO_PASSWORD`; if it is
unset (or the template's `change-me` placeholder), the first visitor creates it, stored as a scrypt
hash in `/workspace/studio/password.json`. Setup is only accepted for `SETUP_WINDOW_MINUTES` (15)
after the server starts, so an unclaimed pod locks itself until restarted. There is no shared default
password, and the password is never logged. ComfyUI binds to 127.0.0.1 only.

## Content policy

The models are not safety-filtered at the weight level, and the studio does not add prompt filters for
adult content between consenting adults. The app never allows sexual content involving minors: the
server rejects such prompts with a hard block list (`server/pipeline/guard.ts`), and this cannot be
turned off.

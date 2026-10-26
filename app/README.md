# Blockbuster Studio — local setup

Two ways to run the studio on your own machine:

- **Full studio in Docker** on an NVIDIA GPU such as an **RTX 5090** — the same image Runpod runs,
  with real ComfyUI and all models. This is the way to actually make films locally.
- **Local development without a GPU** — mock ComfyUI and mock voice services, for working on the
  code. No models or GPU needed.

For the user-facing version of the container setup, see
[docs/manage/run-locally.mdx](../docs-site/docs/manage/run-locally.mdx) or
<https://docs.blockbuster.studio/manage/run-locally>.

## Run the full studio in Docker (RTX 5090)

### What you need

- **NVIDIA GPU with 32 GB of memory or more.** An RTX 5090 (32 GB) runs everything, including the
  4K export. A 24 GB card such as an RTX 4090 still makes images, edits and video, but 4K export
  may not fit.
- **An NVIDIA driver that supports CUDA 12.8 or newer.** Run `nvidia-smi`; the top right shows the
  CUDA version. The image is built on CUDA 12.8.1 and includes Blackwell (RTX 50-series) support.
- **Linux, or Windows 11 with WSL 2.** Docker Desktop with the WSL 2 backend includes GPU support.
  A Mac can't run it.
- **[Docker](https://docs.docker.com/engine/install/)** with the
  **[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)**.
- **64 GB of system RAM.** The video models pass through system memory. On Windows, WSL 2 gets only
  half your RAM by default; raise `memory=` in
  [`.wslconfig`](https://learn.microsoft.com/en-us/windows/wsl/wsl-config#wslconfig).
- **About 180 GB of free disk.** Models are about 128 GB; the rest is room for your films.
- **A free [Hugging Face](https://huggingface.co) account and read token**, for the gated video
  models. You'll paste the token into the studio after it starts.

### Quick start

```sh
cd app
make container-check   # pulls the image, then checks the GPU is visible inside a container
make container-up      # starts the studio on http://localhost:3000
```

The first pull is large, and the first start downloads about 128 GB of models in the background.
Watch progress with:

```sh
make container-logs
```

Open **<http://localhost:3000>** and create your password within the **first 15 minutes**. If you
miss the window, run `make container-restart` to reopen it. The studio unlocks features as their
models arrive; image generation is usually usable within minutes.

If the container starts but the studio doesn't respond, `make container-logs` shows what it is
doing. Model download logs also live inside the data folder, under `studio/logs/` (see below).

### Make targets

| Command | What it does |
|---|---|
| `make container-check` | Check `nvidia-smi` on the host and that Docker can see the GPU |
| `make container-pull` | Pull `docker.io/kiloloco/blockbuster-studio:latest` |
| `make container-up` | Create or recreate the container; pulls the image first |
| `make container-start` | Resume a stopped container (no model re-download) |
| `make container-stop` | Stop the container; keeps models, films and password |
| `make container-restart` | Restart it (reopens the 15-minute setup window if unclaimed) |
| `make container-logs` | Follow the container log |
| `make container-shell` | Open a shell inside the container |
| `make container-status` | Show whether it is running and which ports are mapped |
| `make container-update` | Pull the latest image and recreate the container |
| `make container-remove` | Delete the container (the data folder is kept) |

`make container-up` recreates the container, but your data lives on a host folder, so models,
projects and password survive. Only `make container-remove` without that folder, or deleting the
folder yourself, loses anything.

### Where your data lives

By default the studio stores everything in **`~/blockbuster-studio`**, mounted into the container
as `/workspace`:

- `studio/` — database, projects, media and `password.json`
- `models/` — the downloaded models
- `studio/logs/` — `comfyui.log`, `server.log`, `tts.log`, `downloader.log`

Point it somewhere else with `WORKSPACE`:

```sh
make container-up WORKSPACE=/mnt/fast-ssd/blockbuster-studio
```

Use a path on a local SSD if you can; network or slow disks make model loads much slower. On
Windows with WSL 2, keep it in the Linux filesystem (for example `~/blockbuster-studio`), not
under `/mnt/c`, for the same reason.

### Ports and environment variables

Change the host port if 3000 is taken:

```sh
make container-up STUDIO_PORT=8080     # http://localhost:8080
```

Pass extra container variables with `DOCKER_ENV`. These are the same variables the Runpod template
uses (see [Settings](/manage/settings#set-keys-when-you-deploy)):

```sh
make container-up DOCKER_ENV="-e DOWNLOAD_UPSCALE_MODELS=true"
make container-up DOCKER_ENV="-e HF_TOKEN=hf_... -e STUDIO_PASSWORD=long-password"
```

Prefer the studio's **Settings** page for Civitai and Hugging Face tokens: values passed with `-e`
are visible in `docker inspect` and your shell history. `STUDIO_PASSWORD` overrides the password
you create in the browser.

Other variables: `IMAGE`, `CONTAINER`, `SHM_SIZE` (default `16g`) and `GPU` (default `all`), e.g.
`make container-up IMAGE=docker.io/kiloloco/blockbuster-studio:latest GPU='"device=0"'`. See
`make help`.

### RTX 5090 checklist

1. `nvidia-smi` shows the RTX 5090, 32 GB of memory, and **CUDA 12.8 or newer**.
2. `make container-check` prints the GPU from both the host and inside a container. If the inside
   check fails, the NVIDIA Container Toolkit (or Docker Desktop's WSL 2 GPU support) isn't set up.
3. The data folder is on a local SSD with about 180 GB free.
4. On Windows, `.wslconfig` gives WSL enough memory (64 GB total, so roughly `memory=60GB`).
5. Wait for the video models before trying a video; the amber banner in the studio shows progress.

## Local development without a GPU

Run the studio's API and web app with lightweight stand-ins for ComfyUI and the voice sidecar.
This is for changing the code, not for making real films.

### What you need

- **Node.js 22 or newer** (`node --version`). The `package.json` engines field enforces this.
- **npm** (or another package manager; the Makefile uses `NPM`).
- **ffmpeg and ffprobe** (optional, recommended). Video jobs and thumbnails need them; the mock
  ComfyUI falls back to placeholder media when they're missing.
- **No GPU, ComfyUI or model downloads.**

### Quick start

```sh
cd app
make install     # npm install
make dev         # mock ComfyUI + mock TTS + API server + web app
```

Open **<http://localhost:5173>**. On first run the studio is unclaimed: create a password within
the setup window (15 minutes by default), or set `STUDIO_PASSWORD` before starting.

| URL | What it is |
|---|---|
| <http://localhost:5173> | Vite dev server for the web app (use this while developing) |
| <http://localhost:3000> | API server; also serves `dist/web` if you have built it |
| <http://localhost:8188> | Mock ComfyUI |
| <http://localhost:8190> | Mock voice sidecar (TTS) |

The Vite server proxies `/api`, `/media`, `/mcp` and `/dl` to port 3000, so the web app talks to
the API without CORS setup.

### Make targets

| Command | What it does |
|---|---|
| `make install` | Install dependencies (`npm install`) |
| `make dev` | Run all four dev processes with coloured logs; `Ctrl-C` stops them |
| `make dev-mock` | Run only the mock ComfyUI (port 8188) |
| `make dev-tts` | Run only the mock voice sidecar (port 8190) |
| `make dev-server` | Run only the API server under `tsx watch` (port 3000) |
| `make dev-web` | Run only the Vite web app (port 5173) |
| `make test` | Run the test suite once (`vitest run`) |
| `make typecheck` | Type-check with `tsc --noEmit` |
| `make check` | `typecheck` + `test` — what to run before opening a PR |
| `make build` | Build the web app and bundle the server |
| `make start` | Run the built server from `dist/server.js` |
| `make validate-workflows` | Check workflows against a **real** ComfyUI (not the mock) |
| `make clean` | Remove `dist/` |

Environment variables pass straight through, so you can speed up or slow down the mocks:

```sh
MOCK_DELAY_MS=0 make dev          # near-instant mock renders
MOCK_DELAY_MS=2000 make dev       # slower, to watch progress UI
MOCK_COMFY_PORT=8288 make dev-mock
PORT=4000 make dev-server
```

The web dev server proxy still points at port 3000; if you change `PORT`, update
`vite.config.ts` to match.

### Running processes individually

`make dev` runs four processes concurrently:

- **`dev:mock`** — `server/dev/mock-comfy.ts`, a fake ComfyUI. `MOCK_COMFY_PORT` changes the port,
  `MOCK_DELAY_MS` changes simulated render time, and `MOCK_LOAD_MS` adds a fake cold model load.
- **`dev:tts`** — `server/dev/mock-tts.ts`, a fake Qwen3-TTS sidecar. `MOCK_TTS_PORT` changes the
  port; it writes short tone WAVs so dialogue timing and export mixing behave like the real thing.
- **`dev:server`** — `server/index.ts` under `tsx watch`, the API server on port 3000.
- **`dev:web`** — the Vite dev server for the React SPA on port 5173.

Use the individual targets in separate terminals when you want to restart one piece without the
others, or when running the server against a real ComfyUI.

### Where dev data lives

The server writes to `.data/` by default (git-ignored), with the SQLite database, generated media,
session secret and hashed password. Set `DATA_DIR` to move it. Models live in `models/`
(`MODELS_DIR`), which you don't need for the mock.

To start over with a fresh studio, stop the dev processes and remove `.data/`:

```sh
rm -rf .data
```

## Running against a real ComfyUI (without Docker)

Point `COMFY_URL` at a headless ComfyUI instance with the models from `config/models.json`
installed, and set `MODELS_DIR` to where those files live:

```sh
COMFY_URL=http://127.0.0.1:8188 MODELS_DIR=/path/to/models make dev-server
```

Without `COMFY_MOCK=1`, engine availability is computed by asking ComfyUI's `/object_info` for the
`UNETLoader`/`CLIPLoader`/`VAELoader`/`LoraLoaderModelOnly` dropdown options and checking each
engine's required filenames against them — see `server/system.ts`. The dev mocks are already
enabled through the scripts, which is why you don't set `COMFY_MOCK=1` for `make dev`.

## Environment variables

See `server/config.ts` for the full list and defaults: `PORT`, `HOST`, `COMFY_URL`, `TTS_URL`,
`DATA_DIR`, `MODELS_DIR`, `STUDIO_PASSWORD`, `ANTHROPIC_API_KEY` / `OPENAI_*`, `CIVITAI_TOKEN`,
`HF_TOKEN`, and others. Settings saved through `PUT /api/settings` are stored in SQLite and
override the environment fallbacks (see `server/settings.ts`).

## Testing

```sh
make test                  # vitest run — unit tests + in-process integration test against the mock
make typecheck             # tsc --noEmit
make validate-workflows    # checks server/comfy/workflows.ts against a REAL ComfyUI
```

The integration test (`server/integration.test.ts`) boots the real server and the mock ComfyUI
in-process on random free ports, logs in, runs a `zimage` generate job to completion, and runs a
shot keyframe job in compose mode (location + character references → composed keyframe).

## Building and running standalone

```sh
make build
STUDIO_PASSWORD=... COMFY_URL=http://127.0.0.1:8188 make start
```

`make build` runs Vite for the web app into `dist/web`, then esbuild for the server into
`dist/server.js`. `make start` runs that bundle with Node; it serves the built web app and the API
on port 3000.

To build the Docker image yourself instead of pulling it:

```sh
docker build -t blockbuster-studio:local -f ../docker/Dockerfile ..
make container-up IMAGE=blockbuster-studio:local
```

## Project layout (server)

```
server/
  index.ts              Hono app wiring: auth, routes, SSE, static web, startup
  config.ts              env config
  db.ts                   better-sqlite3 schema + repo helpers
  auth.ts                 password login, HMAC session cookie
  events.ts               SSE event bus
  settings.ts             DB-stored settings/secrets, overriding env fallbacks
  system.ts               GET /api/system aggregation + engine availability
  comfy/client.ts          ComfyUI HTTP/WS client
  comfy/workflows.ts       ComfyUI API-format workflow builders (do not rewrite; validated)
  pipeline/queue.ts        persistent single-worker GPU job queue
  pipeline/prompts.ts      the shot pipeline: storyboard data → prompts/LoRAs
  pipeline/*.ts            job runners (generate, location/character refs, shot keyframe/video, export)
  ai/llm.ts, ai/breakdown.ts    provider-agnostic LLM call + script breakdown
  loras/import.ts, loras/train.ts   Civitai/HF/URL import + ai-toolkit training
  routes/*.ts              REST routes (see docs/API.md)
  dev/mock-comfy.ts        fake ComfyUI for local dev and tests
  dev/mock-tts.ts          fake voice sidecar for local dev and tests
```

See `../docs/ARCHITECTURE.md` and `../docs/API.md` for the system design and REST contract.

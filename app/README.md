# Blockbuster Studio — dev guide

A self-hosted AI film studio backend (Node 22, Hono, SQLite) driving a headless ComfyUI. See
`../docs/ARCHITECTURE.md` and `../docs/API.md` for the system design and REST contract.

## Quick start

```sh
cd app
npm install        # already done in this checkout
npm run dev         # starts the mock ComfyUI, the API server, and the Vite web app together
```

`npm run dev` runs three processes concurrently (via `concurrently`):

- `dev:mock` — `server/dev/mock-comfy.ts`, a fake ComfyUI on port 8188 (`MOCK_COMFY_PORT` to
  change it, `MOCK_DELAY_MS` to speed up/slow down simulated rendering).
- `dev:server` — `server/index.ts` under `tsx watch`, the real API server on port 3000.
- `dev:web` — the Vite dev server for the React SPA.

On first run with no `STUDIO_PASSWORD` set, the server generates a random password, prints it to
stdout, and writes it to `.data/PASSWORD.txt`. Use that to log in at `http://localhost:3000` (or
whatever port Vite proxies through).

## Running against a real ComfyUI

Point `COMFY_URL` at a real (headless) ComfyUI instance with the models from
`config/models.json` installed, and set `MODELS_DIR` to where those model files live. Without
`COMFY_MOCK=1`, engine availability is computed by asking ComfyUI's `/object_info` for the
`UNETLoader`/`CLIPLoader`/`VAELoader`/`LoraLoaderModelOnly` dropdown options and checking each
engine's required filenames against them — see `server/system.ts`.

## Environment variables

See `server/config.ts` for the full list and defaults (`PORT`, `HOST`, `COMFY_URL`, `DATA_DIR`,
`MODELS_DIR`, `STUDIO_PASSWORD`, `ANTHROPIC_API_KEY` / `OPENAI_*` / `CIVITAI_TOKEN` / `HF_TOKEN`,
etc). Settings saved via `PUT /api/settings` are stored in SQLite and override the env fallbacks
(see `server/settings.ts`).

## Testing

```sh
npm test              # vitest run — unit tests + an in-process integration test against the mock
npm run typecheck      # tsc --noEmit
npm run validate:workflows   # checks server/comfy/workflows.ts against a REAL ComfyUI (not the mock)
```

The integration test (`server/integration.test.ts`) boots the real server and the mock ComfyUI
in-process on random free ports, logs in, runs a `zimage` generate job to completion, and runs a
shot keyframe job in compose mode (location + character references → composed keyframe).

## Building / running standalone

```sh
npm run build          # builds the web app (Vite) then bundles the server (esbuild)
STUDIO_PASSWORD=... COMFY_URL=http://127.0.0.1:8188 node dist/server.js
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
```

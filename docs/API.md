# Studio REST API

All types come from `app/shared/types.ts`. JSON in and out. Every route except those marked
**public** requires the `bb_session` cookie or `Authorization: Bearer <agent token>` (401
`{error:'unauthorized'}` otherwise; wrong tokens share the login rate limit, 429). Limits count per
`CF-Connecting-IP` (set by Runpod's Cloudflare proxy; IPv6 per /64), never `X-Forwarded-For`, which the
proxy passes through from the client. The token is read
from the header only, never a query string. Jobs record who queued them (`actor: 'human' | 'agent'`).
Agents: `/api/openapi.json` describes the routes needed to make a film, and `/mcp` serves the same
as MCP tools (see "Agents" below).
Errors: non-2xx with an `ApiError` body `{ error: string, detail?: unknown }`.

## Auth & system

| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/login` **public** | `{password}` → `{ok:true}` + sets cookie (HttpOnly, SameSite=Lax, Secure when behind https proxy, 30 days) |
| POST | `/api/logout` | → `{ok:true}` |
| POST | `/api/setup` **public** | `{password}` (≥ 8 chars) → `{ok:true}` + sets cookie. First-visit setup: only while no password exists and within `SETUP_WINDOW_MINUTES` of server start. 409 if already claimed, 403 once the window has closed |
| GET | `/api/session` **public** | → `{authenticated, claimed, setupOpen}` |
| GET | `/api/health` **public** | → `{ok:true, version}` |
| GET | `/api/system` | → `SystemInfo` |
| GET | `/api/events` | Server-Sent Events stream of `ServerEvent` (`data: <json>\n\n`); `ping` every 15 s |
| GET | `/api/agent-token` | → `AgentAccess` `{enabled, source: 'off'|'env'|'file', path?}` (never the token) |
| POST | `/api/agent-token/rotate` | → `{ok:true}`; password session only (403 for the agent token); 409 when the token comes from `STUDIO_AGENT_TOKEN` or agent access is off |
| GET | `/api/settings` | → `Settings` |
| PUT | `/api/settings` | `SettingsUpdate` → `Settings` |

## Media & assets

| Method | Path | Body → Response |
|---|---|---|
| GET | `/media/*` | file bytes (images, mp4 with HTTP Range support, thumbnails, wav) |
| GET | `/api/assets/:id/frames?n=6&width=320` | JPEG for review: a video's `n` (1–12) evenly spaced frames tiled into one contact sheet (tile `width` 160–640; headers `X-Frame-Times`, `X-Grid`), or an image downscaled to `3 × width` |
| POST | `/api/assets/:id/link` | → `{url, path, expiresAt, bytes}`: a download link valid for 15 minutes without credentials |
| GET | `/dl/:id/:exp/:sig/:name` **public** | the file, if the signature is valid and unexpired (403 otherwise) |
| POST | `/api/uploads` | multipart `file` (image/*, video/*, or audio/* → normalized to 24 kHz mono WAV ≤ 30 s, kind `audio`; ≤ 500 MB), optional `projectId` → `Asset` |
| GET | `/api/assets?kind=&favorite=1&projectId=&shotId=&q=&cursor=&limit=` | → `Paged<Asset>` newest first (default limit 60; audio only with `kind=audio`) |
| GET | `/api/assets/:id` | → `Asset` |
| PATCH | `/api/assets/:id` | `{favorite?}` → `Asset` |
| DELETE | `/api/assets/:id` | → `{ok:true}` (removes files) |

## Generation & jobs

| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/generate` | `GenerateRequest` → 202 `Job` (one job; it produces `count` output assets) |
| GET | `/api/jobs?active=1&limit=` | → `Job[]` (active = queued + running, otherwise newest 100) |
| GET | `/api/jobs?ids=a,b,c&wait=<s>` | → those `Job[]`; with `wait`, holds until all are finished or `min(s, 50)` seconds pass |
| GET | `/api/jobs/:id?wait=<s>` | → `Job`; with `wait`, holds until it is finished or `min(s, 50)` seconds pass (Runpod's proxy cuts requests at 100 s) |
| POST | `/api/jobs/:id/cancel` | → `Job` (queued: removed; running: ComfyUI interrupt, and the job ends even if ComfyUI never answers) |
| POST | `/api/jobs/:id/retry` | → 202 new `Job` with the same params |

Every route that queues work answers 202 with the job(s), each with `statusUrl` (`/api/jobs/:id?wait=50`).
| POST | `/api/ai/enhance` | `{prompt, target: 'image'|'video'}` → `{prompt}` (400 if no LLM configured) |

Engine semantics for `POST /api/generate`:
- `zimage`: text → `count` images (a batch in one ComfyUI prompt).
- `qwen_edit`: `inputAssetIds` 1–3 plus an instruction prompt → `count` images (sequential seeds).
- `qwen_angle`: one input plus `angle` (AngleSpec) → image. Prompt = `anglePrompt(angle)`, plus the user
  prompt if one is given.
- `wan_i2v`: one input image → `count` videos.
- `wan_t2v`: uses Wan T2V if its model group is ready. Otherwise it chains `zimage` (keyframe, which is
  also saved as an asset) → `wan_i2v`.
- Video prompts get the camera-move phrase appended. Sizes come from `aspect` + `quality`, and
  frames from `durationSec` (see `shared/presets.ts`).

## Library

| Method | Path | Body → Response |
|---|---|---|
| GET/POST | `/api/characters` | → `Character[]` / `Partial<Character>` → `Character` |
| GET/PATCH/DELETE | `/api/characters/:id` | |
| POST | `/api/characters/:id/references` | `{count?:4, prompt?}` → `Job` (Z-Image "character sheet" images of the description, added to references on completion) |
| POST | `/api/characters/:id/voice` | `{description, language?}` → 202 `Job` (`character_voice`: Qwen3-TTS designs the voice; the character's lines re-record when it lands). 409 while the voice engine downloads |
| PUT | `/api/characters/:id/voice` | `{assetId, transcript?, language?}` (an audio upload) → `Character` (the clip becomes the voice; a transcript makes the clone closer) |
| DELETE | `/api/characters/:id/voice` | → `Character` |
| POST | `/api/characters/:id/voice/preview` | `{text}` → 202 `Job` (`dialogue_line`; its output asset is the line) |
| GET/POST | `/api/locations` | → `Location[]` / `Partial<Location>` → `Location` (default map from `defaultLocationMap()`) |
| GET/PATCH/DELETE | `/api/locations/:id` | PATCH accepts `map`, `establishingAssetId`, etc. |
| POST | `/api/locations/:id/establishing` | `{prompt?}` → `Job` (Z-Image establishing shot from the description at the project/default aspect; sets `establishingAssetId` on completion) |
| POST | `/api/locations/:id/angles` | `{angle: AngleSpec}` → `Job` (cached in `angleViews`) |
| GET/POST | `/api/styles` ; GET/PATCH/DELETE `/api/styles/:id` | |
| GET | `/api/loras?family=` | → `Lora[]` (bundled speed LoRAs hidden) |
| POST | `/api/loras/import` | `LoraImportRequest` → `Lora` (status `downloading`; progress via `lora` events) |
| POST | `/api/loras/upload` | multipart `file` (.safetensors) + `family`, `kind`, `name`, `triggerWord` → `Lora` |
| POST | `/api/loras/train` | `LoraTrainRequest` → `Job` (type `lora_train`) |
| PATCH/DELETE | `/api/loras/:id` | |

## Projects / storyboard

| Method | Path | Body → Response |
|---|---|---|
| GET/POST | `/api/projects` | → `Project[]` / `{name, logline?, aspect?}` → `Project` |
| GET | `/api/projects/:id` | → `ProjectDetail` |
| PATCH/DELETE | `/api/projects/:id` | |
| POST | `/api/projects/:id/scenes` | `Partial<Scene>` → `Scene` (appended) |
| PATCH/DELETE | `/api/scenes/:id` | |
| POST | `/api/projects/:id/scenes/reorder` | `{sceneIds: ID[]}` → `ProjectDetail` |
| POST | `/api/scenes/:id/shots` | `Partial<Shot>` → `Shot` (appended; camera auto-placed 'front' if absent) |
| PATCH/DELETE | `/api/shots/:id` | |
| POST | `/api/scenes/:id/shots/reorder` | `{shotIds: ID[]}` → `ProjectDetail` |
| POST | `/api/shots/:id/duplicate` | → `Shot` |
| GET | `/api/shots/:id/preview` | → `{angle: AngleSpec & {azimuthDeg, elevationDeg}, placements: ScreenPlacement[], keyframePrompt: string, motionPrompt: string, mode: 'compose'|'generate'}` (the auto prompts, for display) |
| POST | `/api/shots/:id/keyframe` | → 202 `Job` |
| POST | `/api/shots/:id/video` | → 202 `Job` (400 without a keyframe) |
| POST | `/api/shots/:id/line` | → 202 `Job` (record the line in its speaker's voice; a PATCH of `dialogue`, `dialogueSpeakerId` or `characterIds` queues this automatically) |
| POST | `/api/shots/:id/select` | `{keyframeAssetId?} | {videoAssetId?}` → `Shot` (choose a candidate) |
| POST | `/api/projects/:id/render` | `{what: 'keyframes'|'videos'|'all', onlyMissing?: true}` → 202 `Job[]` |
| POST | `/api/projects/:id/voices` | → 202 `{jobIds, voiceJobs, lineJobs, needsVoice[]}` (voices for speakers with a `voiceHint`, then every missing or stale line) |
| POST | `/api/projects/:id/export` | → 202 `Job` (ffmpeg concat of shot videos in order → `exportAssetId`; each silent clip gets its shot's recorded line mixed in) |
| POST | `/api/projects/:id/storyboard?validate=1` | Storyboard plan (below) → `{ok, errors[], warnings[], previews[], estimate}`; `validate=1` writes nothing; without it the plan is appended (201, plus `project: ProjectDetail`). 422 lists every problem. `Idempotency-Key` header: a retry within 24 h returns the first result |
| POST | `/api/projects/:id/breakdown` | `{script}` → `BreakdownDraft` (LLM; 400 if not configured) |
| POST | `/api/projects/:id/breakdown/apply` | `BreakdownDraft` → `ProjectDetail` (creates missing characters/locations and appends scenes/shots with auto-placed cameras and blocking) |

### Storyboard plan (`POST /api/projects/:id/storyboard`)

The breakdown draft's shape, strict, plus every shot-panel field (`app/server/storyboard.ts` has the
zod schema; `/api/openapi.json` has it as JSON Schema):

```jsonc
{
  "logline": "optional",
  "characters": [{ "name": "Rook", "description": "wiry woman, shaved head, leather jacket" }], // matched by name or created
  "locations": [{ "name": "The Anchor", "description": "dim dockside bar" }],
  "scenes": [{
    "title": "INT. THE ANCHOR - NIGHT", "description": "", "locationName": "The Anchor", "timeOfDay": "night",
    "blocking": [{ "character": "Rook", "x": 5, "y": 4, "facingDeg": 90 }],            // metres on the location map
    "shots": [{
      "action": "Rook sets a coin on the counter.", "dialogue": "optional",
      "shotSize": "CU", "cameraMove": "push_in", "characterNames": ["Rook"], "durationSec": 4,
      "cameraSide": "front-left",                                                       // or "camera": { "x", "y", "targetX", "targetY", "heightM" }
      "keyframeMode": "auto", "keyframePrompt": "optional", "motionPrompt": "optional", "seed": 42,
      "blocking": [/* per-shot marks */]
    }]
  }]
}
```

Checks: every name resolves (to the plan or the library), `durationSec` is a whole number the
installed video model accepts on this GPU, marks and cameras are inside the map, unknown fields and
enum values are rejected. Characters without marks are placed automatically (a warning says so).
The estimate counts reference images, frames and clips with rough minutes.

## Agents (MCP)

`POST /mcp`: Streamable HTTP, stateless, JSON responses; same auth as the API. Requests with an
`Origin` header other than the studio's own are rejected (DNS rebinding). Tools:

| Tool | Does |
|---|---|
| `studio_status` | GPU, video model and its clip lengths, downloads, active jobs |
| `get_project` | projects, or one project's scenes and shots with status and asset ids |
| `create_storyboard` | the storyboard route above; `validate`, `idempotencyKey`, `projectId` or `newProject` |
| `preview_shot` | `/api/shots/:id/preview` |
| `update_shot`, `choose_take` | PATCH a shot; pick an earlier frame or clip |
| `generate_frames`, `animate_shots`, `export_film` | queue work; return job ids at once |
| `wait_for_jobs` | long-poll ≤ 50 s; the model calls it again while `allDone` is false |
| `cancel_job` | cancel |
| `review_asset` | the contact sheet or downscaled image as image content |
| `get_download_link` | the 15-minute link |

No tool deletes anything or changes settings. The three long tools declare
`execution.taskSupport: "optional"`: a client that sends `params.task` gets an MCP Task that completes
when the jobs finish (`tasks/get`, `tasks/result`); other clients get the job ids immediately.

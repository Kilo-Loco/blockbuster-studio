# Studio REST API

All types come from `app/shared/types.ts`. JSON in and out. Every route except those marked
**public** requires the `bb_session` cookie (401 `{error:'unauthorized'}` otherwise).
Errors: non-2xx with an `ApiError` body `{ error: string, detail?: unknown }`.

## Auth & system

| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/login` **public** | `{password}` → `{ok:true}` + sets cookie (HttpOnly, SameSite=Lax, Secure when behind https proxy, 30 days) |
| POST | `/api/logout` | → `{ok:true}` |
| GET | `/api/session` **public** | → `{authenticated: boolean}` |
| GET | `/api/health` **public** | → `{ok:true, version}` |
| GET | `/api/system` | → `SystemInfo` |
| GET | `/api/events` | Server-Sent Events stream of `ServerEvent` (`data: <json>\n\n`); `ping` every 15 s |
| GET | `/api/settings` | → `Settings` |
| PUT | `/api/settings` | `SettingsUpdate` → `Settings` |

## Media & assets

| Method | Path | Body → Response |
|---|---|---|
| GET | `/media/*` | file bytes (images, mp4 with HTTP Range support, thumbnails) |
| POST | `/api/uploads` | multipart `file` (image/* or video/mp4, ≤ 500 MB), optional `projectId` → `Asset` |
| GET | `/api/assets?kind=&favorite=1&projectId=&shotId=&q=&cursor=&limit=` | → `Paged<Asset>` newest first (default limit 60) |
| GET | `/api/assets/:id` | → `Asset` |
| PATCH | `/api/assets/:id` | `{favorite?}` → `Asset` |
| DELETE | `/api/assets/:id` | → `{ok:true}` (removes files) |

## Generation & jobs

| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/generate` | `GenerateRequest` → `Job` (one job; it produces `count` output assets) |
| GET | `/api/jobs?active=1&limit=` | → `Job[]` (active = queued + running, otherwise newest 100) |
| GET | `/api/jobs/:id` | → `Job` |
| POST | `/api/jobs/:id/cancel` | → `Job` (queued: removed; running: ComfyUI interrupt) |
| POST | `/api/jobs/:id/retry` | → new `Job` with the same params |
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
| POST | `/api/shots/:id/keyframe` | → `Job` |
| POST | `/api/shots/:id/video` | → `Job` (400 without a keyframe) |
| POST | `/api/shots/:id/select` | `{keyframeAssetId?} | {videoAssetId?}` → `Shot` (choose a candidate) |
| POST | `/api/projects/:id/render` | `{what: 'keyframes'|'videos'|'all', onlyMissing?: true}` → `Job[]` |
| POST | `/api/projects/:id/export` | → `Job` (ffmpeg concat of shot videos in order → `exportAssetId`) |
| POST | `/api/projects/:id/breakdown` | `{script}` → `BreakdownDraft` (LLM; 400 if not configured) |
| POST | `/api/projects/:id/breakdown/apply` | `BreakdownDraft` → `ProjectDetail` (creates missing characters/locations and appends scenes/shots with auto-placed cameras and blocking) |

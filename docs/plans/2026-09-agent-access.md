# Agent access plan

Goal: an AI agent (Claude Code or any MCP client) can drive a freshly deployed studio end to end
with only the pod URL and a token: build a storyboard, render, wait, review, export, download. No
password typing, no clicking through the UI, no SSH file copying.

Evidence: two directed films in September 2026 needed a human to type the password on every pod,
a few hundred UI actions per storyboard, 45 s browser-script limits for waiting, and SSH + base64
to get frames and films out. Design checked against Replicate, fal.ai, Runway, ComfyUI MCP servers
and the MCP spec (see "References").

## Status (2026-09-27)

Phases 1–6 are implemented and tested against mock ComfyUI (`app/server/agent.test.ts` drives a
film end to end through `/mcp` only). **"Done when" verified on 2026-09-27** on a Runpod RTX 5090
(community, CUDA 12.8 host, MiniMax H3): an MCP client with only the pod URL and a token (set as
`STUDIO_AGENT_TOKEN`, no password, no SSH, no UI) validated and created "Last Call" in one call,
rendered 3 reference images and 6 frames, reviewed each frame, fixed two (Brute's missing coat, a
duplicated Brute in shot 6) with `update_shot` + `generate_frames`, animated, reviewed every clip's
contact sheet, exported (32.4 s, both lines of dialogue audible) and downloaded it via a signed link.
Security checks on the live pod: `/mcp` without or with a wrong token 401, foreign Origin 403, token
in a query string 401, tampered link 403, rotation with the agent token 403.

Found and fixed by that run: previews said "generate" while Qwen-Image-Edit was still downloading
(now counted as coming, with a warning); a `newProject` retry with the same idempotency key made a
second project; a cancel landing before the job registered its ComfyUI waiter left the job hanging.
Still open: the optional transcript and read-only scope. Choices made while building:

- `/mcp` is stateless with JSON responses (no SSE stream), so nothing is held open behind Runpod's proxy.
- The SDK's `taskSupport: "optional"` would hold a non-task call until the jobs finish (past the
  100 s proxy limit), so long tools answer non-task clients at once with job ids; clients that send
  `params.task` get a real MCP Task.
- Added `get_project`, `update_shot` and `choose_take` tools: an agent needs them to find its shots
  and fix what review finds. None delete anything.
- `/mcp` sits outside `/api/`, so the auth middleware now lists it as protected explicitly (a test
  caught it being treated as a public static path).

## Constraints that shape the design

- **Runpod's proxy cuts HTTP requests at 100 s** (Cloudflare 524). No request may block longer
  than ~60 s. Renders take 1–5 min, so waiting must be short polls, never one long call.
- **MCP Tasks are experimental** (spec 2025-11-25) and client support can't be assumed. Every
  long tool must work as "start, then wait in ≤ 50 s slices" for any client; Tasks are an
  optional extra.
- **Single user per pod.** A static bearer token is what the MCP spec suggests for self-hosted
  servers; OAuth 2.1 is for multi-user internet services and would be overkill here.
- **MCP clients cap tool content at about 1 MB**, so images returned to the model must be small.
- **WebMCP is out of scope for now**: it serves in-browser agents with a human present and is
  still an origin trial. Revisit when stable; it can reuse the same tool definitions.

## Phase 1: Agent token (needs the owner's OK: it adds a second way in)

- On boot, if `/workspace/studio/agent-token` doesn't exist, write a 256-bit random token there
  (mode 0600). `STUDIO_AGENT_TOKEN` env overrides it, so a Runpod Secret can supply one.
  Readable only with SSH or the Runpod web terminal, i.e. by the pod's owner.
- `server/auth.ts`: `isAuthenticated` also accepts `Authorization: Bearer <token>`
  (constant-time compare). Never accepted in query strings. Requests are tagged
  `actor: 'agent' | 'human'` in logs and on jobs they create.
- `POST /api/agent-token/rotate` (human session only) writes a new token and invalidates the old.
- Settings page: "Agent access" section showing whether a token exists, how to read it
  (`cat /workspace/studio/agent-token` in the Runpod terminal), and the rotate button. The token
  itself is never shown in the UI or logs.
- Failed bearer attempts share the login rate limiter (per IP), so probing is throttled.
- The `Authorization` header is redacted in request logging and error reports.
- `AGENT_ACCESS=false` disables it entirely: no token file is created and Bearer is rejected.
- Tests: bearer accepted, wrong or missing bearer rejected, query-string token rejected,
  rotation invalidates the old token, token never logged (grep test logs), failed attempts
  throttled, `AGENT_ACCESS=false` rejects Bearer.
- Later (optional): a read-only token scope (status, review, download) for review-only agents.

## Phase 2: Jobs an agent can wait on

- `GET /api/jobs/:id?wait=<s>` holds the request until the job is terminal or `min(s, 50)`
  seconds pass, then returns the job (status, progress, stage, outputs, error). Uses the queue's
  existing events, not polling.
- `GET /api/jobs?ids=a,b,c&wait=<s>` does the same for a batch (returns when all are terminal or
  on timeout), for "animate 6 shots" style waits.
- Cancel (already `POST /api/jobs/:id/cancel`): make canceling a running job return promptly
  even if ComfyUI never answers (the runner already fails lost prompts; cancel should reject the
  waiter too).
- Every create response is `202`-style: the created job(s) plus a `statusUrl`.
- Tests: wait returns on completion, returns at timeout, batch wait, cancel of a stuck job.

## Phase 3: One storyboard request

- `POST /api/projects/:id/storyboard` accepts the whole plan in one JSON body:
  characters and locations (by name, created or matched), scenes, and shots with everything the
  shot panel can set: action, dialogue, cast, size, camera move, duration, keyframe mode,
  keyframe/motion prompt overrides, seed, and optional blocking/camera.
  Extends the existing breakdown draft rather than a second format; the UI's "Apply breakdown"
  keeps working.
- `?validate=1` checks everything (names resolve, durations fit the installed video model,
  unknown camera moves, cast missing from blocking) and returns the resolved shot previews
  (the existing `/api/shots/:id/preview` output: mode, visible characters, frame and motion
  prompts) without writing anything.
- `Idempotency-Key` header: the same key within 24 h returns the first result instead of
  creating duplicate scenes.
- Response includes an estimate: frames and clips to render and rough minutes (reuses the
  composer's per-model estimate).
- Tests: validate returns previews and errors without writes, idempotent retry creates nothing
  new, the full shot panel field set round-trips.

## Phase 4: Review and download

- `GET /api/assets/:id/frames?n=6&width=320` returns one JPEG contact sheet of evenly spaced
  frames (ffmpeg on the pod), kept under ~300 KB so it fits MCP limits. Images return a
  downscaled copy.
- `GET /api/assets/:id/transcript` is **optional/later**: speech-to-text needs a model on the
  pod; skip in the first pass and note that audio can't be verified on the pod yet.
- `POST /api/assets/:id/link` returns a signed, expiring (15 min) URL for the full file, so
  downloads don't carry the long-lived token (and don't leave it in proxy logs).
- Tests: contact sheet size and tile count, signed URL works until expiry and not after,
  tampered signature rejected.

## Phase 5: MCP server at `/mcp`

- Streamable HTTP transport via `@modelcontextprotocol/sdk`, same bearer token as phase 1.
- Tools (thin wrappers over phases 2–4, each with a clear description and JSON schema):
  `studio_status` (GPU, installed models, video model, clip lengths), `create_storyboard`
  (with `validate`), `preview_shot`, `generate_frames`, `animate_shots`, `wait_for_jobs`
  (≤ 50 s per call, returns progress so the model loops), `cancel_job`, `review_asset`
  (returns the contact sheet as image content), `export_film`, `get_download_link`.
- Long tools declare `execution.taskSupport: "optional"`: Task-capable clients get MCP Tasks
  with progress notifications; everyone else uses the start/`wait_for_jobs` pattern.
- Task and job IDs are unguessable (nanoid) and bound to the token.
- Validate the `Origin` header on `/mcp` (required by the Streamable HTTP transport spec to stop
  DNS rebinding): allow requests without an Origin (non-browser agents) or from the pod's own
  origin; reject any other.
- No destructive tools: nothing deletes projects, assets, cast or locations, or changes settings.
- README: "Connect an agent" with the `claude mcp add --transport http` command and the header.
- Tests: tool list and schemas, an end-to-end run against mock-comfy (storyboard → frames →
  animate → wait → review → export) driven only through `/mcp`.

## Phase 6: OpenAPI

- Generate `/api/openapi.json` from the route schemas (zod) and link it from docs/API.md, for
  agents that use REST directly.

## Out of scope (for now)

- Webhooks: agents in a terminal usually can't receive incoming HTTP; polling + Tasks fit better.
- Rate-limit headers: one user per pod.
- OAuth 2.1: only if the studio ever becomes multi-user.
- WebMCP: when it leaves origin trial.

## Done when

An agent given only the pod URL and token, through `/mcp`, recreates the "Last Call" film:
storyboard in one call (validated first), frames and clips rendered, each clip reviewed from its
contact sheet, film exported and downloaded, no SSH and no UI clicks. Verified on a real pod.

## Order and size

| Phase | Depends on | Rough size |
|---|---|---|
| 1 Token | owner OK | small |
| 2 Jobs | 1 | small |
| 3 Storyboard | 1 | medium |
| 4 Review/download | 1 | small |
| 5 MCP | 2–4 | medium |
| 6 OpenAPI | 3 | small |

## References

- Runpod proxy 100 s timeout: https://docs.runpod.io/pods/configuration/expose-ports
- MCP Tasks (experimental, 2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Replicate sync wait and webhooks: https://replicate.com/docs/reference/http , https://replicate.com/docs/topics/webhooks
- fal.ai queue: https://fal.ai/docs/documentation/model-apis/inference/queue
- MCP image size limits discussion: https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1204
- ComfyUI MCP servers: https://github.com/shawnrushefsky/comfyui-mcp , https://github.com/joenorton/comfyui-mcp-server
- WebMCP (Chrome origin trial): https://developer.chrome.com/docs/ai/webmcp

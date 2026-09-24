# ComfyUI as a headless backend engine (single Runpod GPU)

## Repo health: stars, commit activity, release cadence, maintainer/bus-factor risk

### Takeaway
ComfyUI is an extremely active, high-star repo that was transferred from the personal account of its sole original author (comfyanonymous) to the `Comfy-Org` GitHub organization in January 2026, which reduces single-person bus-factor risk while comfyanonymous remains the top committer and de facto technical lead. Commit and release cadence as of September 2026 is very high (near-daily commits, roughly weekly point releases).

### Cited Findings
- Repo (now canonical at `github.com/Comfy-Org/ComfyUI`, old URL `github.com/comfyanonymous/ComfyUI` redirects there): 134,778 stars, 15,959 forks, 4,924 open issues as of the query on 2026-09-24 — [GitHub API](https://github.com/Comfy-Org/ComfyUI)
- Repo created 2023-01-17; most recent push at query time was 2026-09-24T05:05:20Z — [GitHub API](https://github.com/Comfy-Org/ComfyUI)
- Five most recent commits at query time were all dated 2026-09-23/24, from `comfyanonymous`, `Jukka Seppänen`, and `Simon Pinfold` — i.e., commits land essentially daily from a small core group — [GitHub commits API](https://github.com/Comfy-Org/ComfyUI/commits)
- Last 5 tagged releases: v0.37.0 (2026-09-21), v0.36.0 (2026-09-15), v0.35.0 (2026-09-09), v0.34.0 (2026-08-26), v0.33.1 (2026-08-13) — roughly weekly minor releases — [GitHub releases API](https://github.com/Comfy-Org/ComfyUI/releases)
- Top contributors by commit count: `comfyanonymous` (3,358), `bigcat88` (414), `pythongosssss` (232), `comfyui-wiki` (190), `rattus128` (166), `kijai` (120), `christian-byrne` (108), `huchenlei` (93), `Kosinkadink` (69), `jtydhr88` (64) — [GitHub contributors API](https://github.com/Comfy-Org/ComfyUI/contributors)
- The ComfyUI repository was formally transferred from the `comfyanonymous` personal account to the `Comfy-Org` organization by January 6, 2026, explicitly to reduce reliance on a single account, improve permission management for the growing core team, and support CI/CD and tooling growth — [Comfy Org blog](https://blog.comfy.org/p/comfyui-repo-will-moved-to-comfy), [GitHub Discussion #11558](https://github.com/Comfy-Org/ComfyUI/discussions/11558)
- ComfyUI-Manager (the de facto custom-node package manager) also moved into `Comfy-Org` on March 28, 2025, consolidating more of the ecosystem under the org rather than individual maintainers — [Comfy Org blog](https://blog.comfy.org/p/comfyui-manager-joins-comfy-org)
- GitHub automatically redirects old `comfyanonymous/ComfyUI` links, stars, and forks to the new `Comfy-Org/ComfyUI` location, but users are advised to update git remotes — [Comfy Org blog](https://blog.comfy.org/p/comfyui-repo-will-moved-to-comfy)
- The `Comfy-Org` organization (created 2024-04-10) has 84 public repos and 3,567 followers as of query time, indicating an active organizational ecosystem beyond the core repo (frontend, manager, registry-backend, docs, etc.) — [GitHub Orgs API](https://github.com/Comfy-Org)

### Inferences
- The move to an org account plus a broadening set of frequent non-founder committers (bigcat88, rattus128, huchenlei, Kosinkadink, christian-byrne, Simon Pinfold) suggests bus-factor risk has meaningfully decreased since 2024–2025, though comfyanonymous is still by far the single largest contributor and any strategic direction (e.g., core architecture, official model support) likely still routes through them.
- Weekly release cadence and near-daily commits indicate a well-maintained, non-abandoned project suitable for a production dependency, though the ~4,900 open issues signal a large maintenance backlog typical of a fast-moving OSS project with many custom-node/ecosystem edge cases.

### Gaps
- No official statement found on formal governance/succession plan (e.g., what happens if comfyanonymous becomes unavailable); only inferred from the org-transfer rationale.

---

## LICENSE: ComfyUI core license and licensing of commonly-bundled custom nodes for Wan2.2 / image models

### Takeaway
ComfyUI core is licensed **GPL-3.0** (not MIT, not AGPL), and several commonly-used ecosystem pieces (ComfyUI-Manager, the official ComfyUI_frontend) are also GPL-3.0, which has real implications for a company that wants to bundle/distribute this stack as part of a paid product — GPL requires that source code of the combined/distributed work be made available under GPL if it's distributed as a combined work, though running it as an internal SaaS backend (not distributing the software itself to customers) is generally not restricted by GPL's copyleft (GPL, unlike AGPL, does not trigger on network use alone). Base model weights (Wan 2.2, Qwen-Image, SDXL) are separately licensed from the code and have their own, differing commercial terms — most notably FLUX.1-dev is non-commercial for hosted generation services.

### Cited Findings
- ComfyUI core repo license file is the full text of the **GNU General Public License, Version 3 (GPL-3.0)** — [raw LICENSE file](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/LICENSE); confirmed via GitHub API `license.spdx_id: "GPL-3.0"` — [GitHub API](https://github.com/Comfy-Org/ComfyUI)
- `Comfy-Org/ComfyUI-Manager` (the standard tool for installing/managing custom nodes, effectively required in most headless deployments that need Wan2.2/video wrapper nodes) is also licensed **GPL-3.0**, 16,247 stars — [GitHub API](https://github.com/Comfy-Org/ComfyUI-Manager)
- `Comfy-Org/ComfyUI_frontend` (the official new Vue/TS frontend) is licensed **GPL-3.0**, 2,033 stars, last pushed 2026-09-24 — [GitHub API](https://github.com/Comfy-Org/ComfyUI_frontend)
- `kijai/ComfyUI-WanVideoWrapper` (a widely used community wrapper node set for Wan video models, an alternative/complement to native Wan support) is licensed **Apache-2.0**, 6,710 stars, last pushed 2026-05-24 — [GitHub API](https://github.com/kijai/ComfyUI-WanVideoWrapper)
- FLUX.1-dev ships under a **non-commercial license**: output images can be used commercially, but a company cannot host FLUX.1-dev as a paid generation service without a separate commercial license from Black Forest Labs; FLUX.1-schnell is Apache-2.0 (fully permissive) — [DeepWiki: black-forest-labs/flux licensing](https://deepwiki.com/black-forest-labs/flux/5-commercial-usage-and-licensing), [LocalAIMaster comparison](https://localaimaster.com/blog/best-local-image-models-compared)
- Qwen-Image (20B MMDiT, released 2025-08-04) is Apache-2.0 (commercial use permitted), but the newer **Qwen-Image-2.1** ships under a "commercial-blocking research license," reversing the permissive stance of the original Apache-2.0 Qwen-Image — [ByteIota](https://byteiota.com/qwen-image-2-1-open-weights-come-with-a-license-trap/), [Hugging Face discussion](https://huggingface.co/Qwen/Qwen-Image-2.1/discussions/9)
- SDXL ships under **CreativeML OpenRAIL++-M**, which broadly permits commercial use with standard use-based restrictions (no MIT/Apache-style unconditional permissiveness, but not a blanket non-commercial block either) — [LocalAIMaster comparison](https://localaimaster.com/blog/best-local-image-models-compared)
- Wan 2.2 itself (the video model weights) is described as free and open-weight, running commercially under an Apache-2.0-style license with weights hosted on Hugging Face — [WebSearch synthesis citing thundercompute.com and comfy.org/workflows](https://www.thundercompute.com/blog/wan-2-2-comfyui-ai-video-model)

### Inferences
- Because ComfyUI core, ComfyUI-Manager, and the official frontend are all GPL-3.0 (copyleft, not AGPL), running them as a backend service that customers only interact with over an API/network — without distributing the ComfyUI code itself to customers — does not trigger GPL's source-disclosure obligations (that is an AGPL-specific trigger). Legal risk instead concentrates on: (a) any decision to fork/distribute modified ComfyUI code to third parties, and (b) the model weight licenses, not the ComfyUI code license.
- For the "open image model" leg of the stack, SDXL or Apache-2.0 Qwen-Image (the original release, not Qwen-Image-2.1) are the commercially safest choices; FLUX.1-dev specifically should be treated as legally blocked for a paid hosted generation product unless a commercial license is purchased from Black Forest Labs.

### Gaps
- Did not find a definitive, dated confirmation of which specific SPDX license string Wan 2.2's official Hugging Face model card uses (Apache-2.0 vs. a custom Wan license); the "Apache-2.0-style/commercial" characterization comes from secondary blog coverage, not a primary Hugging Face model-card read, so this should be verified directly against the model card before relying on it legally.
- Did not verify licenses for every possible Wan2.2/SDXL/FLUX-adjacent custom node an implementer might bundle (e.g., ControlNet preprocessors, upscalers); only the most central ones (Manager, frontend, WanVideoWrapper) were checked.

---

## Tech stack: backend, frontend, headless capability

### Takeaway
ComfyUI's backend is a Python (>=3.10) application built on **aiohttp** exposing an HTTP+WebSocket server; the officially maintained frontend (`Comfy-Org/ComfyUI_frontend`) is a **separate repository** written in **TypeScript/Vue/Vite**, published to PyPI and installed as a dependency, but it is decoupled enough from the backend that the backend can be driven purely via its API with the frontend never loaded/served — this is exactly the headless mode a separate custom frontend would use.

### Cited Findings
- `pyproject.toml`: `name = "ComfyUI"`, `requires-python = ">=3.10"`, homepage `comfy.org`, docs at `docs.comfy.org` — [raw pyproject.toml](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/pyproject.toml)
- The backend server (`server.py`) is implemented with the `aiohttp` `web.RouteTableDef` (`@routes.get`/`@routes.post` decorators), i.e., an asyncio/aiohttp web server, not Flask/Django — [raw server.py](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/server.py)
- As of an August 15, 2024 announcement, ComfyUI transitioned to a new official frontend now hosted in its own repo, `Comfy-Org/ComfyUI_frontend` — [GitHub Issue #4169](https://github.com/comfyanonymous/ComfyUI/issues/4169)
- The new frontend "leverages TypeScript, Vue, and Vite," and its compiled JS output is published to PyPI and installed as a Python dependency of ComfyUI core; it is developed as a fully separate repository with its own independent release cycle — [WebSearch synthesis citing github.com/Comfy-Org/ComfyUI_frontend and deepwiki.com/Comfy-Org/ComfyUI_frontend]
- The frontend communicates with the ComfyUI backend purely over HTTP + WebSocket (the same `/ws` channel used for progress events), i.e., it is just another API client with no special privileged access — [WebSearch synthesis, same sources as above]

### Inferences
- Because the frontend is "just an API client" over the same public HTTP/WebSocket surface, a custom web app frontend can fully replace it: launching ComfyUI with `--headless`-style flags (no browser auto-launch) and driving only `/prompt`, `/ws`, `/view`, `/upload/image`, `/history`, `/object_info` is a fully supported, intended integration pattern, not a hack.

### Gaps
- Did not find the exact CLI flag name/documentation page confirming a literal `--headless` or `--disable-frontend` startup flag; inferred headless capability from the frontend/backend architectural separation and widespread "ComfyUI as API backend" tutorials rather than from primary flag documentation.

---

## API quality for headless driving (classic endpoints + newer job/cloud APIs)

### Takeaway
The classic REST+WebSocket surface (`POST /prompt`, `GET /ws`, `GET /view`, `POST /upload/image`, `GET /history`, `GET /object_info`) is confirmed live and unchanged in shape as of ComfyUI v0.37.0 (Sept 2026), and Comfy-Org has since added a newer, more REST-ful `/api/jobs` family of endpoints (list/get/cancel with filtering, sorting, pagination) layered on top of the same execution queue. Separately, Comfy Org now also operates a hosted **Comfy Cloud** offering (cloud.comfy.org) with its own Router/API-key model, but this is a distinct hosted product, not a mandatory replacement for self-hosting — self-hosted ComfyUI's classic API remains fully functional and has **no built-in authentication**, requiring a reverse proxy for auth in production.

### Cited Findings
- Confirmed current route table in `server.py` (master branch, matching the v0.37.0 tag) includes: `GET /ws`, `POST /upload/image`, `POST /upload/mask`, `GET /view`, `GET /view_metadata/{folder_name}`, `GET /system_stats`, `GET /prompt`, `POST /prompt`, `GET /object_info`, `GET /object_info/{node_class}`, `GET /history`, `GET /history/{prompt_id}`, `POST /history`, `GET /queue`, `POST /queue`, `POST /interrupt`, `POST /free` — [raw server.py](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/server.py)
- Newer endpoints also present in the same file: `GET /api/jobs` (filter by `status`, `workflow_id`; `sort_by` of `created_at`/`execution_duration`; `limit`/`offset` pagination), `GET /api/jobs/{job_id}`, `POST /api/jobs/{job_id}/cancel`, `POST /api/jobs/cancel` (batch cancel) — these wrap the same underlying `prompt_queue`/history state as the classic endpoints, and explicitly strip "sensitive" fields from queue snapshots before returning — [raw server.py](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/server.py)
- `POST /prompt` submits an API-format workflow JSON to an execution queue, validates it, and returns a `prompt_id` and queue position (or validation errors); `GET /prompt` returns current queue/execution status — [docs.comfy.org summary](https://docs.comfy.org/development/comfyui-server/comms_routes)
- `/ws` is a WebSocket endpoint delivering JSON messages of types including `status`, `execution_start`, `executing`, `progress`, and `executed` to track a workflow's live execution — [docs.comfy.org summary](https://docs.comfy.org/development/comfyui-server/comms_routes)
- `/view` (GET) retrieves generated images/output files with configurable query parameters (filename, subfolder, type); `/upload/image` and `/upload/mask` (POST) accept file uploads for use as workflow inputs; `/object_info` (GET) returns full node-type schemas (inputs/outputs/widgets) for every registered node, or for one class via `/object_info/{node_class}` — [docs.comfy.org summary](https://docs.comfy.org/development/comfyui-server/comms_routes)
- Docs.comfy.org's own route documentation contains **no authentication details at all**, which independent sources confirm: "ComfyUI has zero built-in authentication" and "no built-in authentication in ComfyUI" — production setups are advised to bind ComfyUI to localhost and front it with a reverse proxy (Nginx/Caddy/Traefik) enforcing API-key, Bearer-token, or OAuth auth — [WebSearch synthesis citing sygnal.com/kb/exposing-comfyui-as-an-external-api, docs.comfy.org/development/comfyui-server/api-proxy]
- Community/third-party custom nodes exist specifically to add auth ComfyUI itself lacks: `ComfyUI-Login` (password login + Bearer token API auth) and `comfyui-basic-auth` (HTTP Basic Auth middleware via env vars) — [WebSearch synthesis]
- Comfy-Org also publishes `Comfy-Org/comfy-api-proxy`, described as "Local proxy exposing the Comfy API v2 in front of a self-hosted ComfyUI instance" — an official but separate/optional component, implying an emerging "API v2" surface distinct from the classic routes — [GitHub search result: github.com/Comfy-Org/comfy-api-proxy]
- Comfy Org operates a hosted product surface at **cloud.comfy.org** offering hosted MCP to run workflows on cloud GPUs, calling partner models through one API endpoint with a single key, and running workflows against a "ComfyUI deployment" from an external application, documented with Router endpoints, headers, and limits — [WebSearch synthesis citing docs.comfy.org and Comfy Org materials]
- A direct fetch of `docs.comfy.org/api-reference/introduction` (guessed URL for the newer API reference) returned HTTP 404, meaning the exact current URL/structure of the hosted API reference could not be directly verified in this session — [WebFetch attempt, 2026-09-24]

### Inferences
- For a single-Runpod-GPU, self-hosted deployment (as opposed to using Comfy Org's own hosted cloud product), the classic `/prompt` + `/ws` + `/view` + `/upload/image` + `/history` + `/object_info` surface remains the right integration target in September 2026; the newer `/api/jobs` endpoints are a nicer, more REST-conventional way to poll/cancel jobs but are additive, not a breaking replacement.
- Because ComfyUI has no authentication, rate limiting, or multi-tenancy story of its own, a company product must implement all of that (API keys, per-customer quotas, reverse proxy) itself in front of ComfyUI — this is a standard, well-documented pattern (Nginx/Caddy + API-key header validation) but is entirely the integrator's responsibility, not something ComfyUI provides.

### Gaps
- Could not directly confirm, from a primary Comfy Org source, precise pricing or rate-limit numbers for the hosted Comfy Cloud/Router API (the `/api-reference/introduction` URL 404'd); only secondhand/aggregated descriptions of its existence and general capabilities were found. An implementer should visit docs.comfy.org directly (site navigation/search) to locate the current cloud API reference rather than relying on the URL guessed here.
- Did not find explicit documentation of any request-body size limits or built-in rate-limiting on the classic self-hosted endpoints (evidence suggests there are none by default, consistent with the "no auth, no rate limiting built in" finding above, but this is an absence-of-evidence inference, not a confirmed negative).

---

## Wan 2.2 (video) and open image model (FLUX/SDXL/Qwen-Image) support

### Takeaway
ComfyUI has official, native (not third-party-only) support for Wan 2.2 text-to-video and image-to-video workflows, with first-party example workflows published by Comfy Org/docs.comfy.org, and also has current-generation support for FLUX.1, SDXL, and Qwen-Image as an image-generation option — all citable via official docs/workflow pages rather than only blog posts.

### Cited Findings
- Comfy Org publishes an official native workflow tutorial for Wan 2.2 at `docs.comfy.org/tutorials/video/wan/wan2_2`, titled "Wan2.2 Video Generation ComfyUI Official Native Workflow Example" — [docs.comfy.org](https://docs.comfy.org/tutorials/video/wan/wan2_2)
- Comfy Org's own workflow gallery hosts a dedicated Wan 2.2 5B text/image-to-video workflow (`video_wan2_2_5B_ti2v`) and a broader "Wan Comfy Workflows" collection of free templates — [comfy.org/workflows/video_wan2_2_5B_ti2v-f83ee3caa04e](https://comfy.org/workflows/video_wan2_2_5B_ti2v-f83ee3caa04e/), [comfy.org/workflows/model/wan](https://comfy.org/workflows/model/wan/)
- ComfyUI ships (per WebSearch synthesis of the above official pages) five official Wan 2.2 workflow templates covering: text-to-video, image-to-video, control video (motion guidance), video outpainting, and first-last-frame interpolation — [WebSearch synthesis of docs.comfy.org / comfy.org sources]
- Wan 2.2 model variants: the 5B model runs on 6–8GB VRAM; the 14B model needs 24GB+ for quality 480p/720p output — directly relevant to single-GPU Runpod sizing decisions — [WebSearch synthesis citing thundercompute.com/blog/wan-2-2-comfyui-ai-video-model]
- Community-maintained low-VRAM Wan 2.2 14B workflow exists as a GitHub repo (`Cordux/ComfyUI-Wan2.2-workflow`), and `kijai/ComfyUI-WanVideoWrapper` (Apache-2.0, 6,710 stars) is a widely used alternative/companion node pack for more advanced Wan video control — [github.com/Cordux/ComfyUI-Wan2.2-workflow](https://github.com/Cordux/ComfyUI-Wan2.2-workflow), [github.com/kijai/ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper)
- FLUX.1-dev in FP16 requires roughly 22GB VRAM just for model weights — a concrete data point for image-model GPU sizing alongside Wan 2.2 on one Runpod GPU — [WebSearch synthesis citing production-deployment discussion threads]
- SDXL and Qwen-Image are both cited as viable, commercially-usable current-generation open image models comparable to FLUX for local/self-hosted deployment as of 2026 — [localaimaster.com/blog/best-local-image-models-compared](https://localaimaster.com/blog/best-local-image-models-compared)

### Inferences
- Because official docs.comfy.org tutorials and official comfy.org workflow-gallery entries exist specifically for Wan 2.2, ComfyUI's Wan 2.2 support should be treated as first-party/official, not merely community-hacked-together — reducing integration risk for a product roadmap built around it.
- Running both a 14B-class Wan 2.2 video workflow and a FLUX/SDXL/Qwen-Image image workflow on a single rented GPU is feasible only with careful VRAM budgeting (e.g., 24GB+ card, sequential model loading/offloading rather than keeping both fully resident) given the ~22–24GB+ figures cited for both Wan 2.2 14B and FLUX.1-dev individually.

### Gaps
- Did not verify the exact VRAM figures for Qwen-Image or SDXL for a direct three-way apples-to-apples comparison (only FLUX.1-dev's ~22GB figure was directly sourced); an implementer sizing the Runpod GPU should pull exact figures from each model's Hugging Face card.
- Did not confirm whether Wan 2.2's video-generation VRAM figures already include the separate text encoder / VAE memory overhead, which can be substantial in ComfyUI video workflows.

---

## Known issues running ComfyUI headless in production

### Takeaway
ComfyUI is architecturally a **single-process, single-job-at-a-time** server with no built-in job queue, multi-GPU scheduler, or authentication; running it in a real multi-tenant production setting on one GPU requires external orchestration (reverse proxy, queue, warmup jobs), and there are documented, sometimes only partially resolved memory-leak issues to watch for over long-running sessions.

### Cited Findings
- A ComfyUI process executes one workflow at a time; `POST /prompt` enqueues a job and returns its queue position — two different users' jobs are not expected to run concurrently on a single process; the documented production pattern is one ComfyUI process per GPU with requests routed to the least-busy process — [WebSearch synthesis citing GitHub Discussion #5941 "Optimizing ComfyUI for Parallel Workflow Processing on a Single GPU"](https://github.com/Comfy-Org/ComfyUI/discussions/5941)
- "ComfyUI has no built-in job queue, authentication, or multi-GPU scheduler — it is a single-process, single-user server by design"; true multi-job parallelism on a single GPU is not how ComfyUI schedules work by default — [WebSearch synthesis citing dev.to "Running Multiple ComfyUI Instances in Parallel on a Single GPU"](https://dev.to/abdollah_ebadi_cbec8f6471/running-multiple-comfyui-instances-in-parallel-on-a-single-gpu-what-actually-breaks-first-4n04)
- The documented production pattern is a message queue (Redis/SQS) in front of a worker pool, each worker running its own ComfyUI instance on its own GPU, with outputs pushed to object storage and a reverse proxy handling auth — directly relevant since the target deployment is a *single* Runpod GPU, meaning true request concurrency is not achievable without multiple processes/instances sharing that one GPU (with attendant VRAM contention) — [WebSearch synthesis, same sources as above]
- SQLite-backed state requires giving each ComfyUI instance its own isolated database file (via `--database-url`) when running multiple instances, described as an "underdocumented requirement that blocks multi-instance setups silently" — [WebSearch synthesis citing markaicode.com production-stack articles]
- Cold-start penalty: the first job on a freshly started instance is 2–3x slower due to model loading, so production deployments are advised to run warmup jobs at startup — [WebSearch synthesis, same sources as above]
- GitHub Issue #11301, "RAM Memory Leak," reported 2025-12-13: running Image Batch workflows repeatedly increased committed RAM by ~10GB per run without releasing it, eventually requiring a restart on a 64GB RAM/24GB VRAM Windows 11 system; issue is marked Closed on GitHub but the fetched issue page did not show the specific resolving commit or maintainer explanation — [GitHub Issue #11301](https://github.com/Comfy-Org/ComfyUI/issues/11301)
- A separate VRAM leak caused by the Python call stack holding tensor references during VAE out-of-memory exception handling was identified and has reportedly been addressed in recent updates — [WebSearch synthesis citing Hugging Face forum2 dataset notes on ComfyUI multi-user memory behavior]
- Recommended mitigations for headless/worker stability cited: start with `--async-offload`, and if needed `--reserve-vram 2` to leave headroom for the OS; disable image previews on headless workers — [WebSearch synthesis, same source]

### Inferences
- For a single rented Runpod GPU serving multiple users/requests, the realistic architecture is: one ComfyUI process bound to that GPU behind an application-level job queue that serializes requests (accepting that true parallel generation isn't available on one GPU/process anyway), rather than expecting ComfyUI itself to handle concurrency — this matches ComfyUI's actual queueing behavior (`/prompt` already queues sequentially) rather than requiring a workaround.
- Long-running headless deployments should budget for periodic process restarts or active monitoring of RAM/VRAM growth given the documented (if apparently since-patched) memory-leak history, especially for batch/video-heavy workloads (image batches, long video generations) which are exactly the "Wan 2.2 video" use case in question.

### Gaps
- Did not find a primary-source (GitHub) confirmation of the exact commit/PR that closed Issue #11301, so it's unclear whether the RAM leak is fully fixed as of the current v0.37.0 release or only mitigated for the specific reported case; the fetched issue summary noted the closure but not the fix details.
- Did not independently pull Reddit r/comfyui or r/StableDiffusion threads directly (WebSearch results surfaced Hugging Face forum mirrors and dev blog posts covering similar ground instead); the production-concurrency and memory findings above are secondhand syntheses of blog/dev.to/Hugging Face content rather than direct primary GitHub issue reads, except for Issue #11301 itself.

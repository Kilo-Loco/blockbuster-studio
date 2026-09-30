# Blockbuster Studio

**Website:** https://blockbuster.studio · **Docs:** https://docs.blockbuster.studio · **Deploy:** [one click on Runpod](https://runpod.io/gsc?template=557xi57ae9&ref=48znv8n5)

Your own AI film studio, self-hosted on a single rented GPU. Images, video, character-consistent
editing, camera angles driven by a top-down location map, AI script breakdown, a shot pipeline and
a timeline export — all running inside one Runpod pod you control. No subscriptions, no
per-generation fees, nothing leaves your pod's volume unless you choose to export it.

<!-- TODO: add a screenshot of the Studio page here once the app UI is running, e.g.:
     ![Blockbuster Studio](docs/screenshot.png) -->

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it fits together, and
[`docs/research/SUMMARY.md`](docs/research/SUMMARY.md) for why these particular models/frameworks
were chosen.

## Quick start (for people deploying the studio)

The [user docs](https://docs.blockbuster.studio) walk through deploying and using the studio step by step.

1. Click **Deploy on Runpod** on the [landing page](site/index.html) (or the button on the
   operator's GitHub Pages / Netlify / Vercel deployment of `site/`).
2. On the Runpod deploy screen, select **RTX PRO 4500** (32 GB, Secure Cloud; Runpod pre-selects the
   first GPU by VRAM, often a pricier card), click **Add volume** to attach the recommended 180 GB at `/workspace` (required:
   models and projects live there). Optionally set `STUDIO_PASSWORD` under **Set overrides**, as a
   Runpod Secret reference (`{{ RUNPOD_SECRET_studio_password }}`) so it isn't stored in plain text,
   and deploy.
3. Wait for first boot. Models (~128 GB) download in the background, and each feature unlocks as
   its models land. Measured on a Runpod RTX PRO 4500 (2026-09-29): studio up in **~1–2 min**,
   everything downloaded in **~10 min**, depending on the host's network.

### Measured performance (default settings)

| Task | Time |
|---|---|
| Image (Z-Image Turbo, 1344×768) | ~3–5 s warm, ~18 s first run (4090) |
| Edit / camera angle (Qwen-Image-Edit 2511) | ~30 s (4090) |
| Video, 5 s at 832×512 (LTX-2.5, with sound) | ~40 s warm (4090) |
| Previs shot, 5 s HD (LTX-2.5 + reference sheet + depth, two-stage) | ~2–2.5 min (RTX PRO 4500) |
| Storyboard shot keyframe (angle plate + characters) | ~35–60 s (4090) |
| Film export (ffmpeg) | ~3 s |

### If the studio says the GPU isn't working

Occasionally a Runpod community machine exposes a GPU that CUDA can't initialize. The studio
detects this at boot and shows a red banner. Terminate the pod and deploy again to land on a
different machine; Secure Cloud avoids this almost entirely.
4. Open the pod's HTTP port 3000 from the Runpod console, or go to
   `https://<POD_ID>-3000.proxy.runpod.net`. On the first visit you create
   your password (setup is only open for the first 15 minutes after the pod starts; restart the pod
   to reopen it). Forgot it? Set `STUDIO_PASSWORD` with **Edit Pod** (ideally as a Runpod Secret reference);
   it overrides the stored one.

### Environment variables

Runpod shows a pod's environment variables in plain text to anyone, and any tool or agent, with access to
your Runpod account. Keep secrets out of them: enter API keys and the Hugging Face token on the studio's
**Settings** page (they stay on the pod's volume), or create a [Runpod Secret](https://docs.runpod.io/pods/templates/secrets)
and set the variable to a reference such as `HF_TOKEN` = `{{ RUNPOD_SECRET_hf_token }}`. The pod gets the
value at startup; the console and API only ever show the reference.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `STUDIO_PASSWORD` | optional | created on first visit (scrypt hash in `/workspace/studio/password.json`); `change-me` counts as unset | Login password; overrides the one created on first visit |
| `STUDIO_AGENT_TOKEN` | optional | generated on first boot in `/workspace/studio/agent-token` | Token an AI agent uses instead of the password (see [Connect an agent](#connect-an-agent)). Set it as a Runpod **Secret**; 32+ characters |
| `AGENT_ACCESS` | optional | `true` | `false` turns agent access off: no token is created and Bearer tokens are rejected |
| `SETUP_WINDOW_MINUTES` | optional | `15` | How long after start an unclaimed studio accepts first-visit setup |
| `DOWNLOAD_IMAGE_MODELS` | no | `true` | Z-Image Turbo (~21 GB): images, character refs, establishing shots |
| `DOWNLOAD_VIDEO_MODELS` | no | `true`, skipped while LTX-2.5 is on | Wan 2.2 image→video (~38 GB), the older engine. Not listed on the template; it only downloads if you set `DOWNLOAD_LTX_MODELS=false` |
| `DOWNLOAD_EDIT_MODELS` | no | `true` | Qwen-Image-Edit + camera angles (~31 GB): edits, angles, storyboard compositing |
| `DOWNLOAD_PERFORM_MODELS` | no | `true` | Wan Animate 2 (~18 GB): Perform mode |
| `DOWNLOAD_TEXT_TO_VIDEO_MODELS` | no | `true`, skipped while LTX-2.5 is on | Native Wan text→video (~31 GB), the older engine. Not listed on the template; it only downloads if you set `DOWNLOAD_LTX_MODELS=false`. If off, text→video still works via image→video |
| `DOWNLOAD_MINIMAX_REF_MODELS` | no | `false` | **Opt-in** MiniMax H3 **reference-to-video** (~23 GB on top of the H3 group, same license): a shot (or `POST /api/generate` with `engine: "h3_ref"`) takes up to 9 **reference images** (character sheets, vehicle sheets, location plates) and up to 3 **reference videos** (a previs cut for camera moves and timing) and renders a clip with sound that keeps their identity, in H3's Ref2VA prompt structure (subject definitions, retention analysis). This is the "sheets plus playblast" workflow of hosted reference-to-video services, on your own pod |
| `DOWNLOAD_CONTROL_MODELS` | no | `false` | **Opt-in** [Wan 2.2 Fun-Control](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control) (~29 GB, Apache-2.0): video-to-video. A shot (or `POST /api/generate` with `engine: "wan_control"`) can take a **control video** whose motion the clip follows frame by frame (edges are extracted from it by default; depth or edge renders can be fed as is) with the keyframe as the reference for identity and look. Made for 3D blockouts and previs, but any footage works. 81 frames at 16 fps per clip (5 s); ~80–140 s per clip on a 4090 with the bundled 4-step LoRAs |
| `DOWNLOAD_VOICE_MODELS` | no | `true` | [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) VoiceDesign + Base 1.7B (~9 GB, Apache-2.0): character voices. Give a character a voice in **Cast** (describe it, or upload a 5–15 s clip); every line they speak in the storyboard is recorded in that voice. With LTX-2.5 the shot is animated to that recording (lip sync); on Wan the export mixes the line in, with a little room sound so it doesn't sound pasted on. Runs as a small sidecar next to ComfyUI, one GPU user at a time. |
| `DOWNLOAD_MINIMAX_MODELS` | no | `false` | **Opt-in** [MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3) (~42 GB, added on top of the default download): renders Video, Animate and storyboard clips **with sound** (24 fps, up to 720p). If LTX-2.5 is also on, LTX-2.5 renders unless a shot picks H3. Turning it on also skips the Wan image→video and text→video downloads it replaces (a no-op by default, since those are already off); Perform keeps using Wan Animate. To keep Wan too (e.g. for Wan LoRAs), list groups explicitly with `MODEL_GROUPS`. MiniMax H3 LoRAs (Civitai base model "MiniMax H3") import and upload as their own type and stack on the turbo LoRA. Prompts are rewritten into H3's official structure automatically (camera presets, `Audio:` / `Music:` sections, quoted dialogue). Its [community license](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) excludes the US, EU, UK and South Korea unless you get a license from MiniMax, and requires "Powered by MiniMax H3" (the studio shows it). You're responsible for checking it applies to you. |
| `DOWNLOAD_LTX_MODELS` | no | `true` | **Default video engine.** [LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5) by Lightricks (~40 GB): renders Video, Animate and storyboard clips **with sound and spoken dialogue** (24 fps). It skips the Wan image→video and text→video downloads it replaces; Perform keeps using Wan Animate. If MiniMax H3 is also on, LTX-2.5 renders unless a shot picks H3. **Gated:** accept the terms at huggingface.co/Lightricks/LTX-2.5 with your Hugging Face account, then save a token from that account on the **Settings** page; the download waits for it and resumes on its own (or set `HF_TOKEN` from a Runpod Secret before deploying). LTX-2.x LoRAs (Civitai base model "LTXV2") import as their own type. Storyboard clips with a start and end keyframe use LTX's first/last-frame guides. On a 4090 a 5 s clip takes ~40 s at 832×512 and ~80 s at 1280×704 once warm (10 s HD: ~2.5 min); the first clip after boot adds ~1.5 min of model loading. Its [community license](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x) is free under $10M annual revenue, but requires a separate license from Lightricks for products that directly compete with theirs, forbids getting around its safety features, and requires published outputs to be disclosed as machine-generated. It was trained mostly on SFW footage. You're responsible for checking the license applies to you. |
| `DOWNLOAD_LTX_IC_MODELS` | no | `true` | LTX-2.5 union-control IC-LoRA (~0.7 GB, same license): shots follow a control video (a previs depth pass or edges) frame by frame |
| `DOWNLOAD_LTX_INGREDIENTS_MODELS` | no | `true` | LTX-2.5 Ingredients IC-LoRA (~1.3 GB, gated like LTX-2.5; accept its terms too): a scene's **reference sheet** (characters, props and location on one image) keeps them consistent across shots. With a scene previs, each shot renders from the sheet plus its slice of the previs |
| `DOWNLOAD_UPSCALE_MODELS` | no | `false` | **Opt-in** [SeedVR2](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) 7B (~9 GB, Apache-2.0): an export-time 4K upscale, turned on per project (Timeline: **HD** / **4K**). Slow — about 5 minutes of GPU time per second of film — so it's off by default and meant for a final export, not iteration |
| `MODEL_GROUPS` | no | – | Advanced override: comma list of group ids (`image,edit,ltx,ltx_ic,ltx_ingredients,voice,perform`, plus `video`, `t2v`, `minimax`, `minimax_ref`, `control`, `wan_vace`, `upscale`) or `all` (which leaves the opt-ins out unless their switch is on) |
| `HF_TOKEN` | no | unset | Hugging Face token — raises rate limits, required for the gated LTX-2.5 and LTX-2.5 Ingredients repos (accept both repos' terms first). Prefer saving it on the **Settings** page (it wins over this variable, and the model downloader picks it up without a restart) or setting this from a Runpod Secret |
| `CIVITAI_TOKEN` | no | unset | Enables importing LoRAs from Civitai inside the app |
| `ANTHROPIC_API_KEY` | no | unset | Enables AI script breakdown + prompt enhancement (Claude) |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | no | unset | Alternative to Anthropic: any OpenAI-compatible endpoint |
| `PUBLIC_KEY` | no | unset | Runpod convention: your SSH public key, enables sshd for power users |

### Connect an agent

An AI agent such as Claude Code can make films on the pod by itself: write the storyboard, render,
look at every frame and clip, fix what's wrong, export and download. It connects to the studio's
MCP server at `/mcp` with an agent token instead of your password.

1. Get the token. In Runpod, open the pod's web terminal (**Connect → Start Web Terminal**) or SSH
   in, and run `cat /workspace/studio/agent-token`. Only someone who can open a shell on the pod
   can read it. (Or set your own with the `STUDIO_AGENT_TOKEN` secret.)
2. Connect Claude Code:

   ```bash
   claude mcp add --transport http blockbuster https://<POD_ID>-3000.proxy.runpod.net/mcp --header "Authorization: Bearer <token>"
   ```

3. Ask it for a film. It sees tools such as `create_storyboard`, `generate_frames`,
   `wait_for_jobs`, `review_asset` and `export_film`. None of them delete anything.

Agents that prefer plain HTTP can use the same token with the REST API (`/api/openapi.json`).
Anyone with the token can use the studio, so keep it private. **Settings → Agent access** makes a
new one (the old one stops working at once); the token is never shown in the studio or its logs.
Wrong tokens are throttled like wrong passwords, and `AGENT_ACCESS=false` turns agent access off.

### GPU guidance

- **RTX PRO 4500 32 GB** (recommended) — the card the full workflow is tested on: the default
  models, previs films and the 4K export. ~$0.72/hr on Runpod Secure Cloud.
- If it isn't available, pick another card with **32 GB or more** (for example an RTX 5090). The
  image's CUDA 12.8 base supports Blackwell and Ada cards.
- A 24 GB card (RTX 4090) runs images, edits and LTX-2.5 video, but the 4K export may not fit and
  the previs flow hasn't been tested on it.
- Prices vary by region and availability; check the Runpod console before deploying.

### Persistence

Everything (models, projects, generated media, the SQLite database) lives on the pod's
`/workspace` volume.

- **Stopping** the pod keeps the volume — you keep paying for storage only, and can resume later.
- **Terminating** the pod **deletes the volume permanently**, including all your projects and media.

## Operator guide (for whoever runs this repo)

1. **Push to GitHub.** `.github/workflows/docker.yml` builds `docker/Dockerfile` on every push to
   `main` and on `v*` tags, and pushes to `ghcr.io/<owner>/blockbuster-studio` with `:latest`,
   `:<git-sha>` and semver tags. After the first push, make the GHCR package **public**
   (package settings → Change visibility) so Runpod can pull it without registry credentials.
   **Also push to Docker Hub** (recommended): add the repository secrets `DOCKERHUB_USERNAME` and
   `DOCKERHUB_TOKEN` (a Docker Hub access token with write scope) and the same workflow pushes
   `docker.io/<username>/blockbuster-studio` with the same tags. Runpod hosts pull Docker Hub images far
   faster than GHCR: on hosts without the image cached, GHCR pulls took over an hour (2026-09-28), which is
   an hour of GPU billing before the studio starts. Point the templates at the Docker Hub image.
2. **Create/update the Runpod template:**
   ```sh
   RUNPOD_API_KEY=... node runpod/deploy-template.mjs
   ```
   This creates the template on first run (or updates it if `runpod/.template-id` / `TEMPLATE_ID`
   already points at one), prints the deploy link, and writes it into `site/config.js`. Pass
   `IMAGE=docker.io/<username>/blockbuster-studio:latest` (or the GHCR image) if the default is wrong, and
   `RUNPOD_REF=<your referral code>` to earn the Runpod creator/referral share. Use `--dry-run` to
   preview the API payload without calling Runpod.
3. **Deploy `site/`** to GitHub Pages / Netlify / Vercel — it's a static site with no build step;
   just point the host at the `site/` directory. Re-run step 2 whenever the template changes so
   `site/config.js` (and the live "Deploy on Runpod" button) stay in sync.
4. **Referral code (optional).** Set `RUNPOD_REF` when running `deploy-template.mjs` to include your
   Runpod referral code in the generated deploy link.
5. **Deploy `docs-site/`** (the user docs, built with [Blume](https://useblume.dev)) as a second Vercel
   project with **Root directory** `docs-site` and the domain `docs.blockbuster.studio`.
   `docs-site/vercel.json` sets the build; pushes to `main` redeploy it.

## Local development

```sh
cd app
npm install
npm run dev     # mock ComfyUI + server + Vite dev server, concurrently
```

`npm run build` produces `app/dist/web` (static SPA) and `app/dist/server.js` (bundled Hono
server); `npm start` runs the built server. See `app/package.json` for the full script list
(`typecheck`, `test`, `validate:workflows`).

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/API.md`](docs/API.md).

## Licenses & third-party notices

Our code (everything under `app/`, `docker/`, `runpod/`, `site/`) is MIT-licensed — see
[`LICENSE`](LICENSE). Third-party components and models keep their own licenses; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the full list. Notably:

- **ComfyUI** (GPL-3.0) runs as a separate, unmodified, headless process inside the container —
  we don't link against or modify it, we drive it over its HTTP/WS API.
- **Wan 2.2, Z-Image Turbo, Qwen-Image-Edit-2511, and the multi-angle LoRA** are all Apache-2.0.

## Content policy

The studio adds no content filtering of its own. The open models are only as filtered as their
publishers ship them, so you're responsible for what you make and for following each model's
license.

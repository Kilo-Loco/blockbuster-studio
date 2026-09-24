# Blockbuster Studio

**Website:** https://blockbuster.studio · **Deploy:** [one click on Runpod](https://runpod.io/gsc?template=557xi57ae9&ref=48znv8n5)

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

1. Click **Deploy on Runpod** on the [landing page](site/index.html) (or the button on the
   operator's GitHub Pages / Netlify / Vercel deployment of `site/`).
2. On the Runpod deploy screen, set **`STUDIO_PASSWORD`** to a password of your choice (recommended),
   pick your GPU (RTX 4090 is the default and fits everything), and deploy.
2b. On Runpod's deploy page: select **RTX 4090** (it pre-selects the first GPU by VRAM, often a
   pricier card), click **Add volume** to attach the recommended 150 GB at `/workspace` (required:
   models and projects live there), and set `STUDIO_PASSWORD` under **Set overrides**.
3. Wait for first boot. Models (~90 GB) download in the background, and each feature unlocks as
   its models land. Measured on a Runpod RTX 4090 (2026-09-24): studio up in **~2 min**, images at
   **~3 min**, everything (video + edit) at **~6–18 min** depending on the host's network.

### Measured performance (RTX 4090, default settings)

| Task | Time |
|---|---|
| Image (Z-Image Turbo, 1344×768) | ~3–5 s warm, ~18 s first run |
| Edit / camera angle (Qwen-Image-Edit 2511) | ~30 s |
| Video, 5 s at 480p (Wan 2.2 I2V + Lightning) | ~73–84 s |
| Storyboard shot keyframe (angle plate + characters) | ~35–60 s |
| Film export (ffmpeg) | ~3 s |

### If the studio says the GPU isn't working

Occasionally a Runpod community machine exposes a GPU that CUDA can't initialize. The studio
detects this at boot and shows a red banner. Terminate the pod and deploy again to land on a
different machine; Secure Cloud avoids this almost entirely.
4. Open the pod's HTTP port 3000 from the Runpod console, or go to
   `https://<POD_ID>-3000.proxy.runpod.net`. Log in with your password.

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `STUDIO_PASSWORD` | recommended | auto-generated, printed to pod logs / `/workspace/studio/PASSWORD.txt` | Login password |
| `MODEL_GROUPS` | no | `image,video,edit` | Comma list of model groups to download on boot (`t2v` optional, or `all`) |
| `HF_TOKEN` | no | unset | Hugging Face token — raises rate limits, required for any gated repo |
| `CIVITAI_TOKEN` | no | unset | Enables importing LoRAs from Civitai inside the app |
| `ANTHROPIC_API_KEY` | no | unset | Enables AI script breakdown + prompt enhancement (Claude) |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | no | unset | Alternative to Anthropic: any OpenAI-compatible endpoint |
| `PUBLIC_KEY` | no | unset | Runpod convention: your SSH public key, enables sshd for power users |

### GPU guidance

- **RTX 4090 24 GB** (default) — fits the full default model stack, ~$0.34/hr on Runpod
  community cloud (~$0.74/hr secure cloud). This is what the template ships with.
- **RTX 5090 / L40S** — meaningfully faster generation if you don't mind paying more per hour;
  the image is built on a CUDA 12.8 base that supports Blackwell (5090) as well as Ada (4090).
- Prices vary by region/availability — check the Runpod console for current community-cloud rates
  before deploying.

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
2. **Create/update the Runpod template:**
   ```sh
   RUNPOD_API_KEY=... node runpod/deploy-template.mjs
   ```
   This creates the template on first run (or updates it if `runpod/.template-id` / `TEMPLATE_ID`
   already points at one), prints the deploy link, and writes it into `site/config.js`. Pass
   `IMAGE=ghcr.io/<owner>/blockbuster-studio:latest` if the default placeholder owner is wrong, and
   `RUNPOD_REF=<your referral code>` to earn the Runpod creator/referral share. Use `--dry-run` to
   preview the API payload without calling Runpod.
3. **Deploy `site/`** to GitHub Pages / Netlify / Vercel — it's a static site with no build step;
   just point the host at the `site/` directory. Re-run step 2 whenever the template changes so
   `site/config.js` (and the live "Deploy on Runpod" button) stay in sync.
4. **Referral code (optional).** Set `RUNPOD_REF` when running `deploy-template.mjs` to include your
   Runpod referral code in the generated deploy link.

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

The open models used here are not filtered beyond what upstream ships, and the studio doesn't add
prompt filtering for adult content between consenting adults. The one thing that's always on and
cannot be disabled: the server hard-blocks any prompt describing sexual content involving minors.

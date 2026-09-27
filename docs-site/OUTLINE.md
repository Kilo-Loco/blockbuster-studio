# Blockbuster Studio user docs: outline

This is the full list of what users will eventually need documented. **v1** pages are written
in `docs/` for launch review. **Later** items are deliberately left out of v1 and are listed so
nothing gets lost.

Source of truth for every fact: the web UI (`app/web/src`), server (`app/server`),
`runpod/presets.json`, `config/models.json` and `site/index.html`.

## v1 (written, awaiting review)

| Page | File | Covers |
|---|---|---|
| Introduction | `docs/index.mdx` | What the studio is, what you need, what it costs, where to go next |
| Quickstart | `docs/quickstart.mdx` | Pick a preset → deploy on Runpod (GPU, volume, overrides) → open the studio → create password → wait for models → first image |
| Create images and video | `docs/guides/create.mdx` | Create page: the five composer modes (Image, Video, Edit, Angles, Perform), shared options, viewer actions, gallery, downloads, queue |
| Make a film | `docs/guides/make-a-film.mdx` | Projects: new film → AI breakdown → storyboard (scenes, shots, shot panel, duplicate/delete) → generate frames → animate → timeline → export → back up; dialogue and voices (Record lines); building by hand without an AI; styles |
| Characters and locations | `docs/guides/characters-and-locations.mdx` | Cast (references, reference sheet, voices), Locations (establishing shot, map basics, angle gallery), how the storyboard uses them |
| Settings and API keys | `docs/manage/settings.mdx` | Connect an AI (Anthropic / OpenAI-compatible), download tokens, defaults, model status (incl. gated-download token field), disk, agent access (short), deploy-time environment variables and Runpod Secrets |
| Stop, resume and back up | `docs/manage/stop-and-back-up.mdx` | Stop vs terminate, costs while stopped, downloading media, project backups, storage full |
| Troubleshooting | `docs/manage/troubleshooting.mdx` | Every banner and common error with its fix |

## Later (not in v1)

### Guides
- **LoRAs**: Import (Civitai / Hugging Face / URL), Upload `.safetensors`, Train (Z-Image only, ai-toolkit, ~30–60 min on a 4090), families (Z-Image, Wan 2.2, Qwen Edit, MiniMax H3), strength, trigger words, attaching to characters, per-shot LoRA overrides.
- **Location map editor in depth**: tools (wall, door, window, prop rect/circle, zone, label), map size in meters, background floor-plan upload, subject + reference camera alignment, undo/redo, autosave.
- **Blocking and camera placement in depth**: blocking dialog (drag, R to rotate 15°), shot mini-map camera/look-at/height, how azimuth/elevation/distance and screen placement are derived.
- **Perform in depth**: recording tips, 15 s cap, 16 fps resampling, character staging, portrait vs landscape.
- **Writing good prompts**: shot sizes (ECU … EWS), the 17 camera moves with their hints, Auto prompts panel and "Reset to auto", Enhance prompt.
- **Connect an agent**: MCP server at `/mcp`, reading the agent token from the pod (`cat /workspace/studio/agent-token`), the `claude mcp add` command, what the tools can and can't do, token rotation, `STUDIO_AGENT_TOKEN` / `AGENT_ACCESS`, REST via `/api/openapi.json`. v1 only has a short section in Settings.
- **Voices in depth**: designing vs cloning, transcripts, re-recording when words/speaker/voice change, fitting a shot to its line, lip sync on LTX-2.5 vs mixed-in lines on Wan.
- **LTX-2.5 (opt-in video model)**: enabling (`DOWNLOAD_LTX_MODELS=true`), accepting the gated terms, sound and spoken dialogue, 4–10 s clips, license terms (under $10M revenue, non-compete, AI-generated disclosure).
- **MiniMax H3 (opt-in video model)**: how to enable (`DOWNLOAD_MINIMAX_MODELS=true`), sound, 24 fps, 4–15 s clips (HD ≤10 s under 30 GB VRAM), prompt structure (`Audio:` / `Music:`, quoted dialogue), license territory exclusions and required attribution.

### Reference
- Keyboard shortcuts (⌘/Ctrl+Enter, ←/→, Esc, map editor ⌘Z/⌘⇧Z, Delete, R in blocking).
- Full environment variable reference (incl. `SETUP_WINDOW_MINUTES`, `MODEL_GROUPS`, `PUBLIC_KEY`, `DOWNLOAD_VOICE_MODELS`, `DOWNLOAD_LTX_MODELS`, `STUDIO_AGENT_TOKEN`, `AGENT_ACCESS`).
- Install presets and model groups (sizes, what each unlocks).
- GPU guide and measured performance (4090 vs 5090 / L40S, Secure vs Community Cloud).
- Queue behavior (one job at a time, model-affinity ordering, cancel/retry).
- Project backup ZIP layout.
- Models and licenses (Apache-2.0 stack incl. Qwen3-TTS, ComfyUI GPL-3.0, MiniMax H3 and LTX-2.x community licenses).
- Content policy (see open question below).
- REST API (`docs/API.md` and `/api/openapi.json` exist; fold into the Connect an agent guide).

### Other
- FAQ (privacy, pricing, GPU choice) once real user questions come in.
- Screenshots / short clips for Quickstart, Create, and Make a film.

## Open questions for review
1. **Content policy mismatch.** `README.md`, `site/index.html` (FAQ) and `THIRD_PARTY_NOTICES.md`
   say the server hard-blocks sexual content involving minors, but that guard was removed in
   commits `35eda73` / `3c4e00c` (still true on `main` as of 2026-09-27). v1 docs say nothing about content policy. Decide the policy and
   make the code and all three places agree before publishing any statement.
2. **Docs domain.** `blume.config.ts` has no `deployment.site` yet (needed for sitemap, canonical
   URLs, OG images). Set it once the docs URL (e.g. `docs.blockbuster.studio`) is chosen.
3. **Screenshots.** None yet. The pages are written to work without them.

# Open-Source LoRA Training Tools for Wan 2.2 / Z-Image-Turbo on a 24GB GPU

## License, exact SPDX/name for each tool

### Takeaway
The four primary candidates split between permissive and copyleft licenses: ai-toolkit is MIT (most permissive, best for embedding in a commercial self-hosted product), musubi-tuner is Apache-2.0, diffusion-pipe is GPL-3.0, and SimpleTuner is AGPL-3.0 (the most restrictive — AGPL's network-use clause is a real consideration for a hosted web app that runs it as a backend service). OneTrainer's license was not directly re-verified in this pass but is commonly cited as AGPL-3.0 as well; treat as unverified here.

### Cited Findings
- ostris/ai-toolkit is licensed MIT — [GitHub: ostris/ai-toolkit](https://github.com/ostris/ai-toolkit)
- kohya-ss/musubi-tuner is licensed Apache License 2.0, "with exceptions for modified code from specific projects" — [GitHub: kohya-ss/musubi-tuner](https://github.com/kohya-ss/musubi-tuner)
- tdrussell/diffusion-pipe is licensed GPL-3.0 — [GitHub: tdrussell/diffusion-pipe](https://github.com/tdrussell/diffusion-pipe)
- bghira/SimpleTuner is licensed AGPL-3.0 — [GitHub: bghira/SimpleTuner](https://github.com/bghira/SimpleTuner)

### Inferences
- For a self-hosted commercial SaaS backend, ai-toolkit (MIT) and musubi-tuner (Apache-2.0) carry the least legal friction. diffusion-pipe's GPL-3.0 mainly constrains distributing modified copies of diffusion-pipe itself, not necessarily the wider app, but modifications you make to diffusion-pipe would need to stay GPL if distributed. SimpleTuner's AGPL-3.0 is the one requiring the most legal care: AGPL's network-interaction clause can require you to offer source of your modified SimpleTuner to users interacting with it over a network — worth a lawyer's read before building it into a paid Runpod-hosted product.

### Gaps
- OneTrainer's exact current license was not independently re-verified in this research pass (commonly reported elsewhere as AGPL-3.0); mark as unverified.

## Model support: Wan 2.2 14B, Wan 2.2 TI2V-5B, Z-Image-Turbo, Qwen-Image, Chroma

### Takeaway
diffusion-pipe and ai-toolkit appear to be the only two tools confirmed (from primary docs) to support the full requested set (Wan 2.2 14B, Wan 2.2 TI2V-5B, Z-Image-Turbo, Qwen-Image, Chroma). musubi-tuner supports Wan 2.1/2.2 14B, Qwen-Image, and Z-Image, but its TI2V-5B and Chroma support could not be confirmed from primary sources in this pass. SimpleTuner supports Wan Video (1.3B–14B), Z-Image, Qwen-Image, and Chroma, but explicit TI2V-5B support was not confirmed. OneTrainer does **not** currently support Wan 2.x LoRA training at all — this was explicitly requested by users and the maintainer indicated other priorities.

### Cited Findings
- ai-toolkit supports Wan 2.2 T2V 14B, Wan 2.2 I2V 14B, and Wan 2.2 TI2V 5B as "Supported Video Models," plus Z-Image-Turbo, Qwen-Image (multiple versions), and Chroma as "Selected Image Models" — [GitHub: ostris/ai-toolkit](https://github.com/ostris/ai-toolkit); a published example training config exists for Wan 2.2 14B at 24GB — [train_lora_wan22_14b_24gb.yaml](https://huggingface.co/spaces/sub314xxl/ai-toolkit/blob/main/config/examples/train_lora_wan22_14b_24gb.yaml)
- musubi-tuner "provides scripts for training LoRA (Low-Rank Adaptation) models with HunyuanVideo, Wan2.1/2.2, FramePack, FLUX.1 Kontext, FLUX.2 dev/klein, Qwen-Image, Z-Image, and MiniMax-H3 architectures" — [GitHub: kohya-ss/musubi-tuner](https://github.com/kohya-ss/musubi-tuner)
- diffusion-pipe's supported_models.md confirms all five requested models: Wan 2.2 14B (T2V/I2V), Wan 2.2 5B (T2V only), Z-Image-Turbo, Qwen-Image, and Chroma — [diffusion-pipe supported_models.md](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md)
- SimpleTuner supports "Wan Video (1.3B-14B), Z-Image (6B), Qwen Image (20B), and Chroma 1 (8.9B), among 40+ total model architectures" — [GitHub: bghira/SimpleTuner](https://github.com/bghira/SimpleTuner)
- OneTrainer does not have native Wan 2.x LoRA training support as of this research; a GitHub feature request for Wan LoRA training exists and the maintainer stated other development priorities — [Nerogar/OneTrainer Issue #709](https://github.com/Nerogar/OneTrainer/issues/709), [Nerogar/OneTrainer Discussion #708](https://github.com/Nerogar/OneTrainer/discussions/708)
- Community commentary states: "For Wan 2.2 training specifically, users currently need to use diffusion-pipe... rather than OneTrainer" — [WebSearch synthesis of OneTrainer discussion threads, September 2026]

### Inferences
- diffusion-pipe and ai-toolkit are the two tools whose documentation explicitly and unambiguously lists all five target models (Wan 2.2 14B, Wan 2.2 TI2V-5B, Z-Image-Turbo, Qwen-Image, Chroma), making them the strongest candidates on model coverage alone.
- OneTrainer should be excluded from the shortlist for this project given no Wan 2.x support and no clear roadmap commitment.

### Gaps
- musubi-tuner's Wan 2.2 TI2V-5B and Chroma support specifically (as opposed to Wan 2.1/2.2 14B generally) could not be confirmed from a primary source; the kohya-ss docs/wan.md page should be checked directly for TI2V-5B config examples, and Chroma appears to be supported per third-party (SECourses/Patreon) commentary referencing "Chroma/Distilled" profiles, but this is not a primary-source confirmation — [SECourses Musubi Tuner Patreon post](https://www.patreon.com/SECourses/posts/secourses-musubi-137551634) (secondary source, unverified against kohya-ss docs directly).
- SimpleTuner's explicit Wan 2.2 TI2V-5B (as distinct from the general 1.3B-14B Wan range) support was not confirmed from a primary source.

## VRAM requirements and RTX 4090 training time for a ~20-image character LoRA

### Takeaway
All four shortlisted tools claim to fit Wan 2.2 14B and Z-Image-Turbo LoRA training within 24GB via quantization (fp8/int8/4-bit), block-swapping, or layer offloading, but concrete, sourced wall-clock benchmarks specifically for a 20-image character LoRA on a stock RTX 4090 are scarce; most numbers found are broad ranges from secondary blog/tutorial sources rather than primary GitHub benchmarks, and should be treated as estimates.

### Cited Findings
- ai-toolkit: "configurable 8-bit, 6-bit, and 4-bit (and 3-bit with recovery adapters) transformer quantization plus layer offloading, so large models like Wan can be trained on 24-48 GB GPUs"; for Wan 2.2 specifically, "local training on a 24GB+ NVIDIA GPU is possible with 4-bit ARA quantization"; for Wan 2.2 MOE (dual expert) training, config must "switch training between stages every 10 steps and either unload the text encoder or cache text embeddings (required for 24GB cards)" — [RunComfy: Wan 2.2 T2V 14B LoRA Training with AI Toolkit](https://www.runcomfy.com/trainer/ai-toolkit/wan-2-2-t2v-14b-lora-training)
- ai-toolkit general dataset/time guidance: "Training a LoRA requires around 20-50 high-quality reference images and typically takes a few hours on a single GPU" (general claim, not Wan/Z-Image-specific, not tied to a benchmark) — [RunComfy: Ostris AI Toolkit LoRA Training](https://www.runcomfy.com/trainer/ai-toolkit/getting-started)
- musubi-tuner: "12 GB+ for image training and 24 GB+ for video training" is the general guidance; a field report claims I2V LoRA training on 16GB is feasible with optimizations, "while AI Toolkit demos target 24GB (RTX 4090) for comfort and speed" — [GitHub: kohya-ss/musubi-tuner](https://github.com/kohya-ss/musubi-tuner); one user with an RTX 4090 24GB reported "not needing to use any block swap and experiencing at least 30% faster training per model" (unverified/anecdotal, forum-sourced) — [kohya-ss/musubi-tuner Discussion #455](https://github.com/kohya-ss/musubi-tuner/discussions/455)
- diffusion-pipe: Z-Image-Turbo training "is possible with reduced VRAM by having most weights in fp8 (small quality loss)"; Qwen-Image "requires block swapping for single 24GB GPU training," with the example config recommending "expandable segments CUDA feature" and 640-resolution datasets on limited VRAM; Wan 2.2 example training configs "work with a 3090 and 32GB of RAM," with training "typically 10-20 hours" (this figure appears to be for a general/larger-dataset run, not confirmed as a 20-image character LoRA specifically) — [diffusion-pipe supported_models.md](https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md), [GitHub: tdrussell/diffusion-pipe](https://github.com/tdrussell/diffusion-pipe)
- SimpleTuner: "Most models trainable on 24G GPU, many on 16G with optimizations"; for Qwen-Image specifically, "24GB GPU as the absolute minimum and 40GB+ strongly recommended" due to its 20B parameter size — [GitHub: bghira/SimpleTuner](https://github.com/bghira/SimpleTuner)
- General (not tool-specific) secondary-source claim: "Wan 2.2 LoRA training creates ultra-realistic custom characters from 10-20 personal photos in under 10 minutes on consumer GPUs like the RTX 4090" contradicted by another secondary source stating "Standard character or style LoRAs with 200-400 samples result in WAN 2.2 training time of 4-10 hours on RTX 4090 at 512x512 resolution with 12-15 epochs" and a recommendation of "2000-3000 steps" for a 20-50 image character/style LoRA — [Apatero: How Long It Takes to Train a WAN 2.2 Video LoRA](https://www.apatero.com/blog/wan-22-video-lora-training-time-complete-analysis-2025); these two secondary sources conflict by roughly an order of magnitude and neither is a primary benchmark from the tool authors, so treat both as **unverified/estimated**.

### Inferences
- Wan 2.2 14B specifically requires training against both the "high-noise" and "low-noise" expert models (Wan 2.2's MoE-style architecture), which roughly doubles compute per step versus a single-expert model like Wan 2.1 or Z-Image-Turbo — this is consistent across ai-toolkit's "switch every N steps" guidance and diffusion-pipe's separate high/low checkpoint config, and is the primary reason 24GB is described as the practical floor rather than comfortable headroom for Wan 2.2 14B.
- For a 20-image character LoRA specifically (a small, fast dataset), true wall-clock time under any of these tools on an RTX 4090 is most plausibly in the 1-4 hour range for Wan 2.2 14B and well under 1-2 hours for Z-Image-Turbo, Qwen-Image, or Chroma — but this is **this researcher's estimate**, synthesized from the step-count/resolution guidance above, not a directly sourced benchmark number for a 20-image run.

### Gaps
- No primary-source (tool-author or reproducible benchmark) number was found for "20-image character LoRA wall-clock time on RTX 4090" for any of the four tools. All specific hour figures found are either for larger datasets (200-400 images), general/unspecified dataset sizes, or come from third-party blogs/forums without methodology disclosed. This is a genuine gap the report should flag prominently — end users of a self-hosted app will care a great deal about this number and it needs empirical validation (a test run) rather than being sourced from public claims.
- No sourced VRAM-vs-time tradeoff curve (e.g., fp8 vs bf16, block-swap on/off) specific to a 20-image dataset was found for any tool.

## HTTP API / web UI / headless programmatic operation (for a backend job queue, no UI clicking)

### Takeaway
All four tools can be driven headlessly from the CLI with a config file, which is the necessary property for a Runpod-hosted backend job queue. ai-toolkit and SimpleTuner additionally ship an optional web UI, but neither was confirmed to expose a formal, documented HTTP REST API for job submission — in both cases the "API" capability is de facto (start/stop/monitor via the UI's backend, or via config-file + CLI invocation from your own wrapper), not a stable documented interface. musubi-tuner and diffusion-pipe are CLI/config-file-only, no UI, which is arguably actually simpler to wrap in a backend job queue since there's no UI-coupled state to route around.

### Cited Findings
- ai-toolkit ships a web UI ("The UI does not need to be kept running for the jobs to run. It is only needed to start/stop/monitor jobs," accessible at `http://localhost:8675`) and also supports pure headless CLI invocation: `python run.py config/whatever_you_want.yml` — [GitHub: ostris/ai-toolkit](https://github.com/ostris/ai-toolkit)
- No documented/dedicated HTTP REST API was found for ai-toolkit in the fetched README content — [GitHub: ostris/ai-toolkit](https://github.com/ostris/ai-toolkit)
- A third-party guide confirms ai-toolkit's UI can be set up and run on Runpod, implying it is commonly deployed there, but this describes UI usage on a rented pod, not a documented API — [Weird Wonderful AI Art: Setup and Run Ostris AI-Toolkit UI on Runpod](https://weirdwonderfulai.art/resources/setup-and-run-ostris-ai-toolkit-ui-on-runpod/)
- musubi-tuner: training and inference are described as command-line "scripts"; no web UI or HTTP API is indicated in the README — [GitHub: kohya-ss/musubi-tuner](https://github.com/kohya-ss/musubi-tuner)
- diffusion-pipe: "this is a command-line training tool without web interface or API endpoints... CLI and configuration file-based. Users launch training via command-line with DeepSpeed, passing TOML configuration files as parameters" — [GitHub: tdrussell/diffusion-pipe](https://github.com/tdrussell/diffusion-pipe)
- SimpleTuner: includes a "User-friendly web UI" for managing the training lifecycle, and separately supports headless CLI operation via `st_cli.py`; "HTTP API support implied through enterprise features like job queuing and worker orchestration, though a dedicated REST API isn't explicitly documented" — [GitHub: bghira/SimpleTuner](https://github.com/bghira/SimpleTuner)

### Inferences
- For the described use case (a self-hosted filmmaking web app where the *app's own backend*, not a human, triggers training jobs on Runpod), all four tools are workable because each supports pure CLI + config-file invocation — the app can template a YAML/TOML config per user job and shell out to the training script inside a Runpod pod/serverless worker, using Runpod's own API (not the training tool's) to manage the compute lifecycle. None of the four tools needs to be "driven through a UI" to function headlessly.
- musubi-tuner and diffusion-pipe, being UI-less by design, likely integrate more predictably into a job-queue wrapper (fewer moving parts, no UI process to manage/kill), whereas ai-toolkit's and SimpleTuner's UIs are optional conveniences that a backend integration would bypass entirely in favor of their CLI paths.

### Gaps
- Neither ai-toolkit nor SimpleTuner was confirmed to have a stable, documented, versioned REST API contract (endpoints, auth, schemas) suitable for a production integration — if the app wants a "real" API rather than shelling out to a CLI, this would likely need to be custom-built around each tool's CLI/config surface, and that gap should be flagged to the team building the integration.

## Auto-captioning integration (JoyCaption, Florence-2, Qwen-VL, or similar)

### Takeaway
musubi-tuner ships a built-in Qwen-VL captioning script; ai-toolkit has a documented "Captioner System" currently supporting Janus Pro and Florence-2 (with JoyCaption and other models reportedly planned but not yet integrated as of this research), plus a newer Ideogram-4-based auto-captioner using Qwen-3-VL 8B under the hood. SimpleTuner integrates its own "CaptionFlow" local captioning tool but wasn't confirmed to use JoyCaption/Florence-2/Qwen-VL by name. diffusion-pipe has no built-in auto-captioning; users are expected to supply caption files, generated externally (e.g., via a separate ComfyUI captioning workflow).

### Cited Findings
- musubi-tuner ships a dedicated script `caption_images_by_qwen_vl.py` for Qwen-VL-based auto-captioning — [GitHub: kohya-ss/musubi-tuner](https://github.com/kohya-ss/musubi-tuner)
- ai-toolkit's "Captioner System" currently supports Janus Pro and Florence2, "with plans for future updates to include additional models" such as JoyCaption — [DeepWiki: Captioner System | ostris/ai-toolkit](https://deepwiki.com/ostris/ai-toolkit/20-captioner-system)
- ai-toolkit's author (Ostris) posted on X that an "Ideogram 4 auto captioner" was added to AI Toolkit, tested with "Qwen-3-VL 8B," which "automatically does the boxes and the json for you," with a toggle to view boxes in the dataset viewer — [Ostris on X](https://x.com/ostrisai/status/2062612832152396085) (primary source is a social-media post from the tool's author, treated as reasonably authoritative but not repo documentation)
- SimpleTuner integrates "CaptionFlow" for local GPU caption generation via its Web UI; no direct mention of JoyCaption, Florence-2, or Qwen-VL by name found in the fetched README — [GitHub: bghira/SimpleTuner](https://github.com/bghira/SimpleTuner)
- diffusion-pipe's documentation discusses caption files that must accompany media files but references no built-in captioning tool — [GitHub: tdrussell/diffusion-pipe](https://github.com/tdrussell/diffusion-pipe); community tooling (e.g., ComfyUI-CaptionThis, supporting Janus Pro, Florence2, and "JoyCaption (coming soon)") exists as an external captioning step that could feed diffusion-pipe's expected caption-file format — [GitHub: MieMieeeee/ComfyUI-CaptionThis](https://github.com/MieMieeeee/ComfyUI-CaptionThis) (third-party tool, not part of diffusion-pipe itself)

### Inferences
- For a self-hosted app where end users won't run any captioning step themselves, musubi-tuner (built-in Qwen-VL script) and ai-toolkit (built-in Florence-2/Janus Pro, plus a newer Qwen-3-VL-backed auto-captioner) are the most "batteries-included" options. diffusion-pipe would require the app to run a separate captioning step (e.g., its own Qwen-VL or Florence-2 call) before invoking diffusion-pipe, adding integration work.

### Gaps
- Whether ai-toolkit's Florence-2/Janus Pro captioner or its newer Ideogram-4/Qwen-3-VL captioner can be invoked fully headlessly (outside the dataset-viewer UI) was not confirmed from primary documentation — this matters for a no-UI backend integration and should be verified against the ai-toolkit source/DeepWiki captioner-system page directly before committing to it as the captioning path.
- SimpleTuner's "CaptionFlow" internals (which underlying VLM it uses) were not confirmed.

## Activity / maintenance signal (as of ~September 2026)

### Takeaway
All four shortlisted tools show active, ongoing maintenance as of September 2026, with ai-toolkit by far the largest by community size (stars/forks), SimpleTuner showing the highest raw commit velocity, and musubi-tuner and diffusion-pipe both showing steady, real activity with large open-issue counts that suggest heavy community usage relative to maintainer bandwidth.

### Cited Findings
- ai-toolkit: 12.1k stars, 98 watchers, 1.5k forks, 1,574 total commits, 65 open issues, 38 open pull requests — [GitHub: ostris/ai-toolkit](https://github.com/ostris/ai-toolkit)
- musubi-tuner: 2.1k stars, 307 forks, 322 open issues, 1,268 commits on main branch, last documented update September 16, 2026 — [GitHub: kohya-ss/musubi-tuner](https://github.com/kohya-ss/musubi-tuner)
- diffusion-pipe: ~2,000 stars, 285 forks, 465 commits, 265 open issues, 8 open pull requests; recent feature additions include MiniMax H3, Krea 2, Ideogram4, and Flux 2 support, with the most recent documented update dated 2026-08-08 — [GitHub: tdrussell/diffusion-pipe](https://github.com/tdrussell/diffusion-pipe)
- SimpleTuner: 2.9k stars, 294 forks, 10,710 commits — [GitHub: bghira/SimpleTuner](https://github.com/bghira/SimpleTuner)
- OneTrainer: shows recent discussion/issue activity around feature requests, but the maintainer explicitly deprioritized Wan LoRA support, indicating the project's active-maintenance signal does not currently extend to the model family this project needs — [Nerogar/OneTrainer Discussion #708](https://github.com/Nerogar/OneTrainer/discussions/708), [Nerogar/OneTrainer Issue #709](https://github.com/Nerogar/OneTrainer/issues/709)

### Inferences
- musubi-tuner's very high open-issue count (322) relative to its star count suggests a large, active power-user community filing detailed bug reports/config questions (consistent with the many Wan 2.2-specific GitHub Discussions found during this research, e.g. #455, #621, #622), which is a reasonable proxy for both popularity and real-world edge-case coverage for Wan 2.2 specifically.
- diffusion-pipe's lower star/fork count relative to ai-toolkit but comparable open-issue-to-star ratio, plus recent (2026) additions of brand-new model families (MiniMax H3, Krea 2, Flux 2), indicates it remains a maintained, if more niche/power-user-oriented, tool rather than an abandoned project.

### Gaps
- Exact "last commit date" (as opposed to "last major feature" date) was not independently confirmed for ai-toolkit or SimpleTuner in this pass — only diffusion-pipe (2026-08-08) and musubi-tuner (September 16, 2026) had explicit last-update dates surfaced. Recommend a direct visit to each repo's commits page to confirm freshness within the last 30 days before final tool selection.

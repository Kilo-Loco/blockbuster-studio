# Research summary (2026-09-24)

This file records why the stack looks the way it does. The two long-form reports in this folder
(`Self hosted AI studio stack.md`, `LoRA training and consistency stack.md`) have the citations.

## Models

| Role | Pick | License | Why |
|---|---|---|---|
| Video | **Wan 2.2 I2V A14B** (fp8_scaled, high + low noise experts) + lightx2v 4-step LoRAs | Apache-2.0 | Newest open-weight Wan. Wan 2.5 / 2.6 / 2.7 / 3.0 are API-only. Still the quality leader for open video on one 24 GB GPU. Not safety-filtered at the weight level. |
| Video (optional) | Wan 2.2 T2V A14B fp8 + lightx2v | Apache-2.0 | Off by default to save ~31 GB. "Text → video" in the UI runs Z-Image → I2V instead. |
| Image | **Z-Image-Turbo** (bf16, 8 steps) | Apache-2.0 | About 2–3 s per image on a 4090, strong realism, permissive about content, native ComfyUI support, LoRA-trainable with ai-toolkit. |
| Edit / consistency | **Qwen-Image-Edit-2511** fp8mixed + Lightning 4-step LoRA | Apache-2.0 | Multi-image reference editing (character + location compositing). |
| Camera angles | **fal Qwen-Image-Edit-2511 Multiple-Angles LoRA** | Apache-2.0 | 96 camera poses (8 azimuths × 4 elevations × 3 distances). This is what turns a camera placed on the location map into a real view of the same set. |

Rejected: FLUX.1/.2 [dev] and Krea-dev (non-commercial), Qwen-Image-2.1 (research license),
HunyuanVideo 1.5 / HunyuanImage (Tencent community license with region and MAU limits),
LTX-2 (paid license required above $10M in annual revenue; a good future add-on for audio),
InfiniteYou (CC BY-NC weights), MAGREF (~70 GB VRAM).

## Apps / frontends evaluated (hands-on code review)

| Project | License | Fork fitness | Verdict |
|---|---|---|---|
| ComfyUI | GPL-3.0 | engine | **Used as the unmodified headless engine.** GPL is not triggered by network use. |
| Wan2GP | custom | – | License explicitly forbids paid hosted/SaaS use. |
| ViewComfy | AGPL-3.0 | – | Network copyleft. |
| wide-trace/open-higgsfield | none | – | No license means all rights reserved. |
| Open-Generative-AI (29k★) | MIT | 2/10 | UI shell hard-wired to the MuAPI paid gateway. No data model, no storyboard. |
| Toonflow | MIT | 4/10 | Vue + Bun. Chinese-only agent prompts, no structured storyboard model, 4-day single-author history. Borrowed the idea of a 3D camera/mannequin blocking node. |
| ViMax (HKUDS) | MIT | 3/10 | Python agent pipeline with a chat-log web UI. Borrowed its shot-description design (first-frame / motion descriptions, camera continuity). |
| VideoClaw (ex-FilmAgent) | MIT | 4/10 | Cloud-API-only. Borrowed its script → character/location → storyboard → shots pipeline shape. |
| BeatDesign | Apache-2.0 | 4/10 | Well engineered but single-user canvas/timeline, one month old, no film concepts. |
| SwarmUI / InvokeAI / SD.Next | MIT / Apache | fallback | Power-user UIs. InvokeAI's Wan support is a prototype. |
| CozyClay (browser previs) | AGPL-3.0 | reference only | Closest match to top-down camera blocking; license blocks forking. |
| Blockout | Apache-2.0 | reference | Camera marks and real lens optics. |
| FLOOR shot designer | Elastic-2.0 | reference only | Top-down set + camera icon UX. |
| ComfyUI-qwenmultiangle | MIT | reference | three.js camera drag → multi-angle LoRA prompt. Same idea as our map → angle mapping. |

Conclusion: no project combines a Higgsfield-grade UI, a self-hosted ComfyUI backend, a storyboard
data model, LoRA assets and a location map under a permissive license. We build a thin app on top of
ComfyUI's stable HTTP/WS API and reuse the proven model workflows (Comfy-Org official templates).

## LoRA training

**ostris/ai-toolkit (MIT)**: headless `python run.py config.yaml`, supports Z-Image Turbo (arch `zimage`
plus the `ostris/zimage_turbo_training_adapter` de-distill adapter), Wan 2.2 14B, Qwen-Image(-Edit).
It is installed lazily on first use into `/workspace` to keep the image small.
ComfyUI core loads Z-Image LoRAs natively (`comfy/lora.py` maps Lumina2/Z-Image keys), so the stock
`LoraLoaderModelOnly` works.

## Runpod

- Deploy link: `https://console.runpod.io/deploy?template=<TEMPLATE_ID>&ref=<REFERRAL>`
  (public template). The template creator earns 1% of what users spend on it.
- Proxy: `https://<podId>-<port>.proxy.runpod.net`. Cloudflare cuts off any request that takes more than
  about 100 s to start responding, so progress goes over SSE with heartbeats and results are polled.
  The proxy has no authentication of its own, so the app requires a password.
- Default GPU: **RTX 4090 24 GB** (~$0.34/hr community, ~$0.74/hr secure). Models download to the
  `/workspace` volume on first boot (hf_xet / hf_transfer), in priority order so image generation is
  usable within minutes.

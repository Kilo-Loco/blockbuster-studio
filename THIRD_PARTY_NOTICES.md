# Third-party notices

Blockbuster Studio's own code is MIT-licensed (see `LICENSE`). It builds on and packages the
following third-party software and model weights, each under its own license.

## Software

| Component | License | Notes |
|---|---|---|
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | GPL-3.0 | Run as a separate, unmodified, headless process (pinned commit `1568e6cfd04586a4b3c4e1817ea7dde09b1bf9e7`), driven over its local HTTP/WebSocket API. We do not link against, fork, or modify its source. |
| [runpod/pytorch](https://hub.docker.com/r/runpod/pytorch) base image | various (PyTorch: BSD-3-Clause, CUDA: NVIDIA EULA) | Base container image. |
| [ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) (numz, pinned commit `4490bd1f482e026674543386bb2a4d176da245b9`, + its diffusers, peft, opencv-python, …) | Apache-2.0 | ComfyUI custom node pack for the opt-in 4K export upscale. Installed unmodified in the image. |
| [huggingface_hub](https://github.com/huggingface/huggingface_hub) | Apache-2.0 | Model downloader. |
| [qwen-tts](https://github.com/QwenLM/Qwen3-TTS) 0.1.1 (+ its transformers 4.57.3, accelerate, librosa, …) | Apache-2.0 | Voice sidecar, in its own venv (`/opt/tts-venv`) so its pinned transformers can't replace ComfyUI's. |
| [ai-toolkit](https://github.com/ostris/ai-toolkit) (ostris, pinned commit `ed36edd85b886623377beb5f50c5dd7e3b3eb89a`) | MIT | LoRA training, installed on the volume the first time someone trains, not bundled in the image. |
| Node.js runtime + npm dependencies (see `app/package.json`) | various OSS licenses (MIT/ISC/Apache-2.0 predominantly) | Studio server + web app dependencies. |

## Model weights (downloaded at runtime, not bundled in the image or this repo)

| Model | License | Source |
|---|---|---|
| Wan 2.2 (I2V A14B, T2V A14B): older video engine, off by default (LTX-2.5 replaces it) | Apache-2.0 | [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) |
| Wan Animate 2 (Perform mode) | Apache-2.0 | [Comfy-Org/Wan-Animate-2](https://huggingface.co/Comfy-Org/Wan-Animate-2) |
| Z-Image Turbo | Apache-2.0 | [Comfy-Org/z_image_turbo](https://huggingface.co/Comfy-Org/z_image_turbo) |
| Qwen-Image-Edit-2511 | Apache-2.0 | [Comfy-Org/Qwen-Image-Edit_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI) |
| Qwen-Image-Edit-2511 Lightning LoRA | Apache-2.0 | [lightx2v/Qwen-Image-Edit-2511-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning) |
| Qwen-Image-Edit-2511 Multiple-Angles LoRA | Apache-2.0 | [fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) |
| Qwen3-TTS 12Hz 1.7B VoiceDesign and Base (character voices, run by `docker/tts/server.py`) | Apache-2.0 | [Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign), [Qwen/Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) |
| Wan 2.2 lightx2v 4-step LoRAs (I2V/T2V) | Apache-2.0 | [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) |
| MiniMax H3 (fl2va int8, Qwen3-VL text encoder, VAEs, 4-step turbo LoRA): **opt-in, off by default** (`DOWNLOAD_MINIMAX_MODELS=true`) | [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE): not Apache/MIT. Excludes the US, EU, UK and South Korea unless licensed by MiniMax; requires "Powered by MiniMax H3" (shown in the studio when active); outputs may not train other models; publicly posted outputs must be disclosed as machine-generated. Whoever deploys a pod with it enabled is responsible for complying. | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| LTX-2.5 (22B distilled int8 transformer, Gemma 4 12B text encoder, video/audio VAEs, x2 latent upscaler), plus its union-control and Ingredients IC-LoRAs: **default video engine, on by default** (`DOWNLOAD_LTX_MODELS`, `DOWNLOAD_LTX_IC_MODELS`, `DOWNLOAD_LTX_INGREDIENTS_MODELS`) | [LTX-2.x Community License](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x): not Apache/MIT. Free for entities under $10M annual revenue (paid license above); use in a product that directly competes with Lightricks' commercial offerings needs a separate license (Attachment A item 20); circumventing its safety features is forbidden (item 19); distributed outputs must be disclosed as machine-generated (item 5); no commercial training of other models on it. Gated on Hugging Face. Whoever deploys a pod with it enabled is responsible for complying. | [Lightricks/LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5) |
| SeedVR2 7B (fp8-mixed diffusion model, fp16 VAE): export-time 4K upscale, **opt-in, off by default** (`DOWNLOAD_UPSCALE_MODELS=true`) | Apache-2.0 | [AInVFX/SeedVR2_comfyUI](https://huggingface.co/AInVFX/SeedVR2_comfyUI), [numz/SeedVR2_comfyUI](https://huggingface.co/numz/SeedVR2_comfyUI) (original: [ByteDance-Seed/SeedVR2-7B](https://huggingface.co/ByteDance-Seed/SeedVR2-7B)) |

The exact file list, repos, and destinations are in `config/models.json`, the single source of
truth used by both the Node server and `docker/download_models.py`.

## Content policy note

None of the above models are safety-filtered at the weight level beyond what their publishers
ship, and Blockbuster Studio adds no content filtering of its own. Users are responsible for what
they generate and for following each model's license.

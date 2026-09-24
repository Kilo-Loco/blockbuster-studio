# Third-party notices

Blockbuster Studio's own code is MIT-licensed (see `LICENSE`). It builds on and packages the
following third-party software and model weights, each under its own license.

## Software

| Component | License | Notes |
|---|---|---|
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | GPL-3.0 | Run as a separate, unmodified, headless process (pinned commit `1568e6cfd04586a4b3c4e1817ea7dde09b1bf9e7`), driven over its local HTTP/WebSocket API. We do not link against, fork, or modify its source. |
| [runpod/pytorch](https://hub.docker.com/r/runpod/pytorch) base image | various (PyTorch: BSD-3-Clause, CUDA: NVIDIA EULA) | Base container image. |
| [huggingface_hub](https://github.com/huggingface/huggingface_hub) | Apache-2.0 | Model downloader. |
| [ai-toolkit](https://github.com/ostris/ai-toolkit) (ostris) | MIT | LoRA training, installed lazily at first use, not bundled in the image. |
| Node.js runtime + npm dependencies (see `app/package.json`) | various OSS licenses (MIT/ISC/Apache-2.0 predominantly) | Studio server + web app dependencies. |

## Model weights (downloaded at runtime, not bundled in the image or this repo)

| Model | License | Source |
|---|---|---|
| Wan 2.2 (I2V A14B, T2V A14B) | Apache-2.0 | [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) |
| Z-Image Turbo | Apache-2.0 | [Comfy-Org/z_image_turbo](https://huggingface.co/Comfy-Org/z_image_turbo) |
| Qwen-Image-Edit-2511 | Apache-2.0 | [Comfy-Org/Qwen-Image-Edit_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI) |
| Qwen-Image-Edit-2511 Lightning LoRA | Apache-2.0 | [lightx2v/Qwen-Image-Edit-2511-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning) |
| Qwen-Image-Edit-2511 Multiple-Angles LoRA | Apache-2.0 | [fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) |
| Wan 2.2 lightx2v 4-step LoRAs (I2V/T2V) | Apache-2.0 | [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) |

The exact file list, repos, and destinations are in `config/models.json`, the single source of
truth used by both the Node server and `docker/download_models.py`.

## Content policy note

None of the above models are safety-filtered at the weight level beyond what their publishers
ship. Blockbuster Studio adds exactly one non-optional server-side block (sexual content involving
minors); see `docs/ARCHITECTURE.md` → "Content policy".

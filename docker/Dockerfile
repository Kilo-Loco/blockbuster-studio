# syntax=docker/dockerfile:1.7
#
# Blockbuster Studio image.
#
# Stage "app"      -> builds the Node/TypeScript studio server + web SPA.
# Stage runtime     -> CUDA 12.8 PyTorch base (RTX 4090 + 5090/Blackwell), ComfyUI headless,
#                       Node runtime, and the built studio app, wired together by /opt/start.sh.
#
# Base image: runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404 (CUDA 12.8.1, torch 2.8.0, Ubuntu 24.04).
#   Chosen because it is the image Runpod's own API docs use as the example pod image, so it is very
#   likely already cached on Runpod hosts. The first real test (2026-09-24) used a brand-new tag and
#   spent ~9 minutes pulling at ~10 MB/s; a cached base cuts that to our own layers only.

# ---------------------------------------------------------------------------
# Stage: app  (build the Node app; native deps compiled here are linux/amd64 + this Node major)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS app
WORKDIR /src/app

# better-sqlite3 has no prebuilt binary for this platform/Node combo and falls back to node-gyp,
# which needs python3 + a C/C++ toolchain. Installed only in this stage (discarded after build).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install deps first for layer caching.
COPY app/package.json app/package-lock.json ./
RUN npm ci

# Copy the rest of the app source + the shared model manifest, then build.
COPY app/ ./
COPY config/ ../config/
RUN npm run build

# Prune devDependencies out of node_modules; better-sqlite3's compiled binding stays
# (it's a regular dependency), built against this same Node 22 / linux-x64 ABI.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage: runtime
# ---------------------------------------------------------------------------
FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404 AS runtime

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive

# --- System packages: ffmpeg (posters/export), git (ComfyUI clone), curl, tini (PID 1), sshd (optional) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg git curl ca-certificates tini openssh-server \
      && rm -rf /var/lib/apt/lists/*

# --- Node 22 runtime (same major used to build the app, for the native better-sqlite3 binding) ---
# Copy the Node binary + npm from the official node:22-bookworm-slim image instead of adding
# NodeSource's apt repo (fewer moving parts, and this base is already Debian/Ubuntu-glibc compatible).
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node --version && npm --version

# --- ComfyUI, pinned commit, core nodes only (no custom nodes required) ---
ARG COMFYUI_COMMIT=1568e6cfd04586a4b3c4e1817ea7dde09b1bf9e7
RUN git clone https://github.com/Comfy-Org/ComfyUI.git /opt/ComfyUI \
    && cd /opt/ComfyUI \
    && git checkout ${COMFYUI_COMMIT}

# Install ComfyUI's Python requirements WITHOUT letting pip downgrade/replace the base image's
# torch/torchvision/torchaudio (already CUDA 12.8-matched for the host driver). We pin the base
# image's installed versions in a constraints file and additionally strip any torch* line from
# ComfyUI's requirements.txt before installing, belt-and-suspenders.
RUN python3 -c "import torch, torchvision, torchaudio; print(torch.__version__); print(torchvision.__version__); print(torchaudio.__version__)" \
      > /tmp/installed-torch-versions.txt \
    && python3 - <<'PY'
import re
versions = [l.strip() for l in open('/tmp/installed-torch-versions.txt') if l.strip()]
names = ['torch', 'torchvision', 'torchaudio']
with open('/opt/torch-constraints.txt', 'w') as f:
    for name, ver in zip(names, versions):
        f.write(f"{name}=={ver}\n")
PY
RUN grep -viE '^(torch|torchvision|torchaudio)\b' /opt/ComfyUI/requirements.txt > /opt/ComfyUI/requirements.filtered.txt \
    && pip install --no-cache-dir -c /opt/torch-constraints.txt -r /opt/ComfyUI/requirements.filtered.txt \
    && pip install --no-cache-dir "huggingface_hub[hf_xet]" hf_transfer

# --- Studio app (built in the "app" stage) ---
RUN mkdir -p /opt/studio
COPY --from=app /src/app/dist /opt/studio/dist
COPY --from=app /src/app/node_modules /opt/studio/node_modules
COPY --from=app /src/app/package.json /opt/studio/package.json
COPY config/models.json /opt/studio/config/models.json

# --- Runtime support files ---
COPY docker/extra_model_paths.yaml /opt/ComfyUI/extra_model_paths.yaml.template
COPY docker/download_models.py /opt/download_models.py
COPY docker/start.sh /opt/start.sh
RUN chmod +x /opt/start.sh /opt/download_models.py

ENV DATA_DIR=/workspace/studio \
    MODELS_DIR=/workspace/models \
    COMFY_URL=http://127.0.0.1:8188 \
    WEB_DIST=/opt/studio/dist/web \
    MODELS_MANIFEST=/opt/studio/config/models.json \
    PORT=3000 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    HF_XET_HIGH_PERFORMANCE=1 \
    HF_XET_CHUNK_CACHE_SIZE_BYTES=0 \
    HF_HOME=/workspace/models/.cache/hf \
    PYTHONUNBUFFERED=1

EXPOSE 3000
EXPOSE 22

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/start.sh"]

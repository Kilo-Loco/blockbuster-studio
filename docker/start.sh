#!/usr/bin/env bash
# Entrypoint for the Blockbuster Studio container.
# Careful with `set -e`: a non-critical failure (e.g. one model group failing to download)
# must not take the whole pod down. Only the setup section below is allowed to be fatal.
set -u -o pipefail

STUDIO_ROOT="/workspace/studio"
MODELS_ROOT="${MODELS_DIR:-/workspace/models}"
COMFY_DIR="/opt/ComfyUI"

mkdir -p \
  "$STUDIO_ROOT" \
  "$STUDIO_ROOT/logs" \
  "$STUDIO_ROOT/media" \
  "$STUDIO_ROOT/comfy/input" \
  "$STUDIO_ROOT/comfy/output" \
  "$STUDIO_ROOT/comfy/temp" \
  "$STUDIO_ROOT/comfy/user" \
  "$MODELS_ROOT"

# Render extra_model_paths.yaml with the real MODELS_DIR.
sed "s#__MODELS_DIR__#${MODELS_ROOT}#" /opt/ComfyUI/extra_model_paths.yaml.template > "$STUDIO_ROOT/extra_model_paths.yaml"

log() {
  echo "[start.sh] $*"
}

# --- Host driver check: the image is built on CUDA 12.8, so the host driver must support ≥ 12.8 ---
if command -v nvidia-smi >/dev/null 2>&1; then
  HOST_CUDA="$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: *\([0-9.]*\).*/\1/p' | head -1)"
  log "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1) · host CUDA ${HOST_CUDA:-unknown}"
  if [ -n "$HOST_CUDA" ] && [ "$(printf '%s\n12.8\n' "$HOST_CUDA" | sort -V | head -1)" != "12.8" ]; then
    log "WARNING: this host's NVIDIA driver supports CUDA $HOST_CUDA, but Blockbuster Studio needs CUDA 12.8 or newer."
    log "WARNING: generation will fail on this machine. Redeploy and pick a GPU with CUDA 12.8+ in the Runpod filter."
  fi
else
  log "WARNING: nvidia-smi not found; no GPU visible to the container."
fi

# --- Optional sshd for power users (Runpod convention: PUBLIC_KEY env var) ---
if [ -n "${PUBLIC_KEY:-}" ]; then
  log "PUBLIC_KEY set: configuring sshd"
  mkdir -p /var/run/sshd /root/.ssh
  chmod 700 /root/.ssh
  echo "$PUBLIC_KEY" > /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  ssh-keygen -A >/tmp/sshd-keygen.log 2>&1 || true
  /usr/sbin/sshd -D -e >>"$STUDIO_ROOT/logs/sshd.log" 2>&1 &
  SSHD_PID=$!
  log "sshd started (pid $SSHD_PID)"
else
  SSHD_PID=""
fi

# --- Model downloader (background, non-fatal) ---
MODEL_GROUPS="${MODEL_GROUPS:-}"
log "starting model downloader in background (groups='${MODEL_GROUPS:-<defaults>}')"
(
  python3 /opt/download_models.py 2>&1 | while IFS= read -r line; do
    echo "[downloader] $line"
  done
) >>"$STUDIO_ROOT/logs/downloader.log" 2>&1 &
DOWNLOADER_PID=$!

start_comfy() {
  log "starting ComfyUI"
  python3 "$COMFY_DIR/main.py" \
    --listen 127.0.0.1 \
    --port 8188 \
    --extra-model-paths-config "$STUDIO_ROOT/extra_model_paths.yaml" \
    --input-directory "$STUDIO_ROOT/comfy/input" \
    --output-directory "$STUDIO_ROOT/comfy/output" \
    --temp-directory "$STUDIO_ROOT/comfy/temp" \
    --user-directory "$STUDIO_ROOT/comfy/user" \
    --preview-method none \
    --disable-auto-launch \
    ${COMFY_ARGS:-} \
    >>"$STUDIO_ROOT/logs/comfyui.log" 2>&1 &
  COMFY_PID=$!
}

start_server() {
  log "starting studio server"
  COMFY_INPUT_DIR="$STUDIO_ROOT/comfy/input" \
  COMFY_OUTPUT_DIR="$STUDIO_ROOT/comfy/output" \
  node /opt/studio/dist/server.js \
    >>"$STUDIO_ROOT/logs/server.log" 2>&1 &
  SERVER_PID=$!
}

start_comfy
start_server

# --- Banner ---
PROXY_URL="http://localhost:${PORT:-3000}"
if [ -n "${RUNPOD_POD_ID:-}" ]; then
  PROXY_URL="https://${RUNPOD_POD_ID}-${PORT:-3000}.proxy.runpod.net"
fi
sleep 2
{
  echo "============================================================"
  echo " Blockbuster Studio"
  echo "   URL:      $PROXY_URL"
  if [ -n "${STUDIO_PASSWORD:-}" ]; then
    echo "   Password: set via STUDIO_PASSWORD env var"
  else
    echo "   Password: see $STUDIO_ROOT/PASSWORD.txt (generated on first start by the server)"
  fi
  echo "   Models are downloading in the background; image gen is usable within minutes,"
  echo "   full readiness (image+video+edit) takes ~10-20 min on a fast connection."
  echo "   Logs: $STUDIO_ROOT/logs/{comfyui,server,downloader}.log"
  echo "============================================================"
} | tee -a "$STUDIO_ROOT/logs/banner.log"

# --- Supervisor loop: restart comfy/server if they die, with backoff; forward SIGTERM ---
term_handler() {
  log "SIGTERM received, forwarding to children"
  kill -TERM "$COMFY_PID" "$SERVER_PID" "$DOWNLOADER_PID" ${SSHD_PID:+$SSHD_PID} 2>/dev/null || true
  wait
  exit 0
}
trap term_handler SIGTERM SIGINT

COMFY_BACKOFF=1
SERVER_BACKOFF=1

while true; do
  if ! kill -0 "$COMFY_PID" 2>/dev/null; then
    log "ComfyUI died, restarting in ${COMFY_BACKOFF}s"
    sleep "$COMFY_BACKOFF"
    COMFY_BACKOFF=$(( COMFY_BACKOFF < 30 ? COMFY_BACKOFF * 2 : 30 ))
    start_comfy
  else
    COMFY_BACKOFF=1
  fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    log "studio server died, restarting in ${SERVER_BACKOFF}s"
    sleep "$SERVER_BACKOFF"
    SERVER_BACKOFF=$(( SERVER_BACKOFF < 30 ? SERVER_BACKOFF * 2 : 30 ))
    start_server
  else
    SERVER_BACKOFF=1
  fi

  sleep 5
done

#!/usr/bin/env python3
"""Qwen3-TTS sidecar for Blockbuster Studio: character voices and dialogue lines.

Runs in its own venv (/opt/tts-venv) because qwen-tts pins transformers==4.57.3, and ComfyUI keeps its
own. Listens on 127.0.0.1 only; the studio server is the only client (app/server/tts/client.ts).

Voices follow Qwen3-TTS's "design, then clone" recipe (github.com/QwenLM/Qwen3-TTS README):
  - POST /design  VoiceDesign model renders a reference clip from a description (`instruct`).
  - POST /clone   Base model renders any line in the voice of a reference clip (+ its transcript when
                  known; without one it uses the speaker embedding only, which is less faithful).
  - POST /unload  frees the GPU before ComfyUI needs it (the studio's queue calls it on a family switch).
  - GET  /health  which model files are present and which models are loaded.

Every request answers JSON. Audio is written as 24 kHz mono WAV to OUT_DIR and returned as a path,
since the studio server shares the filesystem. One generation runs at a time (the studio queue runs
one job at a time anyway).

Env: MODELS_DIR (default /workspace/models; models live in MODELS_DIR/tts/<repo name>),
     TTS_PORT (8190), TTS_OUT_DIR (DATA_DIR/tts-out).
"""

from __future__ import annotations

import gc
import json
import os
import threading
import time
import traceback
import uuid
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/workspace/models")) / "tts"
OUT_DIR = Path(os.environ.get("TTS_OUT_DIR", str(Path(os.environ.get("DATA_DIR", "/workspace/studio")) / "tts-out")))
PORT = int(os.environ.get("TTS_PORT", "8190"))

DESIGN = "Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE = "Qwen3-TTS-12Hz-1.7B-Base"
PROMPT_CACHE_SIZE = 32

_gpu = threading.Lock()
_models: dict[str, object] = {}
# Clone prompts keyed by (reference file, its mtime, transcript): reusing a voice skips feature extraction.
_prompts: "OrderedDict[tuple, object]" = OrderedDict()


def _model(name: str):
    if name not in _models:
        path = MODELS_DIR / name
        if not path.is_dir():
            raise FileNotFoundError(f"{name} is not downloaded yet ({path})")
        import torch
        from qwen_tts import Qwen3TTSModel

        t0 = time.time()
        try:
            _models[name] = Qwen3TTSModel.from_pretrained(str(path), device_map="cuda:0", dtype=torch.bfloat16)
        except Exception:
            _unload()  # don't keep a half-loaded model's memory
            raise
        print(f"[tts] loaded {name} in {time.time() - t0:.1f}s", flush=True)
    return _models[name]


def _unload() -> None:
    _models.clear()
    _prompts.clear()
    gc.collect()
    try:
        import torch

        torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


def _write(wav, sr: int) -> dict:
    import soundfile as sf

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{uuid.uuid4().hex}.wav"
    sf.write(str(out), wav, sr, subtype="PCM_16")
    return {"file": str(out), "sampleRate": sr, "durationSec": round(len(wav) / sr, 3)}


def _clone_prompt(model, ref_audio: str, ref_text: str | None):
    key = (ref_audio, os.path.getmtime(ref_audio), ref_text or "")
    if key in _prompts:
        _prompts.move_to_end(key)
        return _prompts[key]
    items = model.create_voice_clone_prompt(ref_audio=ref_audio, ref_text=ref_text or None, x_vector_only_mode=not ref_text)
    _prompts[key] = items
    while len(_prompts) > PROMPT_CACHE_SIZE:
        _prompts.popitem(last=False)
    return items


def design(body: dict) -> dict:
    text, instruct = str(body.get("text") or "").strip(), str(body.get("instruct") or "").strip()
    if not text or not instruct:
        raise ValueError("design needs text and instruct")
    wavs, sr = _model(DESIGN).generate_voice_design(text=text, instruct=instruct, language=body.get("language") or "Auto")
    return _write(wavs[0], sr)


def clone(body: dict) -> dict:
    text, ref_audio = str(body.get("text") or "").strip(), str(body.get("refAudio") or "")
    if not text or not ref_audio:
        raise ValueError("clone needs text and refAudio")
    if not os.path.isfile(ref_audio):
        raise FileNotFoundError(f"reference audio not found: {ref_audio}")
    model = _model(BASE)
    prompt = _clone_prompt(model, ref_audio, (body.get("refText") or "").strip() or None)
    wavs, sr = model.generate_voice_clone(text=text, language=body.get("language") or "Auto", voice_clone_prompt=prompt)
    return _write(wavs[0], sr)


def health() -> dict:
    files = {name: (MODELS_DIR / name / "model.safetensors").is_file() for name in (DESIGN, BASE)}
    return {"ok": True, "models": files, "loaded": sorted(_models)}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, health())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        routes = {"/design": design, "/clone": clone, "/unload": lambda _b: (_unload(), {"ok": True})[1]}
        route = routes.get(self.path)
        if not route:
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            t0 = time.time()
            with _gpu:
                result = route(body)
            print(f"[tts] {self.path} {time.time() - t0:.1f}s", flush=True)
            self._send(200, result)
        except (ValueError, FileNotFoundError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt: str, *args) -> None:  # quiet access log; errors are printed above
        pass


if __name__ == "__main__":
    print(f"[tts] listening on 127.0.0.1:{PORT}, models in {MODELS_DIR}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

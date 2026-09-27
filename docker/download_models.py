#!/usr/bin/env python3
"""Download the model files listed in config/models.json into MODELS_DIR.

Env vars:
  MODELS_MANIFEST   path to models.json (default: /opt/studio/config/models.json)
  MODELS_DIR        destination root (default: /workspace/models)
  DATA_DIR          where models-status.json is written (default: /workspace/studio)
  DOWNLOAD_<GROUP>_MODELS  true/false switch per group (see "env" in the manifest), e.g.
                    DOWNLOAD_PERFORM_MODELS=false. Unset → the manifest's default.
  MODEL_GROUPS      advanced override: comma-separated group ids, or "all".
                     Default: every group with "default": true in the manifest.
  HF_TOKEN          Hugging Face token; required for gated repos (LTX-2.5), optional otherwise. A token
                    saved on the studio's Settings page (SQLite kv 'settings'.hfToken in DATA_DIR/studio.db)
                    wins, as it does in the server; it lives on the volume, so the Runpod API never shows it.

Behaviour:
  - Groups download in manifest order. Within a group, files download in listed order.
  - A file is skipped if it already exists in MODELS_DIR/<dest> at a "plausible" size:
    within 2% of the manifest's declared "bytes", or any existing size if "bytes" is absent.
  - Downloads go to a temp dir under MODELS_DIR/.cache via huggingface_hub.hf_hub_download,
    then are atomically moved (os.replace) into place.
  - Each file gets up to 3 attempts with exponential backoff on failure.
  - Progress is written to $DATA_DIR/models-status.json roughly every 2 seconds while a
    download is in flight, by polling the size of the partial file huggingface_hub writes
    into the cache dir.
  - The script exits 0 even if a group/file ultimately fails; the error is recorded in the
    status file's group entry so the UI can show it, but does not block ComfyUI/studio startup.
  - A group refused by a gated repo (no token, or terms not accepted) is retried by itself once a new
    token shows up in Settings, so saving the token there resumes the download without a restart.

Status file shape (ModelGroupStatus in app/shared/types.ts):
{
  "updatedAt": "<ISO8601>",
  "groups": [
    {
      "id": "image",
      "label": "Z-Image Turbo (images)",
      "ready": false,
      "enabled": true,
      "downloadedBytes": 1234,
      "totalBytes": 5678,
      "currentFile": "split_files/diffusion_models/z_image_turbo_bf16.safetensors",
      "error": null
    }
  ]
}
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

MODELS_MANIFEST = os.environ.get("MODELS_MANIFEST", "/opt/studio/config/models.json")
MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/workspace/models"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/workspace/studio"))
STATUS_FILE = Path(os.environ.get("MODELS_STATUS_FILE", str(DATA_DIR / "models-status.json")))
HF_TOKEN = os.environ.get("HF_TOKEN") or None
STUDIO_DB = Path(os.environ.get("STUDIO_DB", str(DATA_DIR / "studio.db")))
TOKEN_POLL_SEC = 15
GATED_RETRY_SEC = 300  # also retry with an unchanged token, in case the terms were accepted since

SIZE_TOLERANCE = 0.02  # 2%
MAX_ATTEMPTS = 3
STATUS_INTERVAL_SEC = 2.0


@dataclass
class FileSpec:
    repo: str
    path: str
    dest: str
    bytes: Optional[int] = None


@dataclass
class GroupSpec:
    id: str
    label: str
    default: bool
    env: Optional[str] = None
    files: list[FileSpec] = field(default_factory=list)
    # Set for groups under a non-permissive license (MiniMax H3, LTX-2.5); "all" skips them unless named.
    license: Optional[str] = None
    # Groups this one makes redundant; switched off when this group is on (not for MODEL_GROUPS lists).
    replaces: list[str] = field(default_factory=list)


@dataclass
class GroupStatus:
    id: str
    label: str
    enabled: bool
    ready: bool = False
    downloadedBytes: int = 0
    totalBytes: int = 0
    currentFile: Optional[str] = None
    error: Optional[str] = None

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "ready": self.ready,
            "enabled": self.enabled,
            "downloadedBytes": self.downloadedBytes,
            "totalBytes": self.totalBytes,
            "currentFile": self.currentFile,
            "error": self.error,
        }


def load_manifest(path: str) -> list[GroupSpec]:
    with open(path, "r") as f:
        data = json.load(f)
    groups: list[GroupSpec] = []
    for g in data["groups"]:
        files = [FileSpec(repo=f["repo"], path=f["path"], dest=f["dest"], bytes=f.get("bytes")) for f in g["files"]]
        groups.append(GroupSpec(id=g["id"], label=g["label"], default=bool(g.get("default", False)), env=g.get("env"), files=files, license=g.get("license"), replaces=list(g.get("replaces", []))))
    return groups


TRUTHY = {"1", "true", "yes", "on", "y"}
FALSY = {"0", "false", "no", "off", "n", ""}


def env_flag(name: Optional[str], default: bool) -> bool:
    """Read a true/false env switch; unknown or unset values fall back to the default."""
    if not name:
        return default
    raw = os.environ.get(name)
    if raw is None:
        return default
    v = raw.strip().lower()
    if v in TRUTHY:
        return True
    if v in FALSY:
        return False
    print(f"[download_models] {name}={raw!r} is not true/false; using default {default}", flush=True)
    return default


def drop_replaced(chosen: list[GroupSpec]) -> list[GroupSpec]:
    """One switch per choice: e.g. DOWNLOAD_MINIMAX_MODELS=true also skips the Wan video groups it replaces."""
    replaced = {r: g.id for g in chosen for r in g.replaces}
    for g in chosen:
        if g.id in replaced:
            print(f"[download_models] skipping {g.id}: replaced by {replaced[g.id]}", flush=True)
    return [g for g in chosen if g.id not in replaced]


def resolve_requested_groups(all_groups: list[GroupSpec]) -> list[GroupSpec]:
    raw = os.environ.get("MODEL_GROUPS", "").strip()
    if not raw:
        # Per-group switches, e.g. DOWNLOAD_VIDEO_MODELS=false (defaults from the manifest).
        chosen = [g for g in all_groups if env_flag(g.env, g.default)]
        for g in chosen:
            if g.license:
                print(f"[download_models] {g.id}: {g.license}", flush=True)
        return drop_replaced(chosen)
    if raw.lower() == "all":
        # Restricted-license groups must be asked for by name (or their DOWNLOAD_* switch).
        return drop_replaced([g for g in all_groups if not g.license or env_flag(g.env, False)])
    wanted = {g.strip() for g in raw.split(",") if g.strip()}
    return [g for g in all_groups if g.id in wanted]


def existing_size(dest_path: Path) -> Optional[int]:
    try:
        return dest_path.stat().st_size
    except FileNotFoundError:
        return None


def is_plausible(existing: int, expected: Optional[int]) -> bool:
    if expected is None:
        return existing > 0
    if expected <= 0:
        return existing > 0
    return abs(existing - expected) <= expected * SIZE_TOLERANCE


class StatusWriter:
    def __init__(self, groups: list[GroupStatus]):
        self.groups = groups
        self._last_write = 0.0

    def snapshot(self) -> dict:
        return {
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "groups": [g.to_json() for g in self.groups],
        }

    def write(self, force: bool = False) -> None:
        now = time.time()
        if not force and (now - self._last_write) < STATUS_INTERVAL_SEC:
            return
        self._last_write = now
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = STATUS_FILE.with_suffix(".json.tmp")
        with open(tmp, "w") as f:
            json.dump(self.snapshot(), f, indent=2)
        os.replace(tmp, STATUS_FILE)


def find_partial_file(cache_dir: Path, repo: str) -> Optional[Path]:
    """huggingface_hub writes to <cache_dir>/models--org--name/blobs/*.incomplete while downloading."""
    repo_cache_name = "models--" + repo.replace("/", "--")
    blobs_dir = cache_dir / repo_cache_name / "blobs"
    if not blobs_dir.is_dir():
        return None
    candidates = sorted(blobs_dir.glob("*.incomplete"), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)
    return candidates[0] if candidates else None


def settings_hf_token() -> Optional[str]:
    """The Hugging Face token saved on the studio's Settings page, if any."""
    import sqlite3

    try:
        con = sqlite3.connect(f"file:{STUDIO_DB}?mode=ro", uri=True, timeout=5)
        try:
            row = con.execute("SELECT value FROM kv WHERE key = 'settings'").fetchone()
        finally:
            con.close()
        return (json.loads(row[0]).get("hfToken") or None) if row else None
    except Exception:  # noqa: BLE001 - no DB yet (first boot) or unreadable: fall back to HF_TOKEN
        return None


def hf_token() -> Optional[str]:
    """Settings token first, then the HF_TOKEN env var (same order as the server's resolveHfToken)."""
    return settings_hf_token() or HF_TOKEN


class GatedDownloadError(RuntimeError):
    """A gated repo refused the download: no token, or its terms aren't accepted on that account."""


def gated_message(repo: str) -> str:
    """What to do when a gated repo refuses the download."""
    return (
        f"{repo} is gated: accept its terms at https://huggingface.co/{repo} with your Hugging Face account, "
        "then save a token from that account in Settings (Hugging Face token). The download resumes on its own."
    )


def download_file(
    file: FileSpec,
    group_status: GroupStatus,
    status_writer: StatusWriter,
    cache_dir: Path,
) -> None:
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import GatedRepoError
    import threading

    dest_path = MODELS_DIR / file.dest
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    existing = existing_size(dest_path)
    if existing is not None and is_plausible(existing, file.bytes):
        group_status.downloadedBytes += existing
        print(f"[download_models] skip (already present): {file.dest} ({existing} bytes)", flush=True)
        return

    group_status.currentFile = file.path
    status_writer.write(force=True)

    stop_flag = threading.Event()

    # Refuse to start a file that cannot fit (a full volume also takes down the studio's SQLite DB).
    free = shutil.disk_usage(MODELS_DIR).free
    need = (file.bytes or 0) + 2 * 1024**3
    if free < need:
        raise RuntimeError(
            f"Not enough disk space for {file.dest}: need {need / 1e9:.1f} GB free, have {free / 1e9:.1f} GB. "
            "Redeploy with a larger volume (150 GB recommended)."
        )

    # Progress = growth in used bytes on the models volume since this file started. This works for
    # both the classic *.incomplete blobs and hf_xet (which writes elsewhere and finalizes late).
    used_at_start = shutil.disk_usage(MODELS_DIR).used

    def poll_progress():
        while not stop_flag.is_set():
            grown = max(0, shutil.disk_usage(MODELS_DIR).used - used_at_start)
            if file.bytes:
                grown = min(grown, file.bytes)
            group_status.downloadedBytes = group_status._base_bytes + grown
            status_writer.write()
            time.sleep(1)

    # Track bytes completed for prior files in this group so progress is cumulative.
    group_status._base_bytes = group_status.downloadedBytes  # type: ignore[attr-defined]

    progress_thread = threading.Thread(target=poll_progress, daemon=True)
    progress_thread.start()

    last_err: Optional[Exception] = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            print(f"[download_models] downloading {file.repo}:{file.path} -> {file.dest} (attempt {attempt}/{MAX_ATTEMPTS})", flush=True)
            local_path = hf_hub_download(
                repo_id=file.repo,
                filename=file.path,
                cache_dir=str(cache_dir),
                token=hf_token(),
            )
            # hf_hub_download returns a snapshot symlink into the cache's blob store. MOVE the blob
            # into place (same filesystem → instant rename, no second copy), then drop the dangling
            # symlink. Copying here doubled disk usage and filled a 150 GB volume in the first real test.
            blob = Path(os.path.realpath(local_path))
            os.replace(blob, dest_path)
            try:
                os.unlink(local_path)
            except OSError:
                pass
            final_size = existing_size(dest_path) or 0
            group_status.downloadedBytes = group_status._base_bytes + final_size  # type: ignore[attr-defined]
            last_err = None
            break
        except GatedRepoError:
            # Retrying won't help until the user fixes their token/terms.
            last_err = GatedDownloadError(gated_message(file.repo))
            print(f"[download_models] {last_err}", flush=True)
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"[download_models] attempt {attempt} failed for {file.dest}: {e}", flush=True)
            if attempt < MAX_ATTEMPTS:
                backoff = 2 ** attempt
                time.sleep(backoff)

    stop_flag.set()
    progress_thread.join(timeout=2)

    if last_err is not None:
        raise last_err

    group_status.currentFile = None
    status_writer.write(force=True)


def run() -> int:
    print(f"[download_models] manifest={MODELS_MANIFEST} models_dir={MODELS_DIR} data_dir={DATA_DIR}", flush=True)
    all_groups = load_manifest(MODELS_MANIFEST)
    requested = resolve_requested_groups(all_groups)
    requested_ids = {g.id for g in requested}

    cache_dir = MODELS_DIR / ".cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    statuses = [
        GroupStatus(
            id=g.id,
            label=g.label,
            enabled=g.id in requested_ids,
            totalBytes=sum(f.bytes or 0 for f in g.files),
        )
        for g in all_groups
    ]
    status_by_id = {s.id: s for s in statuses}
    writer = StatusWriter(statuses)
    writer.write(force=True)

    def download_group(group: GroupSpec) -> Optional[Exception]:
        gs = status_by_id[group.id]
        gs.downloadedBytes = 0
        gs.error = None
        try:
            for file in group.files:
                download_file(file, gs, writer, cache_dir)
            gs.ready = True
            print(f"[download_models] group '{group.id}' ready", flush=True)
            return None
        except Exception as e:  # noqa: BLE001
            gs.error = str(e)
            print(f"[download_models] group '{group.id}' FAILED: {e}", flush=True)
            if not isinstance(e, GatedDownloadError):
                traceback.print_exc()
            return e
        finally:
            gs.currentFile = None
            writer.write(force=True)

    gated = [g for g in requested if isinstance(download_group(g), GatedDownloadError)]

    # Gated groups wait for a new token on the Settings page (or for the terms to be accepted), then
    # retry, so no pod restart is needed.
    tried, tried_at = hf_token(), time.time()
    if gated:
        print(f"[download_models] waiting for a Hugging Face token in Settings for: {', '.join(g.id for g in gated)}", flush=True)
    while gated:
        time.sleep(TOKEN_POLL_SEC)
        token = hf_token()
        if not token or (token == tried and time.time() - tried_at < GATED_RETRY_SEC):
            continue
        tried, tried_at = token, time.time()
        print("[download_models] retrying gated groups with the current Hugging Face token", flush=True)
        gated = [g for g in gated if isinstance(download_group(g), GatedDownloadError)]

    writer.write(force=True)
    print("[download_models] done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(run())

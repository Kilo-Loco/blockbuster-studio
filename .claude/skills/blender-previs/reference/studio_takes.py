#!/usr/bin/env python3
"""studio_takes.py: the iteration loop for previs-driven takes, against a running studio.

  export STUDIO_URL=https://<pod>-3000.proxy.runpod.net STUDIO_AGENT_TOKEN=...
  studio_takes.py upload sheets/*.png shot3/clip.mp4 [--project ID]          -> asset ids (one JSON line per file)
  studio_takes.py take --name s3_t1 --prompt shot3.txt --refs A,B,C --ref-video V \\
                       [--engine h3_ref|wan_i2v|wan_control|wan_t2v] [--inputs A[,B]] [--control-video V] [--video-model M]
                       [--quality fast|hd] [--duration 4] [--count 1] [--aspect 16:9] [--project ID] [--out takes/] [--no-wait]
                                                                             -> takes/s3_t1.mp4 + takes/s3_t1.jpg (8-frame sheet)
  studio_takes.py wait JOB [JOB...]                                          -> waits, prints each job's output asset ids
  studio_takes.py sheet ASSET out.jpg [--n 8] ; studio_takes.py fetch ASSET out.mp4
  studio_takes.py cut spec.json out.mp4       -> hard cuts with each clip's own sound (see cut())

Grade every sheet against a written per-shot checklist before changing a prompt; iterate at fast (about a
quarter of the hd time), then render the approved prompt at hd. Only the studio's REST API is used
(docs/API.md); nothing here is specific to one film.
"""
import argparse, json, mimetypes, os, subprocess, sys, time, urllib.request

URL = os.environ.get("STUDIO_URL", "").rstrip("/")
TOKEN = os.environ.get("STUDIO_AGENT_TOKEN", "")


def api(method, path, body=None, raw=False):
    if not URL or not TOKEN:
        sys.exit("set STUDIO_URL and STUDIO_AGENT_TOKEN")
    # a browser-like User-Agent: Runpod's proxy answers 403 to Python-urllib's default
    req = urllib.request.Request(URL + path, method=method, headers={"Authorization": f"Bearer {TOKEN}", "User-Agent": "studio-takes/1"})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("content-type", "application/json")
    with urllib.request.urlopen(req, data, timeout=120) as r:
        b = r.read()
        return b if raw else json.loads(b.decode(), strict=False)


def upload(path, project=None):
    boundary = "----studio" + str(int(time.time() * 1000))
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    parts = []
    if project:
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"projectId\"\r\n\r\n{project}\r\n".encode())
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(path)}\"\r\n"
                 f"Content-Type: {ctype}\r\n\r\n".encode() + open(path, "rb").read() + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(URL + "/api/uploads", method="POST", data=b"".join(parts),
                                 headers={"Authorization": f"Bearer {TOKEN}", "User-Agent": "studio-takes/1", "content-type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode(), strict=False)


def wait_jobs(ids, quiet=False):
    """Poll until every job is finished; the server holds each request up to 50 s."""
    done = {}
    while len(done) < len(ids):
        pending = [i for i in ids if i not in done]
        for j in api("GET", f"/api/jobs?ids={','.join(pending)}&wait=50"):
            if j["status"] in ("done", "error", "canceled"):
                done[j["id"]] = j
                if not quiet:
                    print(j["id"], j["status"], j.get("error") or "", j.get("outputAssetIds"), file=sys.stderr)
            elif not quiet:
                print(j["id"], j["status"], j.get("progress"), file=sys.stderr)
    return [done[i] for i in ids]


def fetch(asset_id, out):
    a = api("GET", f"/api/assets/{asset_id}")
    open(out, "wb").write(api("GET", "/media/" + a["file"], raw=True))
    return a


def sheet(asset_id, out, n=8, width=480):
    open(out, "wb").write(api("GET", f"/api/assets/{asset_id}/frames?n={n}&width={width}", raw=True))


def take(a):
    body = {"engine": a.engine, "prompt": open(a.prompt).read(), "aspect": a.aspect, "count": a.count,
            "quality": a.quality, "durationSec": a.duration}
    if a.refs: body["referenceAssetIds"] = a.refs.split(",")
    if a.ref_video: body["referenceVideoAssetIds"] = a.ref_video.split(",")
    if a.inputs: body["inputAssetIds"] = a.inputs.split(",")          # wan_i2v first[,last] frame; wan_control reference image
    if a.control_video: body["controlVideoAssetId"] = a.control_video; body["controlPreprocess"] = a.control_preprocess
    if a.video_model: body["videoModel"] = a.video_model
    if a.project: body["projectId"] = a.project
    if a.seed is not None: body["seed"] = a.seed
    job = api("POST", "/api/generate", body)
    print(json.dumps({"name": a.name, "job": job["id"]}))
    if a.no_wait:
        return
    os.makedirs(a.out, exist_ok=True)
    (job,) = wait_jobs([job["id"]])
    for k, aid in enumerate(job.get("outputAssetIds") or []):
        stem = os.path.join(a.out, a.name if k == 0 else f"{a.name}_{k + 1}")
        fetch(aid, stem + ".mp4"); sheet(aid, stem + ".jpg")
        print(json.dumps({"name": a.name, "asset": aid, "mp4": stem + ".mp4", "sheet": stem + ".jpg"}))
    if job["status"] != "done":
        sys.exit(f"job {job['id']} {job['status']}: {job.get('error')}")


def cut(spec_path, out):
    """spec: {"segments":[{"video":p,"vstart":s,"vend":s,"audio":p|null,"astart":s}], "fade_out":0.8}
    Hard cuts in order (1280x720, 24 fps). Each segment's audio (its own clip by default) is loudness-matched
    and overlapped 0.4 s across the cut; fades at both ends."""
    spec = json.load(open(spec_path)); segs = spec["segments"]; X = 0.4
    inputs, f, vl, al = [], [], [], []
    t = 0.0; idx = 0
    for i, s in enumerate(segs):
        d = s["vend"] - s["vstart"]
        inputs += ["-i", s["video"]]; vi = idx; idx += 1
        f.append(f"[{vi}:v]trim={s['vstart']}:{s['vend']},setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,setsar=1,fps=24[v{i}]")
        vl.append(f"[v{i}]")
        audio = s.get("audio", s["video"])
        if audio:
            inputs += ["-i", audio]; ai = idx; idx += 1
            a0 = s.get("astart", s["vstart"]); alen = d + (X if i < len(segs) - 1 else 0)
            delay = max(0.0, t - (X / 2 if i > 0 else 0))
            f.append(f"[{ai}:a]atrim={a0}:{a0 + alen},asetpts=PTS-STARTPTS,aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=9,"
                     f"afade=t=in:st=0:d={X if i > 0 else 0.3},afade=t=out:st={alen - X}:d={X},adelay={int(delay * 1000)}|{int(delay * 1000)}[a{i}]")
            al.append(f"[a{i}]")
        t += d
    fo = spec.get("fade_out", 0.8)
    f.append("".join(vl) + f"concat=n={len(segs)}:v=1:a=0[vc]")
    f.append(f"[vc]fade=t=in:st=0:d=0.4,fade=t=out:st={t - fo}:d={fo}[vo]")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex"]
    if al:
        f.append("".join(al) + f"amix=inputs={len(al)}:normalize=0:dropout_transition=0,atrim=0:{t},afade=t=out:st={t - 1.0}:d=1.0[ao]")
        cmd += [";".join(f), "-map", "[vo]", "-map", "[ao]", "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += [";".join(f), "-map", "[vo]"]
    cmd += ["-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)
    print(out, round(t, 2), "s")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("upload"); s.add_argument("files", nargs="+"); s.add_argument("--project")
    s = sub.add_parser("take")
    s.add_argument("--name", required=True); s.add_argument("--prompt", required=True, help="prompt text file")
    s.add_argument("--refs", help="image asset ids, comma-separated, in <Picture N> order")
    s.add_argument("--ref-video", help="video asset ids (the playblast), comma-separated")
    s.add_argument("--engine", default="h3_ref", choices=["h3_ref", "wan_i2v", "wan_control", "wan_t2v"])
    s.add_argument("--inputs", help="wan_i2v: first[,last] frame asset ids; wan_control: the reference image")
    s.add_argument("--control-video", help="wan_control: the depth/edge video asset id")
    s.add_argument("--control-preprocess", default="none", choices=["none", "canny"])
    s.add_argument("--video-model", help="wan_i2v: minimax_h3 | ltx_2_5 | wan (default: best installed)")
    s.add_argument("--quality", default="fast", choices=["fast", "hd"]); s.add_argument("--duration", type=int, default=4)
    s.add_argument("--count", type=int, default=1); s.add_argument("--aspect", default="16:9"); s.add_argument("--seed", type=int)
    s.add_argument("--project"); s.add_argument("--out", default="takes"); s.add_argument("--no-wait", action="store_true")
    s = sub.add_parser("wait"); s.add_argument("jobs", nargs="+")
    s = sub.add_parser("sheet"); s.add_argument("asset"); s.add_argument("out"); s.add_argument("--n", type=int, default=8)
    s = sub.add_parser("fetch"); s.add_argument("asset"); s.add_argument("out")
    s = sub.add_parser("cut"); s.add_argument("spec"); s.add_argument("out")
    a = p.parse_args()
    if a.cmd == "upload":
        for f in a.files:
            r = upload(f, a.project); print(json.dumps({"file": f, "asset": r["id"], "kind": r.get("kind")}))
    elif a.cmd == "take": take(a)
    elif a.cmd == "wait":
        for j in wait_jobs(a.jobs, quiet=True): print(json.dumps({"job": j["id"], "status": j["status"], "assets": j.get("outputAssetIds"), "error": j.get("error")}))
    elif a.cmd == "sheet": sheet(a.asset, a.out, a.n)
    elif a.cmd == "fetch": fetch(a.asset, a.out)
    elif a.cmd == "cut": cut(a.spec, a.out)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""LAN-facing static server with request logging for gaussian-engine."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote


ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(ROOT, "server.log")
JOBS_DIR = os.path.join(ROOT, "jobs")
MAX_UPLOAD = 700 * 1024 * 1024
_job_lock = threading.Lock()
_current_job: str | None = None


def now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg: str) -> None:
    line = f"[{now()}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".splat": "application/octet-stream",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        ua = self.headers.get("User-Agent", "-")
        referer = self.headers.get("Referer", "-")
        extra = f" ua={ua!r} ref={referer!r}"
        log(f"{self.address_string()} {fmt % args}{extra}")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def handle_one_request(self) -> None:
        try:
            super().handle_one_request()
        except ConnectionResetError:
            pass
        except ConnectionAbortedError:
            pass

    def do_GET(self) -> None:  # noqa: N802
        path = unquote(self.path.split("?", 1)[0])
        if path == "/whoami":
            self._json(
                {
                    "client": self.client_address[0],
                    "host": self.headers.get("Host", ""),
                    "ips": lan_ips(),
                    "port": self.server.server_address[1],
                    "ua": self.headers.get("User-Agent", ""),
                }
            )
            return
        if path == "/api/gpu":
            self._json(gpu_status())
            return
        if path == "/api/jobs":
            self._json({"jobs": list_jobs(), "current": _current_job})
            return
        m = re.fullmatch(r"/api/jobs/([a-zA-Z0-9_-]+)", path)
        if m:
            self._json(job_public(m.group(1)))
            return
        m = re.fullmatch(r"/api/jobs/([a-zA-Z0-9_-]+)/splat", path)
        if m:
            splat = os.path.join(JOBS_DIR, m.group(1), "result.splat")
            if not os.path.isfile(splat):
                self.send_error(404, "splat not ready")
                return
            self.path = "/jobs/" + m.group(1) + "/result.splat"
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = unquote(self.path.split("?", 1)[0])
        if path == "/log":
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(max(0, min(length, 32_000)))
            text = raw.decode("utf-8", "replace").replace("\n", " ")
            log(f"CLIENT {self.address_string()} {text}")
            self.send_response(204)
            self.end_headers()
            return
        if path == "/api/jobs":
            try:
                info = create_job_from_upload(self)
            except ValueError as exc:
                self._json({"error": str(exc)}, 400)
                return
            log(f"JOB {info['id']} from {self.address_string()} {info.get('filename')}")
            self._json(info, 202)
            return
        self.send_error(404, "not found")


def gpu_status() -> dict:
    script = os.path.join(ROOT, "scripts", "reconstruct.py")
    py = sys.executable
    try:
        out = subprocess.check_output([py, script], text=True, timeout=20)
        tools = json.loads(out)
    except (subprocess.SubprocessError, json.JSONDecodeError) as exc:
        tools = {"error": str(exc)}
    tools["viewer"] = "webgl2"
    tools["train"] = "cuda" if tools.get("cuda") else "unavailable"
    return tools


def job_dir(job_id: str) -> str:
    return os.path.join(JOBS_DIR, job_id)


def read_status(job_id: str) -> dict:
    path = os.path.join(job_dir(job_id), "status.json")
    if not os.path.isfile(path):
        return {"id": job_id, "state": "missing"}
    try:
        data = json.loads(open(path, encoding="utf-8").read())
    except json.JSONDecodeError:
        data = {"state": "unknown"}
    data["id"] = job_id
    return data


def job_public(job_id: str) -> dict:
    data = read_status(job_id)
    if data.get("state") == "done":
        data["splat_url"] = f"/api/jobs/{job_id}/splat"
    return data


def list_jobs() -> list[dict]:
    if not os.path.isdir(JOBS_DIR):
        return []
    ids = sorted(os.listdir(JOBS_DIR), reverse=True)
    return [job_public(j) for j in ids if os.path.isdir(job_dir(j))][:20]


def _parse_multipart(raw_path: str, dest_dir: str) -> str:
    data = open(raw_path, "rb").read()
    # First line is --boundary
    nl = data.find(b"\r\n")
    if nl < 0:
        raise ValueError("invalid multipart")
    boundary = data[:nl]
    parts = data.split(boundary)
    for part in parts:
        if b"filename=" not in part:
            continue
        head, _, body = part.partition(b"\r\n\r\n")
        if body.endswith(b"\r\n"):
            body = body[:-2]
        if body.endswith(b"--"):
            body = body[:-2]
        if body.endswith(b"\r\n"):
            body = body[:-2]
        name = "upload.bin"
        m = re.search(br'filename="([^"]+)"', head)
        if m:
            name = os.path.basename(m.group(1).decode("utf-8", "replace"))
        ext = os.path.splitext(name)[1].lower() or ".bin"
        if ext in {".jpg", ".jpeg", ".png", ".webp", ".heic"}:
            img_dir = os.path.join(dest_dir, "images")
            os.makedirs(img_dir, exist_ok=True)
            out = os.path.join(img_dir, name)
        else:
            out = os.path.join(dest_dir, "input" + (ext if ext else ".mp4"))
        with open(out, "wb") as fh:
            fh.write(body)
        return name
    raise ValueError("no file field in upload")


def create_job_from_upload(handler: Handler) -> dict:
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        raise ValueError("empty upload")
    if length > MAX_UPLOAD:
        raise ValueError(f"upload too large ({length} bytes, max {MAX_UPLOAD})")
    os.makedirs(JOBS_DIR, exist_ok=True)
    job_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    dest = job_dir(job_id)
    os.makedirs(dest, exist_ok=True)
    raw = os.path.join(dest, "upload.bin")
    remaining = length
    with open(raw, "wb") as fh:
        while remaining > 0:
            chunk = handler.rfile.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            fh.write(chunk)
            remaining -= len(chunk)
    ctype = handler.headers.get("Content-Type", "")
    filename = handler.headers.get("X-Filename", "upload.bin")
    if "multipart/form-data" in ctype:
        filename = _parse_multipart(raw, dest)
    else:
        ext = os.path.splitext(filename)[1].lower() or ".mp4"
        shutil.move(raw, os.path.join(dest, "input" + ext))
    if os.path.isfile(raw):
        os.remove(raw)
    status = {
        "id": job_id,
        "state": "queued",
        "stage": "queued",
        "progress": 0,
        "filename": filename,
        "bytes": length,
        "created": time.time(),
    }
    with open(os.path.join(dest, "status.json"), "w", encoding="utf-8") as fh:
        json.dump(status, fh, indent=2)
    threading.Thread(target=run_job, args=(job_id,), daemon=True).start()
    return status


def run_job(job_id: str) -> None:
    global _current_job
    with _job_lock:
        _current_job = job_id
        log(f"JOB {job_id} start reconstruct")
        script = os.path.join(ROOT, "scripts", "reconstruct.py")
        dest = job_dir(job_id)
        try:
            proc = subprocess.run(
                [sys.executable, script, dest],
                cwd=ROOT,
                capture_output=False,
            )
            if proc.returncode != 0:
                log(f"JOB {job_id} failed exit={proc.returncode}")
            else:
                log(f"JOB {job_id} done")
        except Exception as exc:  # noqa: BLE001
            log(f"JOB {job_id} exception {exc}")
            path = os.path.join(dest, "status.json")
            cur = {}
            if os.path.isfile(path):
                try:
                    cur = json.loads(open(path, encoding="utf-8").read())
                except json.JSONDecodeError:
                    cur = {}
            cur.update({"state": "error", "error": str(exc)})
            open(path, "w", encoding="utf-8").write(json.dumps(cur, indent=2))
        finally:
            _current_job = None


def lan_ips() -> list[str]:
    ips: list[str] = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        if ip not in ips and not ip.startswith("127."):
            ips.insert(0, ip)
    except OSError:
        pass
    return ips


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    urls = [f"http://127.0.0.1:{args.port}/"]
    for ip in lan_ips():
        urls.append(f"http://{ip}:{args.port}/")
    log(f"serving {ROOT} on {args.host}:{args.port}")
    for url in urls:
        log(f"open {url}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())

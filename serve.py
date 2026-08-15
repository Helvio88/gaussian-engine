#!/usr/bin/env python3
"""LAN-facing static server with request logging for gaussian-engine."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(ROOT, "server.log")


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
        path = self.path.split("?", 1)[0]
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
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path != "/log":
            self.send_error(404, "not found")
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(max(0, min(length, 32_000)))
        text = raw.decode("utf-8", "replace").replace("\n", " ")
        log(f"CLIENT {self.address_string()} {text}")
        self.send_response(204)
        self.end_headers()


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

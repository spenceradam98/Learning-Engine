"""Runs the browser app on this computer: `python main.py web`, then Chrome opens it.

The app itself (the `app/` folder) runs entirely in Chrome and keeps your work in
Chrome's storage, exactly like the online version. This small server just hands
Chrome those files, and lets the page bring in work saved by the terminal version
(data/ folder) with the "Bring in my saved work" button in Settings.
It only listens on this computer (127.0.0.1), so nobody else on your network can reach it.
"""
from __future__ import annotations

import json
import mimetypes
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import backup, config

APP_DIR = config.ROOT / "app"
ALLOWED_HOSTS = {"localhost", "127.0.0.1"}
TYPES = {".js": "text/javascript", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
         ".css": "text/css", ".html": "text/html", ".png": "image/png", ".json": "application/json"}


def resolve_static(path: str):
    """Map a URL path to a file inside app/, or None (never escapes the folder)."""
    rel = unquote(path).lstrip("/") or "index.html"
    target = (APP_DIR / rel).resolve()
    root = APP_DIR.resolve()
    if root != target and root not in target.parents:
        return None
    return target if target.is_file() else None


class Handler(BaseHTTPRequestHandler):
    server_version = "LearningEngine/2.0"

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass

    def _send(self, status: int, body: bytes, ctype: str, extra=None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        if host not in ALLOWED_HOSTS:
            return self._send(403, b"Forbidden host", "text/plain")
        path = urlparse(self.path).path
        if path == "/api/export":
            # Same-origin only: a page on another site can't read this (no CORS headers).
            body = json.dumps(backup.export_backup()).encode("utf-8")
            return self._send(200, body, "application/json; charset=utf-8")
        f = resolve_static(path)
        if f is None:
            return self._send(404, b"Not found", "text/plain")
        ctype = TYPES.get(f.suffix) or mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("json"):
            ctype += "; charset=utf-8"
        self._send(200, f.read_bytes(), ctype)


def open_in_chrome(url: str) -> None:
    if sys.platform == "darwin":
        try:
            subprocess.run(["open", "-a", "Google Chrome", url], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except (OSError, subprocess.CalledProcessError):
            pass  # Chrome not installed: fall back to the default browser
    webbrowser.open(url)


def serve(port: int = 5050, open_browser: bool = True) -> None:
    config.ensure_dirs()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    url = "http://localhost:{}".format(port)
    print("Learning Engine is running at {}  (press Ctrl+C to stop)".format(url))
    print("Tip: the online version works without Terminal. See README, 'Use it online'.")
    if open_browser:
        threading.Timer(0.8, open_in_chrome, args=(url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()

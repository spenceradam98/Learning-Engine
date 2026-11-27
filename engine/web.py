"""Browser version of the app. Uses only Python's built-in web server.

Run `python main.py web`, then use it in Chrome at http://localhost:5050.
It only listens on this computer (127.0.0.1), so nobody else on your network can reach it.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Dict, Iterator, Optional
from urllib.parse import parse_qs, urlparse

from . import config, generator, review, topics
from .assignments import AssignmentStore
from .llm_client import LLMClient, LLMError
from .progress import Progress
from .question_bank import QuestionBank
from .quiz import QuizSession
from .tutor import Tutor

INDEX_HTML = config.ROOT / "web" / "index.html"
ALLOWED_HOSTS = {"localhost", "127.0.0.1"}

_sessions: Dict[str, QuizSession] = {}
_lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _public_question(q: dict) -> dict:
    # Never send the answer to the browser before you've answered.
    return {k: q[k] for k in ("id", "question", "choices", "subtopic", "difficulty") if k in q}


def _assignment_summary(a: dict) -> dict:
    return {"id": a["id"], "title": a["title"], "course": a.get("course", ""),
            "due": a.get("due", ""), "drafts": len(a.get("drafts", [])),
            "concepts": a.get("concepts", [])}


def _topic_rows() -> list:
    rows = []
    for key, t in config.TOPICS.items():
        rows.append({"key": key, "name": t["name"], "questions": len(QuestionBank(key)),
                     "kind": "topic", **Progress(key).totals()})
    for a in AssignmentStore().list():
        key = topics.ASSIGNMENT_PREFIX + a["id"]
        rows.append({"key": key, "name": a["title"], "questions": len(QuestionBank(key)),
                     "kind": "assignment", **Progress(key).totals()})
    return rows


def _status() -> dict:
    s = config.load_settings()
    return {
        "provider": s["provider"], "label": s["label"], "url": s["url"], "model": s["model"],
        "has_key": bool(s["api_key"]),
        "providers": {k: {"label": v["label"], "url": v["url"], "model": v["model"],
                          "needs_key": v["needs_key"], "key_url": v["key_url"]}
                      for k, v in config.PROVIDERS.items()},
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "LearningEngine/1.0"

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass

    # -- plumbing -----------------------------------------------------------------
    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        return host in ALLOWED_HOSTS

    def _send_json(self, data, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            # Browsers can't send JSON cross-site without permission, so this
            # stops other websites from poking the app.
            raise ApiError(415, "JSON body required")
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            data = json.loads(self.rfile.read(n).decode("utf-8"))
        except ValueError:
            raise ApiError(400, "Bad JSON")
        return data if isinstance(data, dict) else {}

    def _stream_text(self, make: Callable[[], Iterator[str]],
                     on_done: Optional[Callable[[str], None]] = None) -> None:
        """Stream model text to the browser as it's written."""
        it = iter(make())
        try:
            first = next(it)
        except StopIteration:
            first = ""
        # LLMError before the first chunk propagates to a normal JSON error.
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        parts = [first]
        self.wfile.write(first.encode("utf-8"))
        self.wfile.flush()
        try:
            for chunk in it:
                parts.append(chunk)
                self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()
        except LLMError as e:
            self.wfile.write("\n\n[Stopped: {}]".format(e).encode("utf-8"))
            return
        if on_done:
            on_done("".join(parts))

    def _stream_lines(self) -> Callable[[dict], None]:
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        def emit(obj: dict) -> None:
            self.wfile.write((json.dumps(obj) + "\n").encode("utf-8"))
            self.wfile.flush()
        return emit

    def _dispatch(self, method: str) -> None:
        if not self._host_ok():
            self._send_json({"error": "Forbidden host"}, 403)
            return
        url = urlparse(self.path)
        try:
            self.route(method, url.path, parse_qs(url.query))
        except ApiError as e:
            self._send_json({"error": str(e)}, e.status)
        except LLMError as e:
            self._send_json({"error": str(e)}, 502)
        except KeyError as e:
            self._send_json({"error": "Not found: {}".format(e)}, 404)
        except ValueError as e:
            self._send_json({"error": str(e)}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser tab closed mid-stream

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_DELETE(self):
        self._dispatch("DELETE")

    # -- routes ---------------------------------------------------------------------
    def route(self, method: str, path: str, query: dict) -> None:
        if method == "GET" and path in ("/", "/index.html"):
            body = INDEX_HTML.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if method == "GET" and path == "/api/status":
            return self._send_json(_status())
        if method == "POST" and path == "/api/settings":
            b = self._body()
            provider = b.get("provider")
            if provider not in config.PROVIDERS:
                raise ApiError(400, "Unknown provider")
            current = config.load_settings()
            key = (b.get("api_key") or "").strip()
            if not key and current["provider"] == provider:
                key = current["api_key"]  # blank field keeps the saved key
            preset = config.PROVIDERS[provider]
            config.save_settings(provider, (b.get("url") or preset["url"]).strip(),
                                 (b.get("model") or preset["model"]).strip(), key)
            return self._send_json(_status())
        if method == "POST" and path == "/api/check":
            self._body()
            return self._send_json({"message": LLMClient().check()})
        if method == "GET" and path == "/api/topics":
            return self._send_json({"topics": _topic_rows()})

        if method == "POST" and path == "/api/generate":
            b = self._body()
            key = topics.resolve(b.get("topic", ""))
            n = max(1, min(20, int(b.get("n") or 10)))
            level = int(b["level"]) if b.get("level") else None
            if key.startswith(topics.ASSIGNMENT_PREFIX):
                Tutor().concepts(AssignmentStore().get(key[len(topics.ASSIGNMENT_PREFIX):]))
            emit = self._stream_lines()
            try:
                res = generator.generate(key, n, difficulty=level,
                                         on_progress=lambda d, t, m: emit({"done": d, "total": t, "msg": m}))
                emit({"result": {"added": len(res["added"]), "failed": res["failed"],
                                 "duplicates": res["duplicates"], "total": res["total_in_bank"]}})
            except LLMError as e:
                emit({"error": str(e)})
            return

        if path.startswith("/api/quiz/") and method == "POST":
            return self.quiz_route(path[len("/api/quiz/"):], self._body())

        if method == "GET" and path == "/api/review":
            wanted = (query.get("topic") or [""])[0]
            keys = [topics.resolve(wanted)] if wanted else review.topic_keys_with_progress()
            reports = [review.report(k) for k in keys]
            return self._send_json({"reports": [r for r in reports if r["subtopics"]]})
        if method == "POST" and path == "/api/review/plan":
            rep = review.report(topics.resolve(self._body().get("topic", "")))
            return self._stream_text(lambda: review.study_plan_stream(rep))

        if path == "/api/assignments" or path.startswith("/api/assignments/"):
            return self.assignment_route(method, path)

        raise ApiError(404, "No such page")

    def quiz_route(self, action: str, b: dict) -> None:
        if action == "start":
            key = topics.resolve(b.get("topic", ""))
            if key.startswith(topics.ASSIGNMENT_PREFIX):
                Tutor().concepts(AssignmentStore().get(key[len(topics.ASSIGNMENT_PREFIX):]))
            s = QuizSession(key, length=max(1, min(50, int(b.get("n") or 10))))
            sid = uuid.uuid4().hex
            with _lock:
                _sessions[sid] = s
                while len(_sessions) > 20:  # forget old sessions
                    _sessions.pop(next(iter(_sessions)))
            return self._send_json({"session": sid, "name": s.info.name, "difficulty": s.difficulty,
                                    "bank": len(s.bank), "length": s.length})
        with _lock:
            s = _sessions.get(b.get("session", ""))
        if s is None:
            raise ApiError(404, "Quiz session expired. Start a new quiz.")
        if action == "next":
            q = s.current or s.next_question()
            if q is None:
                return self._send_json({"finished": True, "summary": s.summary()})
            return self._send_json({"question": _public_question(q), "number": len(s.results) + 1,
                                    "length": s.length, "difficulty": s.difficulty})
        if action == "answer":
            if s.current is None:
                raise ApiError(400, "No question waiting for an answer")
            chosen = b.get("chosen")
            chosen = int(chosen) if chosen is not None else None
            conf = max(1, min(3, int(b.get("confidence") or 2)))
            result = s.answer(chosen, conf)
            result["finished"] = s.finished
            if s.finished:
                result["summary"] = s.summary()
            return self._send_json(result)
        if action == "reexplain":
            return self._stream_text(s.reexplain_stream)
        if action == "stop":
            with _lock:
                _sessions.pop(b.get("session", ""), None)
            return self._send_json({"summary": s.summary()})
        raise ApiError(404, "Unknown quiz action")

    def assignment_route(self, method: str, path: str) -> None:
        store = AssignmentStore()
        parts = path.strip("/").split("/")  # api, assignments, [id], [action]
        if len(parts) == 2:
            if method == "GET":
                return self._send_json({"assignments": [_assignment_summary(a) for a in store.list()]})
            if method == "POST":
                b = self._body()
                a = store.add(b.get("title", ""), b.get("brief", ""), course=b.get("course", ""),
                              due=b.get("due", ""), rubric_text=b.get("rubric", ""))
                return self._send_json({"assignment": a})
        aid = parts[2]
        if not re.match(r"^[a-z0-9-]+$", aid):
            raise ApiError(400, "Bad assignment id")
        a = store.get(aid)
        action = parts[3] if len(parts) > 3 else ""
        tutor = Tutor(store=store)
        if not action:
            if method == "GET":
                return self._send_json({"assignment": a})
            if method == "DELETE":
                store.delete(aid)
                return self._send_json({"deleted": aid})
        if method != "POST":
            raise ApiError(405, "Use POST")
        b = self._body()
        if action == "concepts":
            return self._send_json({"concepts": tutor.concepts(a, refresh=bool(b.get("refresh")))})

        def concept() -> dict:
            cs = tutor.concepts(a)
            i = int(b.get("concept", 0))
            if not 0 <= i < len(cs):
                raise ApiError(400, "No such concept")
            return cs[i]

        if action == "learn":
            c = concept()
            return self._stream_text(lambda: tutor.learn_stream(a, c))
        if action == "followup":
            c = concept()
            history = [m for m in (b.get("history") or [])
                       if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
            q = (b.get("question") or "").strip()
            if not q:
                raise ApiError(400, "Type a question")
            return self._stream_text(lambda: tutor.followup_stream(a, c, history, q))
        if action == "outline":
            return self._stream_text(lambda: tutor.outline_stream(a),
                                     on_done=lambda text: tutor.save_outline(a, text))
        if action == "hint":
            stuck = (b.get("stuck") or "").strip()
            if not stuck:
                raise ApiError(400, "Say what you're stuck on")
            return self._stream_text(lambda: tutor.hint_stream(a, stuck))
        if action == "feedback":
            draft = (b.get("draft") or "").strip()
            if not draft:
                raise ApiError(400, "Paste your draft first")
            return self._stream_text(lambda: tutor.feedback_stream(a, draft),
                                     on_done=lambda text: tutor.save_feedback(a, draft, text))
        raise ApiError(404, "Unknown assignment action")


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
    print("AI: {}".format(LLMClient().describe()))
    if open_browser:
        threading.Timer(0.8, open_in_chrome, args=(url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()

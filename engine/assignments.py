"""Stores your college assignments (pasted text) and your drafts."""
from __future__ import annotations

import re
from typing import List

from . import config
from .storage import now, read_json, write_json


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return (s[:40] or "assignment").strip("-")


class AssignmentStore:
    def __init__(self):
        self.dir = config.ASSIGNMENTS_DIR

    def _path(self, aid: str):
        return self.dir / "{}.json".format(aid)

    def add(self, title: str, brief_text: str, course: str = "", due: str = "",
            rubric_text: str = "") -> dict:
        if not title.strip() or not brief_text.strip():
            raise ValueError("An assignment needs a title and the brief text.")
        base = _slug(title)
        aid, n = base, 2
        while self._path(aid).exists():
            aid, n = "{}-{}".format(base, n), n + 1
        a = {
            "id": aid, "title": title.strip(), "course": course.strip(), "due": due.strip(),
            "brief_text": brief_text.strip(), "rubric_text": rubric_text.strip(),
            "concepts": [], "outline": "", "drafts": [], "created_at": now(),
        }
        self.save(a)
        return a

    def save(self, a: dict) -> None:
        write_json(self._path(a["id"]), a)

    def get(self, aid: str) -> dict:
        a = read_json(self._path(aid), None)
        if a is None:
            raise KeyError(aid)
        return a

    def list(self) -> List[dict]:
        if not self.dir.exists():
            return []
        out = []
        for p in sorted(self.dir.glob("*.json")):
            a = read_json(p, None)
            if a:
                out.append(a)
        return out

    def delete(self, aid: str) -> None:
        p = self._path(aid)
        if p.exists():
            p.unlink()

    def add_draft(self, a: dict, text: str, feedback: str) -> None:
        a.setdefault("drafts", []).append({"text": text, "feedback": feedback, "ts": now()})
        self.save(a)

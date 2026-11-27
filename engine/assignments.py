"""Stores your college assignments (pasted text) and your drafts.

Each module (class subject) has its own folder, and an assignment lives in
exactly one of them:

    data/assignments/<module>/<assignment-id>.json

for example data/assignments/composition/film-cue.json. Assignments saved
before modules existed (loose files in data/assignments/) are moved into
data/assignments/general/ the first time the store is used.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional

from . import config
from .storage import now, read_json, write_json

GENERAL = "general"
_SAFE = re.compile(r"^[a-z0-9-]{1,80}$")


def _slug(title: str, fallback: str = "assignment") -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")
    return (s[:40] or fallback).strip("-") or fallback


def module_key(name: str) -> str:
    """'Music composition' -> 'music-composition' (a safe folder name)."""
    key = _slug(name, GENERAL)
    return "m-" + key if key.startswith("assignment-") else key


class AssignmentStore:
    def __init__(self):
        self.dir = config.ASSIGNMENTS_DIR
        self._migrate()

    def _migrate(self) -> None:
        """Move loose assignment files from before modules into the General folder."""
        if not self.dir.exists():
            return
        for p in sorted(self.dir.glob("*.json")):
            a = read_json(p, None)
            target = self.dir / GENERAL / p.name
            if isinstance(a, dict):
                a["module"] = GENERAL
                if not target.exists():
                    write_json(target, a)
                    p.unlink()

    def _folder(self, module: str) -> Path:
        if not _SAFE.match(module or ""):
            raise ValueError("That module name can't be used as a folder.")
        return self.dir / module

    def _find(self, aid: str) -> Optional[Path]:
        if not _SAFE.match(aid or "") or not self.dir.exists():
            return None
        for p in sorted(self.dir.glob("*/{}.json".format(aid))):
            return p
        return None

    def modules(self) -> List[str]:
        """Module folders that exist on disk, General first."""
        if not self.dir.exists():
            return []
        names = sorted(p.name for p in self.dir.iterdir() if p.is_dir() and _SAFE.match(p.name))
        return sorted(names, key=lambda n: (n != GENERAL, n))

    def add(self, title: str, brief_text: str, course: str = "", due: str = "",
            rubric_text: str = "", module: str = GENERAL) -> dict:
        if not title.strip() or not brief_text.strip():
            raise ValueError("An assignment needs a title and the brief text.")
        folder = self._folder(module or GENERAL)
        base = _slug(title)
        aid, n = base, 2
        while self._find(aid):  # ids stay unique across every module
            aid, n = "{}-{}".format(base, n), n + 1
        a = {
            "id": aid, "title": title.strip(), "course": course.strip(), "due": due.strip(),
            "brief_text": brief_text.strip(), "rubric_text": rubric_text.strip(),
            "concepts": [], "outline": "", "drafts": [], "created_at": now(),
            "module": folder.name,
        }
        self.save(a)
        return a

    def save(self, a: dict) -> None:
        module = a.get("module") or GENERAL
        old = self._find(a["id"])
        new = self._folder(module) / "{}.json".format(a["id"])
        a["module"] = module
        write_json(new, a)
        if old and old != new and old.exists():
            old.unlink()

    def move(self, aid: str, module: str) -> dict:
        a = self.get(aid)
        a["module"] = module
        self.save(a)
        return a

    def get(self, aid: str) -> dict:
        p = self._find(aid)
        a = read_json(p, None) if p else None
        if a is None:
            raise KeyError(aid)
        a["module"] = p.parent.name  # the folder it's in is the truth
        return a

    def list(self, module: Optional[str] = None) -> List[dict]:
        if not self.dir.exists():
            return []
        out = []
        for p in sorted(self.dir.glob("*/*.json")):
            if module and p.parent.name != module:
                continue
            a = read_json(p, None)
            if isinstance(a, dict) and a.get("id") == p.stem:
                a["module"] = p.parent.name
                out.append(a)
        return out

    def delete(self, aid: str) -> None:
        p = self._find(aid)
        if p and p.exists():
            p.unlink()

    def add_draft(self, a: dict, text: str, feedback: str) -> None:
        a.setdefault("drafts", []).append({"text": text, "feedback": feedback, "ts": now()})
        self.save(a)

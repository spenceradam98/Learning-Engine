"""Back up and restore all your work as one file.

The file format is the same one the browser app uses, so a backup made here
can be restored in Chrome (Settings > Restore from a backup) and the other way round.
Your API key is never included.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, Optional

from . import config
from .storage import now, read_json, write_json

KEEP_AUTO_BACKUPS = 10
_SAFE = re.compile(r"^[a-z0-9-]{1,80}$")


def export_backup() -> dict:
    out = {"app": "learning-engine", "version": 1, "exported_at": now(),
           "questions": {}, "progress": {}, "assignments": {}}
    for folder, field in ((config.QUESTIONS_DIR, "questions"), (config.PROGRESS_DIR, "progress")):
        if folder.exists():
            for p in sorted(folder.glob("*.json")):
                data = read_json(p, None)
                if data is not None:
                    out[field][p.stem] = data
    if config.ASSIGNMENTS_DIR.exists():
        for p in sorted(config.ASSIGNMENTS_DIR.glob("*.json")):
            a = read_json(p, None)
            if isinstance(a, dict) and a.get("id") == p.stem:
                out["assignments"][p.stem] = a
    return out


def backup_dir() -> Path:
    return config.DATA_DIR / "backups"


def write_backup(folder: Optional[Path] = None, label: str = "backup") -> Path:
    folder = folder or backup_dir()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "learning-engine-{}-{}.json".format(label, now().replace(":", "-"))
    write_json(path, export_backup())
    return path


def auto_backup(folder: Optional[Path] = None) -> Optional[Path]:
    """Once a day, keep a copy of your work, keeping the newest few. Never raises."""
    try:
        folder = folder or backup_dir()
        today = now()[:10]
        if folder.exists() and any(folder.glob("learning-engine-auto-{}*.json".format(today))):
            return None
        data = export_backup()
        if not (data["questions"] or data["progress"] or data["assignments"]):
            return None
        path = write_backup(folder, "auto")
        autos = sorted(folder.glob("learning-engine-auto-*.json"))
        for old in autos[:-KEEP_AUTO_BACKUPS]:
            old.unlink()
        return path
    except OSError:
        return None


def restore_backup(path: Path) -> Dict[str, int]:
    """Merge a backup file into data/. Saves a safety copy of the current data first."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ValueError("That file isn't a Learning Engine backup.")
    if not isinstance(data, dict) or data.get("app") != "learning-engine":
        raise ValueError("That file isn't a Learning Engine backup.")
    write_backup(label="before-restore")
    counts = {"questions": 0, "topics": 0, "assignments": 0}
    for key, qs in (data.get("questions") or {}).items():
        if not _SAFE.match(key) or not isinstance(qs, list):
            continue
        p = config.QUESTIONS_DIR / "{}.json".format(key)
        mine = read_json(p, [])
        have = {q.get("id") for q in mine}
        for q in qs:
            if isinstance(q, dict) and q.get("id") and q["id"] not in have:
                mine.append(q)
                have.add(q["id"])
                counts["questions"] += 1
        write_json(p, mine)
    for key, prog in (data.get("progress") or {}).items():
        if not _SAFE.match(key) or not isinstance(prog, dict) or not isinstance(prog.get("history"), list):
            continue
        p = config.PROGRESS_DIR / "{}.json".format(key)
        mine = read_json(p, {"history": []})
        if len(prog["history"]) >= len(mine.get("history", [])):
            write_json(p, prog)
            counts["topics"] += 1
    for aid, a in (data.get("assignments") or {}).items():
        if _SAFE.match(aid) and isinstance(a, dict) and a.get("id") == aid and a.get("title"):
            write_json(config.ASSIGNMENTS_DIR / "{}.json".format(aid), a)
            counts["assignments"] += 1
    return counts

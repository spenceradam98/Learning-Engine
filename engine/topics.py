"""Resolve a topic key (built-in topic or an assignment) to name, subtopics and context."""
from __future__ import annotations

from typing import List, Optional

from . import config

ASSIGNMENT_PREFIX = "assignment-"


class TopicInfo:
    def __init__(self, key: str, name: str, subtopics: List[str], context: Optional[str] = None,
                 context_kind: str = "brief"):
        self.key = key
        self.name = name
        self.subtopics = subtopics or ["general"]
        self.context = context  # assignment brief, or a module's course notes
        self.context_kind = context_kind  # "brief" or "notes"


ALIASES = {
    "midi": "midi",
    "sound": "sound", "acoustics": "sound", "audio": "sound", "dsp": "sound",
    "psychoacoustics": "sound", "applied": "sound",
    "live": "live", "livesound": "live", "pa": "live",
}


def resolve(name: str) -> str:
    """Turn user input like 'Live sound' or 'midi' into a topic key. Raises KeyError."""
    raw = (name or "").strip().lower()
    if raw.startswith(ASSIGNMENT_PREFIX):
        return raw
    mods = saved_modules()
    if raw in mods:
        return raw
    for key, m in mods.items():  # a module brought in from the browser, by its name
        if isinstance(m, dict) and str(m.get("name", "")).strip().lower() == raw:
            return key
    squashed = raw.replace(" ", "").replace("-", "").replace("_", "")
    if squashed in ALIASES:
        return ALIASES[squashed]
    for word in raw.replace("-", " ").split():
        if word in ALIASES:
            return ALIASES[word]
    raise KeyError(name)


def modules_file():
    return config.DATA_DIR / "modules.json"


def saved_modules() -> dict:
    """Modules brought in from the browser app's backup ({key: {name, subtopics, notes, ...}})."""
    from .storage import read_json
    data = read_json(modules_file(), {})
    return data if isinstance(data, dict) else {}


# The starter modules the browser app creates, so their folders get the same names here.
STARTER_NAMES = {"general": "General", "music-business": "Music business and marketing",
                 "creative-labs": "Creative project labs", "composition": "Music composition"}


def module_name(key: str) -> str:
    """A readable name for a module folder."""
    if key in config.TOPICS:
        return config.TOPICS[key]["name"]
    if key in STARTER_NAMES and key not in saved_modules():
        return STARTER_NAMES[key]
    m = saved_modules().get(key)
    if isinstance(m, dict) and m.get("name"):
        return str(m["name"])
    return "General" if key == "general" else key.replace("-", " ").capitalize()


def get(key: str) -> TopicInfo:
    if key in config.TOPICS:
        t = config.TOPICS[key]
        return TopicInfo(key, t["name"], list(t["subtopics"]))
    if key.startswith(ASSIGNMENT_PREFIX):
        from .assignments import AssignmentStore  # avoid import cycle
        a = AssignmentStore().get(key[len(ASSIGNMENT_PREFIX):])
        concepts = [c["name"] for c in a.get("concepts") or []]
        return TopicInfo(key, "Assignment: " + a["title"], concepts or ["key ideas in the brief"],
                         context=a["brief_text"])
    m = saved_modules().get(key)
    if isinstance(m, dict) and m.get("name"):
        subs = [str(x) for x in (m.get("subtopics") or []) if str(x).strip()]
        context = "\n\n".join(str(x) for x in (m.get("description"), m.get("notes")) if x) or None
        return TopicInfo(key, str(m["name"]), subs or ["key ideas of " + str(m["name"])], context=context,
                         context_kind="notes")
    raise KeyError(key)

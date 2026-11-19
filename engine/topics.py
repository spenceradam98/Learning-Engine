"""Resolve a topic key (built-in topic or an assignment) to name, subtopics and context."""
from __future__ import annotations

from typing import List, Optional

from . import config

ASSIGNMENT_PREFIX = "assignment-"


class TopicInfo:
    def __init__(self, key: str, name: str, subtopics: List[str], context: Optional[str] = None):
        self.key = key
        self.name = name
        self.subtopics = subtopics or ["general"]
        self.context = context  # assignment brief, if any


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
    squashed = raw.replace(" ", "").replace("-", "").replace("_", "")
    if squashed in ALIASES:
        return ALIASES[squashed]
    for word in raw.replace("-", " ").split():
        if word in ALIASES:
            return ALIASES[word]
    raise KeyError(name)


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
    raise KeyError(key)

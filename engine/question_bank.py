"""Stores generated questions per topic and picks the next one for a quiz."""
from __future__ import annotations

import random
import re
import uuid
from typing import Dict, Iterable, List, Optional

from . import config
from .storage import now, read_json, write_json


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def _strip_letter(choice: str) -> str:
    # Models often prefix choices with "A) " or "B. " even when told not to.
    return re.sub(r"^\s*[A-Da-d][\).:]\s+", "", choice).strip()


def validate_question(obj: object) -> dict:
    """Check a model-made question. Returns a cleaned dict or raises ValueError."""
    if not isinstance(obj, dict):
        raise ValueError("expected a JSON object")
    if "questions" in obj and isinstance(obj["questions"], list) and obj["questions"]:
        obj = obj["questions"][0]
        if not isinstance(obj, dict):
            raise ValueError("expected a JSON object")
    q = str(obj.get("question", "")).strip()
    choices = obj.get("choices") or obj.get("options")
    if len(q) < 10:
        raise ValueError("question text missing or too short")
    if not isinstance(choices, list) or len(choices) != 4:
        raise ValueError("need exactly 4 choices")
    choices = [_strip_letter(str(c)) for c in choices]
    if any(not c for c in choices):
        raise ValueError("a choice is empty")
    if len({_norm(c) for c in choices}) != 4:
        raise ValueError("choices must all be different")
    ans = obj.get("answer_index", obj.get("answer"))
    if isinstance(ans, str):
        s = ans.strip()
        if len(s) == 1 and s.upper() in "ABCD":
            ans = "ABCD".index(s.upper())
        elif s.isdigit():
            ans = int(s)
        else:
            matches = [i for i, c in enumerate(choices) if _norm(c) == _norm(_strip_letter(s))]
            ans = matches[0] if matches else None
    if isinstance(ans, bool) or not isinstance(ans, int) or not 0 <= ans <= 3:
        raise ValueError("answer_index must be 0-3")
    explanation = str(obj.get("explanation", "")).strip()
    if not explanation:
        raise ValueError("explanation missing")
    return {"question": q, "choices": choices, "answer_index": ans, "explanation": explanation}


class QuestionBank:
    def __init__(self, topic_key: str):
        self.topic_key = topic_key
        self.path = config.QUESTIONS_DIR / "{}.json".format(topic_key)
        self.questions: List[dict] = read_json(self.path, [])

    def save(self) -> None:
        write_json(self.path, self.questions)

    def __len__(self) -> int:
        return len(self.questions)

    def by_id(self, qid: str) -> Optional[dict]:
        for q in self.questions:
            if q["id"] == qid:
                return q
        return None

    def is_duplicate(self, text: str) -> bool:
        n = _norm(text)
        return any(_norm(q["question"]) == n for q in self.questions)

    def add(self, cleaned: dict, subtopic: str, difficulty: int, source: str = "generated") -> Optional[dict]:
        """Add a validated question. Returns it, or None if it's a duplicate."""
        if self.is_duplicate(cleaned["question"]):
            return None
        q = dict(cleaned)
        q.update({
            "id": uuid.uuid4().hex[:10],
            "topic": self.topic_key,
            "subtopic": subtopic,
            "difficulty": int(difficulty),
            "type": "mcq",
            "source": source,
            "created_at": now(),
        })
        self.questions.append(q)
        self.save()
        return q

    def recent_texts(self, subtopic: Optional[str] = None, limit: int = 8) -> List[str]:
        qs = [q for q in self.questions if subtopic is None or q.get("subtopic") == subtopic]
        return [q["question"] for q in qs[-limit:]]

    def counts_by_difficulty(self) -> Dict[int, int]:
        out = {d: 0 for d in range(config.DIFFICULTY_MIN, config.DIFFICULTY_MAX + 1)}
        for q in self.questions:
            out[q["difficulty"]] = out.get(q["difficulty"], 0) + 1
        return out

    def pick(self, difficulty: int, exclude: Iterable[str], qstats: Dict[str, dict],
             mastery: Dict[str, float], rng: Optional[random.Random] = None) -> Optional[dict]:
        """Choose the next question near `difficulty`.

        Order of preference at the target level: questions you've never seen,
        then ones you got wrong last time, then anything not asked this session.
        If the level is empty, try one level either side. Within a group, weak
        subtopics are more likely to be picked.
        """
        rng = rng or random.Random()
        excluded = set(exclude)
        for spread in (0, 1):
            pool = [q for q in self.questions
                    if abs(q["difficulty"] - difficulty) <= spread and q["id"] not in excluded]
            if not pool:
                continue
            unseen = [q for q in pool if q["id"] not in qstats]
            missed = [q for q in pool if qstats.get(q["id"], {}).get("last_correct") is False]
            # Now and then, revisit something you got wrong before new material.
            order = (missed, unseen, pool) if missed and rng.random() < 0.3 else (unseen, missed, pool)
            for group in order:
                if group:
                    weights = [1.2 - mastery.get(q.get("subtopic", ""), 0.5) for q in group]
                    return rng.choices(group, weights=weights, k=1)[0]
        return None

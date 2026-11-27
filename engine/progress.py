"""Per-topic progress: answer history, streaks, difficulty and confidence scores."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List, Optional

from . import adaptive, config
from .storage import now, read_json, write_json

# How much one answer says about your mastery, by (correct, confidence 1-3).
# Wrong-but-sure is the strongest warning sign; right-but-guessing counts for less.
ANSWER_SCORE = {
    (True, 3): 1.0, (True, 2): 0.85, (True, 1): 0.6,
    (False, 1): 0.3, (False, 2): 0.15, (False, 3): 0.0,
}
MASTERY_PRIOR = 0.5   # starting guess before any answers
MASTERY_ALPHA = 0.35  # weight of the newest answer (moving average)
HISTORY_LIMIT = 2000

# Spaced repetition (Leitner boxes). Each right answer moves a question up a
# box and pushes its next review further away; a wrong answer sends it back
# to box 1, due again straight away.
REVIEW_INTERVAL_DAYS = {1: 1, 2: 3, 3: 7, 4: 14, 5: 30}


def schedule(stats: dict, correct: bool, today: Optional[date] = None) -> None:
    """Update a question's review box and due date in place."""
    today = today or date.today()
    if correct:
        box = min(5, int(stats.get("box", 0)) + 1)
        due = today + timedelta(days=REVIEW_INTERVAL_DAYS[box])
    else:
        box = 1
        due = today
    stats["box"] = box
    stats["due"] = due.isoformat()


def is_due(stats: dict, today: Optional[date] = None) -> bool:
    today = (today or date.today()).isoformat()
    if "due" in stats:
        return stats["due"] <= today
    # Answered before reviews existed: bring back the ones you got wrong.
    return stats.get("last_correct") is False


def answer_score(correct: bool, confidence: int) -> float:
    confidence = min(3, max(1, int(confidence)))
    return ANSWER_SCORE[(bool(correct), confidence)]


def blank() -> dict:
    return {
        "current_difficulty": config.DIFFICULTY_START,
        "streak": {"correct": 0, "wrong": 0},
        "history": [],
        "subtopic_stats": {},
        "question_stats": {},
    }


class Progress:
    def __init__(self, topic_key: str):
        self.topic_key = topic_key
        self.path = config.PROGRESS_DIR / "{}.json".format(topic_key)
        data = read_json(self.path, blank())
        base = blank()
        base.update(data)
        self.data = base

    def save(self) -> None:
        write_json(self.path, self.data)

    @property
    def difficulty(self) -> int:
        return int(self.data["current_difficulty"])

    def record(self, question: dict, chosen: Optional[int], confidence: int,
               adapt: bool = True) -> adaptive.Decision:
        """Log an answer, update mastery, review schedule and (if `adapt`) difficulty."""
        correct = chosen is not None and chosen == question["answer_index"]
        d = self.data
        d["history"].append({
            "question_id": question["id"],
            "subtopic": question.get("subtopic", "general"),
            "difficulty": question.get("difficulty", self.difficulty),
            "chosen": chosen,
            "correct": correct,
            "confidence": confidence,
            "ts": now(),
        })
        del d["history"][:-HISTORY_LIMIT]

        sub = question.get("subtopic", "general")
        s = d["subtopic_stats"].setdefault(sub, {"seen": 0, "correct": 0, "mastery": MASTERY_PRIOR})
        s["seen"] += 1
        s["correct"] += int(correct)
        s["mastery"] = round((1 - MASTERY_ALPHA) * s["mastery"]
                             + MASTERY_ALPHA * answer_score(correct, confidence), 4)
        s["last_seen"] = now()

        q = d["question_stats"].setdefault(question["id"], {"seen": 0, "correct": 0})
        q["seen"] += 1
        q["correct"] += int(correct)
        q["last_correct"] = correct
        # Being right on a guess doesn't prove you know it yet.
        schedule(q, correct and confidence >= 2)

        if not adapt:  # review sessions don't move your level
            self.save()
            return adaptive.Decision(self.difficulty, d["streak"]["correct"],
                                     d["streak"]["wrong"], None, False)
        dec = adaptive.update(self.difficulty, d["streak"]["correct"], d["streak"]["wrong"], correct)
        d["current_difficulty"] = dec.difficulty
        d["streak"] = {"correct": dec.correct_streak, "wrong": dec.wrong_streak}
        self.save()
        return dec

    def weak_spots(self, threshold: float = config.WEAK_THRESHOLD) -> List[dict]:
        rows = []
        for sub, s in self.data["subtopic_stats"].items():
            if s["seen"] and s["mastery"] < threshold:
                rows.append({"subtopic": sub, "mastery": s["mastery"], "seen": s["seen"],
                             "correct": s["correct"]})
        rows.sort(key=lambda r: r["mastery"])
        return rows

    def all_subtopics(self) -> List[dict]:
        rows = [{"subtopic": k, **v} for k, v in self.data["subtopic_stats"].items()]
        rows.sort(key=lambda r: r["mastery"])
        return rows

    def recent_misses(self, limit: int = 8) -> List[str]:
        """Question ids answered wrong most recently (newest first, unique)."""
        out: List[str] = []
        for h in reversed(self.data["history"]):
            if not h["correct"] and h["question_id"] not in out:
                out.append(h["question_id"])
            if len(out) >= limit:
                break
        return out

    def due_ids(self, today: Optional[date] = None) -> List[str]:
        """Questions due for spaced-repetition review, most overdue first."""
        rows = [(s.get("due", ""), qid) for qid, s in self.data["question_stats"].items()
                if is_due(s, today)]
        rows.sort()
        return [qid for _, qid in rows]

    def question_stats(self) -> Dict[str, dict]:
        return self.data["question_stats"]

    def totals(self) -> dict:
        h = self.data["history"]
        right = sum(1 for x in h if x["correct"])
        return {"answered": len(h), "correct": right,
                "accuracy": (right / len(h)) if h else 0.0,
                "difficulty": self.difficulty}

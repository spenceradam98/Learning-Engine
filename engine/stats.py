"""Your study streak, today's count and reviews due, across every topic."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable, List, Optional, Set

from . import config, review, topics
from .progress import Progress
from .question_bank import QuestionBank


def streak(days: Iterable[date], today: Optional[date] = None) -> int:
    """Days in a row you've studied, ending today (or yesterday, so it isn't lost before you start)."""
    today = today or date.today()
    have: Set[date] = set(days)
    d = today if today in have else today - timedelta(days=1)
    n = 0
    while d in have:
        n += 1
        d -= timedelta(days=1)
    return n


def due_by_topic(today: Optional[date] = None) -> List[dict]:
    """Topics with questions due for review (only questions still in the bank)."""
    rows = []
    for key in review.topic_keys_with_progress():
        bank = QuestionBank(key)
        ids = [qid for qid in Progress(key).due_ids(today) if bank.by_id(qid)]
        if not ids:
            continue
        try:
            name = topics.get(key).name
        except KeyError:
            continue  # assignment was deleted
        rows.append({"key": key, "name": name, "due": len(ids)})
    return rows


def summary(today: Optional[date] = None) -> dict:
    today = today or date.today()
    days: Set[date] = set()
    answered_today = 0
    if config.PROGRESS_DIR.exists():
        for key in review.topic_keys_with_progress():
            for h in Progress(key).data["history"]:
                try:
                    d = date(*map(int, h["ts"][:10].split("-")))
                except (KeyError, ValueError, TypeError):
                    continue
                days.add(d)
                if d == today:
                    answered_today += 1
    due = due_by_topic(today)
    return {
        "streak": streak(days, today),
        "studied_today": today in days,
        "answered_today": answered_today,
        "days_studied": len(days),
        "due_total": sum(r["due"] for r in due),
        "due": due,
    }

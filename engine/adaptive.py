"""Difficulty rules. Pure logic with no I/O, so it's easy to test.

- 3 correct in a row  -> difficulty up by 1 (max 5)
- 2 wrong in a row    -> difficulty down by 1 (min 1) and re-explain the concept
"""
from __future__ import annotations

from typing import NamedTuple, Optional

from . import config


class Decision(NamedTuple):
    difficulty: int
    correct_streak: int
    wrong_streak: int
    change: Optional[str]  # "up", "down" or None
    reexplain: bool


def update(difficulty: int, correct_streak: int, wrong_streak: int, correct: bool,
           up_after: int = config.CORRECT_STREAK_TO_LEVEL_UP,
           down_after: int = config.WRONG_STREAK_TO_LEVEL_DOWN,
           lo: int = config.DIFFICULTY_MIN, hi: int = config.DIFFICULTY_MAX) -> Decision:
    if correct:
        correct_streak += 1
        wrong_streak = 0
        if correct_streak >= up_after:
            new = min(hi, difficulty + 1)
            return Decision(new, 0, 0, "up" if new != difficulty else None, False)
        return Decision(difficulty, correct_streak, 0, None, False)

    wrong_streak += 1
    correct_streak = 0
    if wrong_streak >= down_after:
        new = max(lo, difficulty - 1)
        # Always re-explain after a wrong streak, even if already at the easiest level.
        return Decision(new, 0, 0, "down" if new != difficulty else None, True)
    return Decision(difficulty, 0, wrong_streak, None, False)

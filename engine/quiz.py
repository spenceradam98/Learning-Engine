"""Quiz session logic shared by the terminal and the browser UI."""
from __future__ import annotations

import random
from typing import Iterator, List, Optional

from . import generator, prompts, topics
from .llm_client import LLMClient
from .progress import Progress
from .question_bank import QuestionBank


class QuizSession:
    def __init__(self, topic_key: str, llm: Optional[LLMClient] = None, length: int = 10,
                 rng: Optional[random.Random] = None):
        self.topic_key = topic_key
        self.info = topics.get(topic_key)
        self.llm = llm or LLMClient()
        self.length = length
        self.bank = QuestionBank(topic_key)
        self.progress = Progress(topic_key)
        self.rng = rng or random.Random()
        self.asked: List[str] = []
        self.results: List[dict] = []
        self.current: Optional[dict] = None
        self.last_wrong: Optional[dict] = None  # (question, chosen) for re-explaining
        self.start_difficulty = self.progress.difficulty

    @property
    def finished(self) -> bool:
        return len(self.results) >= self.length

    @property
    def difficulty(self) -> int:
        return self.progress.difficulty

    def _mastery(self) -> dict:
        return {k: v["mastery"] for k, v in self.progress.data["subtopic_stats"].items()}

    def next_question(self, allow_generate: bool = True) -> Optional[dict]:
        """Pick the next question at the current difficulty.

        If the bank has nothing suitable, make one with the LLM (can raise LLMError).
        Returns None when the quiz is over or nothing could be found.
        """
        if self.finished:
            return None
        q = self.bank.pick(self.difficulty, self.asked, self.progress.question_stats(),
                           self._mastery(), self.rng)
        if q is None and allow_generate:
            # Aim new questions at the weakest subtopic, or any if no history yet.
            weak = self.progress.weak_spots()
            subs = [w["subtopic"] for w in weak if w["subtopic"] in self.info.subtopics]
            sub = subs[0] if subs else self.rng.choice(self.info.subtopics)
            q = generator.generate_one(self.llm, self.bank, self.info, sub, self.difficulty,
                                       source="generated")
        self.current = q
        return q

    def answer(self, chosen: Optional[int], confidence: int) -> dict:
        q = self.current
        if q is None:
            raise RuntimeError("no current question")
        before = self.difficulty
        dec = self.progress.record(q, chosen, confidence)
        correct = chosen is not None and chosen == q["answer_index"]
        self.asked.append(q["id"])
        result = {
            "question_id": q["id"],
            "correct": correct,
            "chosen": chosen,
            "answer_index": q["answer_index"],
            "explanation": q["explanation"],
            "difficulty_before": before,
            "difficulty": dec.difficulty,
            "change": dec.change,
            "reexplain": dec.reexplain,
        }
        self.results.append(result)
        self.last_wrong = {"question": q, "chosen": chosen} if not correct else None
        self.current = None
        return result

    def reexplain_stream(self) -> Iterator[str]:
        if not self.last_wrong:
            return iter(())
        msgs = prompts.reexplain_messages(self.last_wrong["question"], self.last_wrong["chosen"])
        return self.llm.stream(msgs, temperature=0.6, max_tokens=450)

    def summary(self) -> dict:
        right = sum(1 for r in self.results if r["correct"])
        return {
            "answered": len(self.results),
            "correct": right,
            "start_difficulty": self.start_difficulty,
            "end_difficulty": self.difficulty,
            "weak_spots": self.progress.weak_spots()[:3],
        }

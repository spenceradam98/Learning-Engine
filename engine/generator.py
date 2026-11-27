"""Creates new questions with the LLM, one at a time (reliable on small models)."""
from __future__ import annotations

from typing import Callable, List, Optional

from . import config, prompts, topics
from .llm_client import LLMClient, LLMError
from .progress import Progress
from .question_bank import QuestionBank, validate_question

# on_progress(done, total, message)
ProgressFn = Callable[[int, int, str], None]


def plan_difficulties(n: int, centre: int) -> List[int]:
    """Spread questions around your current level: mostly at it, some either side."""
    pattern = [0, 0, 1, 0, -1, 1, 0, 0, -1, 1]
    out = []
    for i in range(n):
        d = centre + pattern[i % len(pattern)]
        out.append(max(config.DIFFICULTY_MIN, min(config.DIFFICULTY_MAX, d)))
    return out


def generate_one(llm: LLMClient, bank: QuestionBank, info: topics.TopicInfo,
                 subtopic: str, difficulty: int, source: str = "generated") -> Optional[dict]:
    """Make and store one question. Returns None if it came out as a duplicate."""
    msgs = prompts.question_messages(info.name, subtopic, difficulty,
                                     avoid=bank.recent_texts(subtopic, 6), context=info.context,
                                     context_kind=info.context_kind)
    cleaned = llm.chat_json(msgs, prompts.QUESTION_SCHEMA, validate_question,
                            temperature=0.6, max_tokens=500)
    return bank.add(cleaned, subtopic, difficulty, source=source)


def generate(topic_key: str, n: int = 10, llm: Optional[LLMClient] = None,
             difficulty: Optional[int] = None, subtopic: Optional[str] = None,
             on_progress: Optional[ProgressFn] = None) -> dict:
    llm = llm or LLMClient()
    info = topics.get(topic_key)
    bank = QuestionBank(topic_key)
    centre = difficulty or Progress(topic_key).difficulty
    levels = [difficulty] * n if difficulty else plan_difficulties(n, centre)
    source = "assignment:" + topic_key[len(topics.ASSIGNMENT_PREFIX):] \
        if topic_key.startswith(topics.ASSIGNMENT_PREFIX) else "generated"

    added, failed, dupes = [], 0, 0
    for i in range(n):
        if subtopic:
            sub = subtopic
        else:
            # Favour subtopics with the fewest questions so coverage stays even.
            counts = {s: 0 for s in info.subtopics}
            for q in bank.questions:
                if q.get("subtopic") in counts:
                    counts[q["subtopic"]] += 1
            sub = min(info.subtopics, key=lambda s: (counts[s], info.subtopics.index(s)))
        if on_progress:
            on_progress(i, n, "{} (level {})".format(sub, levels[i]))
        try:
            q = generate_one(llm, bank, info, sub, levels[i], source)
        except LLMError as e:
            failed += 1
            if any(w in str(e) for w in ("reach", "key", "rate limit", "overloaded", "model '")):
                raise  # no point continuing if the model is unreachable
            continue
        if q is None:
            dupes += 1
        else:
            added.append(q)
    if on_progress:
        on_progress(n, n, "done")
    return {"added": added, "failed": failed, "duplicates": dupes, "total_in_bank": len(bank)}

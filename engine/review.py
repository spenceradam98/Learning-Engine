"""'Review weak spots': what you're shakiest on, plus an optional LLM study plan."""
from __future__ import annotations

from typing import Iterator, List, Optional

from . import config, prompts, topics
from .llm_client import LLMClient
from .progress import Progress
from .question_bank import QuestionBank


def topic_keys_with_progress() -> List[str]:
    if not config.PROGRESS_DIR.exists():
        return []
    return sorted(p.stem for p in config.PROGRESS_DIR.glob("*.json"))


def report(topic_key: str) -> dict:
    prog = Progress(topic_key)
    bank = QuestionBank(topic_key)
    misses = []
    for qid in prog.recent_misses():
        q = bank.by_id(qid)
        if q:
            misses.append({"question": q["question"], "answer": q["choices"][q["answer_index"]],
                           "subtopic": q.get("subtopic", "")})
    try:
        name = topics.get(topic_key).name
    except KeyError:
        name = topic_key
    return {
        "topic": topic_key,
        "name": name,
        "totals": prog.totals(),
        "subtopics": prog.all_subtopics(),
        "weak": prog.weak_spots(),
        "misses": misses,
    }


def study_plan_stream(rep: dict, llm: Optional[LLMClient] = None) -> Iterator[str]:
    llm = llm or LLMClient()
    weak = rep["weak"] or rep["subtopics"][:3]
    msgs = prompts.weak_spots_messages(rep["name"], weak, [m["question"] for m in rep["misses"]])
    return llm.stream(msgs, temperature=0.5, max_tokens=500)

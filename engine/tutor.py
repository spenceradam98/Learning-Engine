"""Learning and writing coaching for assignments. Coaching only: it never
writes the assignment for you (see prompts.COACH_SYSTEM)."""
from __future__ import annotations

from typing import Iterator, List, Optional

from . import prompts
from .assignments import AssignmentStore
from .llm_client import LLMClient, Message


def _validate_concepts(obj: object) -> List[dict]:
    items = obj.get("concepts") if isinstance(obj, dict) else obj
    if not isinstance(items, list):
        raise ValueError("expected a list of concepts")
    out = []
    for it in items:
        if isinstance(it, str) and it.strip():
            out.append({"name": it.strip(), "why": ""})
        elif isinstance(it, dict) and str(it.get("name", "")).strip():
            out.append({"name": str(it["name"]).strip(), "why": str(it.get("why", "")).strip()})
    if len(out) < 2:
        raise ValueError("need at least 2 concepts")
    return out[:8]


class Tutor:
    def __init__(self, llm: Optional[LLMClient] = None, store: Optional[AssignmentStore] = None):
        self.llm = llm or LLMClient()
        self.store = store or AssignmentStore()

    def concepts(self, a: dict, refresh: bool = False) -> List[dict]:
        """Key concepts the assignment needs. Asked once, then cached with the assignment."""
        if a.get("concepts") and not refresh:
            return a["concepts"]
        a["concepts"] = self.llm.chat_json(prompts.concepts_messages(a), prompts.CONCEPTS_SCHEMA,
                                           _validate_concepts, temperature=0.3, max_tokens=500)
        self.store.save(a)
        return a["concepts"]

    def learn_stream(self, a: dict, concept: dict) -> Iterator[str]:
        return self.llm.stream(prompts.learn_messages(a, concept), temperature=0.6, max_tokens=600)

    def followup_stream(self, a: dict, concept: dict, history: List[Message],
                        question: str) -> Iterator[str]:
        return self.llm.stream(prompts.followup_messages(a, concept, history, question),
                               temperature=0.6, max_tokens=450)

    def outline_stream(self, a: dict) -> Iterator[str]:
        return self.llm.stream(prompts.outline_messages(a), temperature=0.5, max_tokens=700)

    def save_outline(self, a: dict, text: str) -> None:
        a["outline"] = text
        self.store.save(a)

    def hint_stream(self, a: dict, stuck_on: str) -> Iterator[str]:
        return self.llm.stream(prompts.hint_messages(a, stuck_on), temperature=0.6, max_tokens=400)

    def feedback_stream(self, a: dict, draft: str) -> Iterator[str]:
        return self.llm.stream(prompts.feedback_messages(a, draft), temperature=0.4, max_tokens=800)

    def save_feedback(self, a: dict, draft: str, feedback: str) -> None:
        self.store.add_draft(a, draft, feedback)

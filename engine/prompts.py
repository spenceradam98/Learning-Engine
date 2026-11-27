"""Every prompt the engine sends, kept short so small local models cope."""
from __future__ import annotations

from typing import List, Optional

from . import config
from .llm_client import Message

TUTOR_SYSTEM = (
    "You are a patient, accurate tutor for a music technology student. "
    "Explain clearly with concrete examples from studios, DAWs and live gigs. "
    "Be concise. Use short paragraphs or bullet points."
)

COACH_SYSTEM = (
    "You are a writing coach for a college student. Your job is to help the student "
    "learn and write their OWN assignment. You must NEVER write any part of the "
    "assignment for them: no finished paragraphs, no sample essays, no rewritten "
    "versions of their text. Instead you explain concepts, ask guiding questions, "
    "suggest structure as headings with notes, point out problems, and give hints. "
    "If asked to write the assignment, kindly refuse and offer coaching instead."
)

QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "choices": {"type": "array", "items": {"type": "string"}, "minItems": 4, "maxItems": 4},
        "answer_index": {"type": "integer", "minimum": 0, "maximum": 3},
        "explanation": {"type": "string"},
    },
    "required": ["question", "choices", "answer_index", "explanation"],
}

CONCEPTS_SCHEMA = {
    "type": "object",
    "properties": {
        "concepts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "why": {"type": "string"}},
                "required": ["name", "why"],
            },
            "minItems": 2,
            "maxItems": 8,
        }
    },
    "required": ["concepts"],
}

_EXAMPLE = (
    '{"question": "Which MIDI message tells a synth to start playing a note?", '
    '"choices": ["Note On", "Program Change", "Control Change", "Pitch Bend"], '
    '"answer_index": 0, '
    '"explanation": "A Note On message carries the note number and velocity and starts the note. '
    'The others change sounds, controls or pitch."}'
)


def trim(text: str, limit: int = config.MAX_CONTEXT_CHARS) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "\n[...trimmed to fit the model...]"


def question_messages(topic_name: str, subtopic: str, difficulty: int,
                      avoid: List[str], context: Optional[str] = None) -> List[Message]:
    level = config.DIFFICULTY_LABELS.get(difficulty, "")
    parts = [
        "Write ONE multiple-choice quiz question.",
        "Topic: {}".format(topic_name),
        "Focus: {}".format(subtopic),
        "Difficulty {}/5 ({}).".format(difficulty, level),
    ]
    if context:
        parts.append("Base the question on this assignment brief:\n\"\"\"\n{}\n\"\"\"".format(
            trim(context, 2500)))
    if avoid:
        parts.append("Do NOT repeat these existing questions:\n- " + "\n- ".join(a[:120] for a in avoid))
    parts += [
        "Rules: exactly 4 choices, exactly one correct, wrong choices must be plausible, "
        "no 'all of the above'. answer_index is 0-3. Explanation is 1-3 sentences and says "
        "why the answer is right.",
        "Reply with ONLY a JSON object like this example:",
        _EXAMPLE,
    ]
    return [
        {"role": "system", "content": "You write accurate exam questions. You reply only with JSON."},
        {"role": "user", "content": "\n".join(parts)},
    ]


def reexplain_messages(question: dict, chosen: Optional[int]) -> List[Message]:
    letters = "ABCD"
    choices = "\n".join("{}. {}".format(letters[i], c) for i, c in enumerate(question["choices"]))
    picked = question["choices"][chosen] if chosen is not None else "(no answer)"
    right = question["choices"][question["answer_index"]]
    return [
        {"role": "system", "content": TUTOR_SYSTEM},
        {"role": "user", "content": (
            "I'm struggling with {sub}. I just got this wrong.\n\nQuestion: {q}\n{c}\n\n"
            "I answered: {picked}\nCorrect answer: {right}\n\n"
            "Re-teach the underlying concept from scratch in simple terms (under 200 words): "
            "1) the core idea, 2) why my answer was tempting but wrong, 3) a real-world example, "
            "4) one memory tip."
        ).format(sub=question.get("subtopic", "this"), q=question["question"], c=choices,
                 picked=picked, right=right)},
    ]


def weak_spots_messages(topic_name: str, weak: List[dict], misses: List[str]) -> List[Message]:
    lines = ["- {} (mastery {:.0%}, {} answered)".format(w["subtopic"], w["mastery"], w["seen"])
             for w in weak]
    miss = "\n".join("- " + m[:150] for m in misses) or "- none recorded"
    return [
        {"role": "system", "content": TUTOR_SYSTEM},
        {"role": "user", "content": (
            "Topic: {t}\nMy weakest areas:\n{w}\n\nQuestions I recently got wrong:\n{m}\n\n"
            "Give me a short study plan (under 250 words): for each weak area, the key idea I "
            "am probably missing and one practical exercise I can do (in a DAW or with real gear)."
        ).format(t=topic_name, w="\n".join(lines), m=miss)},
    ]


# --- assignments ---------------------------------------------------------------

def _brief_block(a: dict) -> str:
    out = "Assignment: {}\n".format(a["title"])
    if a.get("course"):
        out += "Course: {}\n".format(a["course"])
    out += "Brief:\n\"\"\"\n{}\n\"\"\"\n".format(trim(a["brief_text"]))
    if a.get("rubric_text"):
        out += "Marking rubric:\n\"\"\"\n{}\n\"\"\"\n".format(trim(a["rubric_text"], 2000))
    return out


def concepts_messages(a: dict) -> List[Message]:
    return [
        {"role": "system", "content": "You analyse assignment briefs. You reply only with JSON."},
        {"role": "user", "content": _brief_block(a) + (
            "\nList the 3-6 key concepts or skills the student must understand to do this "
            "assignment well. Reply ONLY with JSON like: "
            '{"concepts": [{"name": "Gain staging", "why": "The brief asks you to set up a '
            'mixer signal chain without clipping."}]}'
        )},
    ]


def learn_messages(a: dict, concept: dict) -> List[Message]:
    return [
        {"role": "system", "content": TUTOR_SYSTEM},
        {"role": "user", "content": _brief_block(a) + (
            "\nTeach me the concept \"{n}\" ({w}). Under 300 words: explain the idea, give a "
            "concrete example, show how it connects to this assignment, and end with two "
            "questions I should be able to answer before I start writing."
        ).format(n=concept["name"], w=concept.get("why", ""))},
    ]


def followup_messages(a: dict, concept: dict, history: List[Message], question: str) -> List[Message]:
    msgs = [{"role": "system", "content": TUTOR_SYSTEM + " The student is studying \"{}\" for "
             "the assignment \"{}\".".format(concept["name"], a["title"])}]
    msgs += history[-6:]
    msgs.append({"role": "user", "content": question})
    return msgs


def outline_messages(a: dict) -> List[Message]:
    return [
        {"role": "system", "content": COACH_SYSTEM},
        {"role": "user", "content": _brief_block(a) + (
            "\nHelp me plan my answer. Give a suggested structure as section headings only. "
            "Under each heading list: what that section needs to achieve, 2-3 guiding questions "
            "I should answer in my own words, and which rubric points it covers. Do not write "
            "any sentences of the assignment itself."
        )},
    ]


def hint_messages(a: dict, stuck_on: str) -> List[Message]:
    return [
        {"role": "system", "content": COACH_SYSTEM},
        {"role": "user", "content": _brief_block(a) + (
            "\nI'm stuck on this part: {s}\n\nGive me hints and guiding questions to get "
            "unstuck, without writing it for me. Under 200 words."
        ).format(s=stuck_on)},
    ]


def feedback_messages(a: dict, draft: str) -> List[Message]:
    return [
        {"role": "system", "content": COACH_SYSTEM},
        {"role": "user", "content": _brief_block(a) + (
            "\nHere is my draft:\n\"\"\"\n{d}\n\"\"\"\n\n"
            "Give feedback like a tutor marking against the brief and rubric:\n"
            "1. What is working well\n2. What is missing or weak, mapped to rubric points\n"
            "3. Accuracy problems (wrong facts or terms)\n4. Three specific things to improve "
            "next, as instructions or questions\n"
            "Quote at most a few words of my draft to point at things. Do NOT rewrite my "
            "sentences or give replacement text."
        ).format(d=trim(draft, 4000))},
    ]

import json
import random
import unittest

from engine import config
from engine.progress import Progress, answer_score
from engine.question_bank import QuestionBank, validate_question
from tests.helpers import TempDataTest


def q(qid="q1", sub="EQ and filters", diff=2, ans=0):
    return {"id": qid, "subtopic": sub, "difficulty": diff, "answer_index": ans,
            "question": "Question " + qid, "choices": ["a", "b", "c", "d"], "explanation": "x"}


class ProgressTests(TempDataTest):
    def test_record_saves_and_reloads(self):
        p = Progress("sound")
        p.record(q(), 0, 3)
        p2 = Progress("sound")
        self.assertEqual(len(p2.data["history"]), 1)
        self.assertTrue(p2.data["history"][0]["correct"])
        self.assertEqual(p2.data["subtopic_stats"]["EQ and filters"]["seen"], 1)

    def test_file_is_valid_json(self):
        Progress("midi").record(q(), 1, 2)
        data = json.loads((config.PROGRESS_DIR / "midi.json").read_text())
        self.assertIn("current_difficulty", data)

    def test_confident_wrong_hurts_more_than_unsure_wrong(self):
        self.assertLess(answer_score(False, 3), answer_score(False, 1))
        self.assertLess(answer_score(True, 1), answer_score(True, 3))

    def test_difficulty_follows_adaptive_rules(self):
        p = Progress("live")
        for i in range(3):
            p.record(q("c{}".format(i)), 0, 2)
        self.assertEqual(p.difficulty, 3)
        p.record(q("w1"), 1, 2)
        dec = p.record(q("w2"), 2, 2)
        self.assertEqual(p.difficulty, 2)
        self.assertTrue(dec.reexplain)

    def test_weak_spots_sorted_weakest_first(self):
        p = Progress("sound")
        p.record(q("a", sub="phase"), 1, 3)
        p.record(q("b", sub="phase"), 1, 3)
        p.record(q("c", sub="EQ"), 1, 1)
        p.record(q("d", sub="decibels"), 0, 3)
        weak = p.weak_spots()
        self.assertEqual([w["subtopic"] for w in weak], ["phase", "EQ"])

    def test_recent_misses_unique_newest_first(self):
        p = Progress("sound")
        for qid, chosen in [("a", 1), ("b", 1), ("a", 1), ("c", 0)]:
            p.record(q(qid), chosen, 2)
        self.assertEqual(p.recent_misses(), ["a", "b"])

    def test_corrupt_file_is_backed_up(self):
        config.PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
        (config.PROGRESS_DIR / "midi.json").write_text("{not json")
        p = Progress("midi")
        self.assertEqual(p.difficulty, config.DIFFICULTY_START)
        self.assertTrue((config.PROGRESS_DIR / "midi.json.broken").exists())


class QuestionBankTests(TempDataTest):
    def test_validate_accepts_letter_answers_and_strips_prefixes(self):
        out = validate_question({"question": "What does CC stand for?",
                                 "choices": ["A) Control Change", "B) Channel Count",
                                             "C) Clock Cycle", "D) Cue Control"],
                                 "answer": "A", "explanation": "CC is Control Change."})
        self.assertEqual(out["answer_index"], 0)
        self.assertEqual(out["choices"][0], "Control Change")

    def test_validate_rejects_bad_questions(self):
        bad = [
            {"question": "Too few choices here?", "choices": ["a", "b"], "answer_index": 0, "explanation": "x"},
            {"question": "Answer out of range?", "choices": list("abcd"), "answer_index": 7, "explanation": "x"},
            {"question": "Duplicate choices?", "choices": ["a", "a", "b", "c"], "answer_index": 0, "explanation": "x"},
            {"question": "No explanation given?", "choices": list("abcd"), "answer_index": 1},
            "not a dict",
        ]
        for b in bad:
            with self.assertRaises(ValueError):
                validate_question(b)

    def test_add_rejects_duplicates(self):
        bank = QuestionBank("midi")
        clean = validate_question({"question": "Which message starts a note?",
                                   "choices": ["Note On", "Note Off", "CC", "Clock"],
                                   "answer_index": 0, "explanation": "Note On starts notes."})
        self.assertIsNotNone(bank.add(clean, "messages", 1))
        self.assertIsNone(bank.add(dict(clean, question="which message STARTS a note"), "messages", 1))
        self.assertEqual(len(QuestionBank("midi")), 1)

    def test_pick_prefers_target_level_and_unseen(self):
        bank = QuestionBank("midi")
        bank.questions = [q("easy", diff=1), q("seen", diff=3), q("new", diff=3), q("hard", diff=5)]
        stats = {"seen": {"seen": 1, "correct": 1, "last_correct": True}}
        rng = random.Random(1)
        picks = {bank.pick(3, [], stats, {}, rng)["id"] for _ in range(20)}
        self.assertEqual(picks, {"new"})

    def test_pick_falls_back_one_level_and_respects_exclude(self):
        bank = QuestionBank("midi")
        bank.questions = [q("two", diff=2), q("five", diff=5)]
        self.assertEqual(bank.pick(3, [], {}, {})["id"], "two")
        self.assertIsNone(bank.pick(3, ["two"], {}, {}))


if __name__ == "__main__":
    unittest.main()

import json
import unittest
from datetime import date
from unittest import mock

from engine import backup, config, llm_client, models, stats, web
from engine.progress import Progress, is_due, schedule
from engine.question_bank import QuestionBank
from engine.quiz import QuizSession
from tests.helpers import TempDataTest


def q(qid, sub="EQ and filters", diff=2, ans=0):
    return {"id": qid, "subtopic": sub, "difficulty": diff, "answer_index": ans,
            "question": "Question " + qid + " about things?", "choices": ["a", "b", "c", "d"],
            "explanation": "x"}


class FakeResp:
    def __init__(self, status, body=None, headers=None):
        self.status_code = status
        self._body = body or {}
        self.headers = headers or {}
        self.text = json.dumps(self._body)

    def json(self):
        return self._body

    def close(self):
        pass


def client():
    return llm_client.LLMClient({"provider": "gemini", "label": "Gemini", "url": "https://x/v1/chat/completions",
                                 "model": "m", "api_key": "k", "needs_key": True})


class RetryTests(unittest.TestCase):
    def test_retries_busy_then_succeeds(self):
        replies = [FakeResp(503), FakeResp(429, headers={"Retry-After": "7"}),
                   FakeResp(200, {"choices": [{"message": {"content": "OK"}}]})]
        waits = []
        with mock.patch("requests.post", side_effect=lambda *a, **k: replies.pop(0)), \
                mock.patch.object(llm_client, "_sleep", side_effect=waits.append):
            self.assertEqual(client().chat([{"role": "user", "content": "hi"}]), "OK")
        self.assertEqual(waits, [2, 7.0])

    def test_gives_up_with_clear_message(self):
        with mock.patch("requests.post", return_value=FakeResp(503)), \
                mock.patch.object(llm_client, "_sleep"):
            with self.assertRaisesRegex(llm_client.LLMError, "overloaded"):
                client().chat([{"role": "user", "content": "hi"}])


class ModelListTests(unittest.TestCase):
    def test_models_url(self):
        self.assertEqual(models.models_url("https://api.groq.com/openai/v1/chat/completions"),
                         "https://api.groq.com/openai/v1/models")

    def test_gemini_prefix_and_filtering(self):
        out = models.parse_models({"data": [{"id": "models/gemini-2.5-flash"}, {"id": "models/text-embedding-004"},
                                            {"id": "models/gemini-2.0-flash"}]}, "gemini")
        self.assertEqual([m["id"] for m in out], ["gemini-2.0-flash", "gemini-2.5-flash"])

    def test_openrouter_free_only(self):
        out = models.parse_models({"data": [{"id": "a/paid", "pricing": {"prompt": "0.1", "completion": "0.1"}},
                                            {"id": "b/m:free"}]}, "openrouter")
        self.assertEqual([m["id"] for m in out], ["b/m:free"])

    def test_list_models_sends_key_and_handles_rejection(self):
        settings = {"provider": "groq", "url": "https://x/v1/chat/completions", "api_key": "k", "needs_key": True}
        with mock.patch("requests.get", return_value=FakeResp(200, {"data": [{"id": "llama"}, {"id": "whisper-large"}]})) as g:
            self.assertEqual([m["id"] for m in models.list_models(settings)], ["llama"])
        self.assertEqual(g.call_args[1]["headers"]["Authorization"], "Bearer k")
        with mock.patch("requests.get", return_value=FakeResp(401)):
            with self.assertRaisesRegex(llm_client.LLMError, "rejected"):
                models.list_models(settings)

    def test_preferred(self):
        ms = [{"id": "a"}, {"id": "b"}]
        self.assertEqual(models.preferred(ms, "b", "a"), "b")
        self.assertEqual(models.preferred(ms, "gone", "a"), "a")
        self.assertEqual(models.preferred(ms, None, "gone"), "a")


class SpacedRepetitionTests(TempDataTest):
    def test_schedule_boxes(self):
        s = {}
        schedule(s, True, date(2026, 1, 1))
        self.assertEqual((s["box"], s["due"]), (1, "2026-01-02"))
        schedule(s, True, date(2026, 1, 2))
        self.assertEqual(s["due"], "2026-01-05")
        schedule(s, False, date(2026, 1, 5))
        self.assertEqual((s["box"], s["due"]), (1, "2026-01-05"))

    def test_old_data_without_dates(self):
        self.assertTrue(is_due({"last_correct": False}))
        self.assertFalse(is_due({"last_correct": True}))

    def test_review_session_only_due_and_keeps_level(self):
        bank = QuestionBank("midi")
        bank.questions = [q("a"), q("b"), q("c")]
        bank.save()
        p = Progress("midi")
        p.record(q("a"), 1, 2)
        p.record(q("b"), 0, 3)
        s = QuizSession("midi", llm=object(), length=10, mode="review")
        self.assertEqual(s.length, 1)
        self.assertEqual(s.next_question()["id"], "a")
        s.answer(0, 3)
        self.assertTrue(s.finished)
        self.assertEqual(Progress("midi").difficulty, config.DIFFICULTY_START)

    def test_today_summary(self):
        bank = QuestionBank("live")
        bank.questions = [q("a")]
        bank.save()
        Progress("live").record(q("a"), 1, 2)
        s = stats.summary()
        self.assertEqual((s["streak"], s["answered_today"], s["due_total"]), (1, 1, 1))

    def test_streak(self):
        d = [date(2026, 3, 1), date(2026, 3, 2)]
        self.assertEqual(stats.streak(d, date(2026, 3, 2)), 2)
        self.assertEqual(stats.streak(d, date(2026, 3, 3)), 2)
        self.assertEqual(stats.streak(d, date(2026, 3, 4)), 0)


class BackupTests(TempDataTest):
    def test_round_trip(self):
        bank = QuestionBank("sound")
        bank.questions = [q("x")]
        bank.save()
        Progress("sound").record(q("x"), 0, 2)
        (config.ASSIGNMENTS_DIR / "rep.json").write_text(json.dumps({"id": "rep", "title": "Rep", "brief_text": "B"}))
        path = backup.write_backup()
        data = json.loads(path.read_text())
        self.assertEqual(data["app"], "learning-engine")
        self.assertIn("sound", data["questions"])
        for f in list(config.QUESTIONS_DIR.glob("*.json")) + list(config.PROGRESS_DIR.glob("*.json")):
            f.unlink()
        counts = backup.restore_backup(path)
        self.assertEqual(counts, {"questions": 1, "topics": 1, "assignments": 1})
        self.assertEqual(len(QuestionBank("sound")), 1)

    def test_restore_rejects_other_files_and_bad_names(self):
        bad = config.DATA_DIR / "x.json"
        bad.write_text('{"hello": 1}')
        with self.assertRaises(ValueError):
            backup.restore_backup(bad)
        bad.write_text(json.dumps({"app": "learning-engine", "questions": {"../../evil": [q("e")]}}))
        backup.restore_backup(bad)
        self.assertFalse((config.DATA_DIR.parent / "evil.json").exists())

    def test_auto_backup_once_a_day(self):
        self.assertIsNone(backup.auto_backup())  # nothing to back up yet
        Progress("midi").record(q("a"), 0, 2)
        self.assertIsNotNone(backup.auto_backup())
        self.assertIsNone(backup.auto_backup())


class WebTests(unittest.TestCase):
    def test_static_files_stay_inside_app_folder(self):
        self.assertEqual(web.resolve_static("/").name, "index.html")
        self.assertIsNotNone(web.resolve_static("/manifest.webmanifest"))
        self.assertIsNone(web.resolve_static("/../main.py"))
        self.assertIsNone(web.resolve_static("/%2e%2e/settings.json"))


if __name__ == "__main__":
    unittest.main()


class ConnectionProblemTests(unittest.TestCase):
    def gemini(self, model="gemini-2.5-flash"):
        return llm_client.LLMClient({"provider": "gemini", "label": "Google Gemini", "model": model,
                                     "url": "https://x/v1/chat/completions", "api_key": "k", "needs_key": True})

    def test_dropped_connection_is_retried(self):
        import requests
        replies = [requests.ConnectionError("reset"), FakeResp(200, {"choices": [{"message": {"content": "OK"}}]})]

        def post(*a, **k):
            r = replies.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        with mock.patch("requests.post", side_effect=post), mock.patch.object(llm_client, "_sleep"):
            self.assertEqual(self.gemini().chat([{"role": "user", "content": "hi"}]), "OK")

    def test_bad_key_400_and_thinking_settings(self):
        body = [{"error": {"code": 400, "message": "API key not valid. Please pass a valid API key."}}]
        with mock.patch("requests.post", return_value=FakeResp(400, body)) as post:
            with self.assertRaisesRegex(llm_client.LLMError, "rejected your key.*API key not valid"):
                self.gemini().chat([{"role": "user", "content": "hi"}], max_tokens=100)
        sent = post.call_args[1]["json"]
        self.assertEqual((sent["reasoning_effort"], sent["max_tokens"]), ("none", 2148))
        self.assertEqual(self.gemini().timeout, config.LLM_ONLINE_TIMEOUT)

    def test_unsupported_thinking_setting_is_dropped(self):
        replies = [FakeResp(400, {"error": {"message": "reasoning_effort not supported"}}),
                   FakeResp(200, {"choices": [{"message": {"content": "OK"}}]})]
        sent = []

        def post(*a, **k):
            sent.append(dict(k["json"]))
            return replies.pop(0)
        with mock.patch("requests.post", side_effect=post):
            self.assertEqual(self.gemini("gemini-2.5-pro").chat([{"role": "user", "content": "hi"}]), "OK")
        self.assertEqual(sent[0]["reasoning_effort"], "low")
        self.assertNotIn("reasoning_effort", sent[1])

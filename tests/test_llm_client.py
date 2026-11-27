import unittest

from engine.llm_client import extract_json


class ExtractJsonTests(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(extract_json('{"a": 1}'), {"a": 1})

    def test_code_fence_and_chatter(self):
        text = 'Sure! Here you go:\n```json\n{"a": [1, 2]}\n```\nHope that helps.'
        self.assertEqual(extract_json(text), {"a": [1, 2]})

    def test_trailing_comma_and_braces_in_strings(self):
        text = 'Answer: {"q": "What is {this}?", "c": [1, 2,],}'
        self.assertEqual(extract_json(text), {"q": "What is {this}?", "c": [1, 2]})

    def test_nothing_found(self):
        with self.assertRaises(ValueError):
            extract_json("I cannot do that.")


if __name__ == "__main__":
    unittest.main()

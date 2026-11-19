import unittest

from engine import adaptive


def run(answers, start=2):
    d, c, w = start, 0, 0
    decisions = []
    for a in answers:
        dec = adaptive.update(d, c, w, a)
        d, c, w = dec.difficulty, dec.correct_streak, dec.wrong_streak
        decisions.append(dec)
    return decisions


class AdaptiveTests(unittest.TestCase):
    def test_three_correct_levels_up(self):
        decs = run([True, True, True])
        self.assertEqual([x.difficulty for x in decs], [2, 2, 3])
        self.assertEqual(decs[-1].change, "up")
        self.assertEqual(decs[-1].correct_streak, 0)

    def test_two_wrong_levels_down_and_reexplains(self):
        decs = run([False, False])
        self.assertEqual(decs[0].difficulty, 2)
        self.assertFalse(decs[0].reexplain)
        self.assertEqual(decs[1].difficulty, 1)
        self.assertEqual(decs[1].change, "down")
        self.assertTrue(decs[1].reexplain)

    def test_wrong_answer_breaks_correct_streak(self):
        decs = run([True, True, False, True, True])
        self.assertTrue(all(x.difficulty == 2 for x in decs))
        self.assertEqual(decs[-1].correct_streak, 2)

    def test_correct_answer_breaks_wrong_streak(self):
        decs = run([False, True, False])
        self.assertTrue(all(x.difficulty == 2 for x in decs))
        self.assertFalse(any(x.reexplain for x in decs))

    def test_clamped_at_max(self):
        decs = run([True] * 3, start=5)
        self.assertEqual(decs[-1].difficulty, 5)
        self.assertIsNone(decs[-1].change)

    def test_clamped_at_min_still_reexplains(self):
        decs = run([False, False], start=1)
        self.assertEqual(decs[-1].difficulty, 1)
        self.assertIsNone(decs[-1].change)
        self.assertTrue(decs[-1].reexplain)

    def test_six_correct_climbs_two_levels(self):
        self.assertEqual(run([True] * 6)[-1].difficulty, 4)


if __name__ == "__main__":
    unittest.main()

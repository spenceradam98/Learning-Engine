import shutil
import tempfile
import unittest
from pathlib import Path

from engine import config


class TempDataTest(unittest.TestCase):
    """Points all data files at a throwaway folder for each test."""

    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._old = (config.DATA_DIR, config.QUESTIONS_DIR, config.PROGRESS_DIR, config.ASSIGNMENTS_DIR)
        root = Path(self._tmp)
        config.DATA_DIR = root
        config.QUESTIONS_DIR = root / "questions"
        config.PROGRESS_DIR = root / "progress"
        config.ASSIGNMENTS_DIR = root / "assignments"
        config.ensure_dirs()

    def tearDown(self):
        (config.DATA_DIR, config.QUESTIONS_DIR, config.PROGRESS_DIR, config.ASSIGNMENTS_DIR) = self._old
        shutil.rmtree(self._tmp, ignore_errors=True)

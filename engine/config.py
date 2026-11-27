"""Central settings. Override the LLM settings with environment variables if needed."""
from __future__ import annotations

import json
import os
from pathlib import Path

# --- AI provider -------------------------------------------------------------
# The engine talks to any OpenAI-compatible chat endpoint. "local" is your
# llama.cpp server; the others are online services with free tiers.
# Pick one with `python main.py setup` (saved to settings.json) or override
# with environment variables LE_PROVIDER, LE_API_KEY, LE_LLM_URL, LE_LLM_MODEL.
PROVIDERS = {
    "local": {
        "label": "Local model (llama.cpp on this Mac)",
        "url": "http://localhost:8080/v1/chat/completions",
        "model": "local",  # llama-server ignores this, but the field must be present
        "needs_key": False,
        "key_url": "",
    },
    "groq": {
        "label": "Groq (free tier, very fast)",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "model": "llama-3.3-70b-versatile",
        "needs_key": True,
        "key_url": "https://console.groq.com/keys",
    },
    "gemini": {
        "label": "Google Gemini (free tier)",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "model": "gemini-2.5-flash",
        "needs_key": True,
        "key_url": "https://aistudio.google.com/apikey",
    },
    "openrouter": {
        "label": "OpenRouter (pick any model ending in :free)",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
        "needs_key": True,
        "key_url": "https://openrouter.ai/keys",
    },
    "custom": {
        "label": "Other OpenAI-compatible endpoint",
        "url": "",
        "model": "",
        "needs_key": True,
        "key_url": "",
    },
}
DEFAULT_PROVIDER = "local"

# A 7B model on a 2014 Intel CPU is slow. Give it plenty of time.
LLM_TIMEOUT = int(os.environ.get("LE_LLM_TIMEOUT", "300"))
# How many extra attempts when the model returns broken JSON.
LLM_JSON_RETRIES = 2
# Free online APIs sometimes answer "busy" (HTTP 503) or "slow down" (429).
# Wait this many seconds before each automatic retry.
LLM_BUSY_RETRY_DELAYS = (2, 5, 10)
# Rough character budget for pasted assignment text sent to the model.
# ~4 chars per token; keeps prompts inside a 4096-token context.
MAX_CONTEXT_CHARS = int(os.environ.get("LE_MAX_CONTEXT_CHARS", "6000"))

# --- Paths -------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("LE_DATA_DIR", str(ROOT / "data")))
QUESTIONS_DIR = DATA_DIR / "questions"
PROGRESS_DIR = DATA_DIR / "progress"
ASSIGNMENTS_DIR = DATA_DIR / "assignments"

# --- Adaptive rules ----------------------------------------------------------
DIFFICULTY_MIN = 1
DIFFICULTY_MAX = 5
DIFFICULTY_START = 2
CORRECT_STREAK_TO_LEVEL_UP = 3
WRONG_STREAK_TO_LEVEL_DOWN = 2
# A subtopic with mastery below this shows up in "review weak spots".
WEAK_THRESHOLD = 0.6

DIFFICULTY_LABELS = {
    1: "beginner: basic definitions and facts",
    2: "foundation: core concepts and simple applications",
    3: "intermediate: applying concepts to realistic situations",
    4: "advanced: troubleshooting, trade-offs and multi-step reasoning",
    5: "expert: edge cases, deep theory and professional practice",
}

# --- Built-in topics ---------------------------------------------------------
TOPICS = {
    "midi": {
        "name": "MIDI (theory, protocol and practical use in DAWs)",
        "subtopics": [
            "MIDI messages and channels",
            "note on/off, velocity and aftertouch",
            "control change, program change and automation",
            "MIDI timing, clock and sync",
            "MIDI in DAWs: recording, quantising and editing",
            "MIDI routing, ports and hardware connections",
            "General MIDI, MPE and MIDI 2.0",
            "music theory for MIDI programming",
        ],
    },
    "sound": {
        "name": "Applied sound principles (acoustics, signal processing, psychoacoustics)",
        "subtopics": [
            "sound waves, frequency and wavelength",
            "decibels and signal levels",
            "room acoustics and reflections",
            "EQ and filters",
            "dynamics processing: compression and gating",
            "sampling, bit depth and digital audio",
            "phase and comb filtering",
            "psychoacoustics and perception of loudness",
        ],
    },
    "live": {
        "name": "Live sound techniques (PA setup, mic placement, gain staging, feedback)",
        "subtopics": [
            "PA system setup and speaker placement",
            "microphone types and polar patterns",
            "mic placement for instruments and vocals",
            "gain staging through the signal chain",
            "feedback causes and management",
            "monitor mixes and wedges vs in-ear",
            "mixing desk signal flow, auxes and inserts",
            "soundcheck workflow and troubleshooting",
        ],
    },
}


SETTINGS_FILE = ROOT / "settings.json"  # git-ignored: holds your API key


def load_settings() -> dict:
    """Provider settings: preset defaults <- settings.json <- environment."""
    saved = {}
    if SETTINGS_FILE.exists():
        try:
            saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except ValueError:
            saved = {}
    provider = os.environ.get("LE_PROVIDER") or saved.get("provider") or DEFAULT_PROVIDER
    if provider not in PROVIDERS:
        provider = DEFAULT_PROVIDER
    preset = PROVIDERS[provider]
    same = saved.get("provider") == provider
    return {
        "provider": provider,
        "label": preset["label"],
        "url": os.environ.get("LE_LLM_URL") or (same and saved.get("url")) or preset["url"],
        "model": os.environ.get("LE_LLM_MODEL") or (same and saved.get("model")) or preset["model"],
        "api_key": os.environ.get("LE_API_KEY") or (same and saved.get("api_key")) or "",
        "needs_key": preset["needs_key"],
    }


def save_settings(provider: str, url: str, model: str, api_key: str) -> None:
    data = {"provider": provider, "url": url, "model": model, "api_key": api_key}
    SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        os.chmod(str(SETTINGS_FILE), 0o600)  # keep the key private to your user
    except OSError:
        pass


def ensure_dirs() -> None:
    for d in (QUESTIONS_DIR, PROGRESS_DIR, ASSIGNMENTS_DIR):
        d.mkdir(parents=True, exist_ok=True)

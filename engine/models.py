"""Ask an AI provider which model names it offers, so you can pick from a list."""
from __future__ import annotations

from typing import List, Optional

import requests

from .llm_client import LLMError

# Models that can't chat (speech, images, embeddings, safety filters).
_NOT_CHAT = ("whisper", "tts", "embed", "imagen", "veo", "aqa", "guard", "orpheus",
             "moderation", "dall-e", "image-generation", "native-audio", "learnlm")


def models_url(chat_url: str) -> str:
    """https://x/v1/chat/completions -> https://x/v1/models"""
    url = (chat_url or "").strip().rstrip("/")
    if url.endswith("/chat/completions"):
        url = url[:-len("/chat/completions")]
    return url + "/models"


def _is_free(item: dict) -> bool:
    if str(item.get("id", "")).endswith(":free"):
        return True
    pricing = item.get("pricing")
    if isinstance(pricing, dict):
        try:
            return float(pricing.get("prompt", 1)) == 0 and float(pricing.get("completion", 1)) == 0
        except (TypeError, ValueError):
            return False
    return False


def parse_models(data: object, provider: str) -> List[dict]:
    """Turn a /models reply into [{"id", "free"}], chat models only, best first."""
    items = data.get("data") if isinstance(data, dict) else data
    if not isinstance(items, list):
        items = data.get("models") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise LLMError("The provider's model list was in an unexpected format.")
    out, seen = [], set()
    for it in items:
        if isinstance(it, str):
            it = {"id": it}
        if not isinstance(it, dict):
            continue
        mid = str(it.get("id") or it.get("name") or "").strip()
        if mid.startswith("models/"):  # Gemini says "models/gemini-2.5-flash"
            mid = mid[len("models/"):]
        low = mid.lower()
        if not mid or mid in seen or any(word in low for word in _NOT_CHAT):
            continue
        if it.get("active") is False:
            continue
        seen.add(mid)
        out.append({"id": mid, "free": _is_free(it)})
    if provider == "openrouter":
        # OpenRouter lists hundreds of paid models; only free ones work on a free key.
        free = [m for m in out if m["free"]]
        out = free or out
    out.sort(key=lambda m: m["id"].lower())
    return out


def list_models(settings: dict, timeout: int = 15) -> List[dict]:
    """Fetch the model list using the saved (or typed) key. Raises LLMError."""
    url = settings.get("url") or ""
    if not url:
        raise LLMError("No API address set.")
    headers = {}
    if settings.get("api_key"):
        headers["Authorization"] = "Bearer " + settings["api_key"]
    elif settings.get("needs_key") and settings.get("provider") != "openrouter":
        raise LLMError("Enter your API key first, then the model list can be loaded.")
    try:
        r = requests.get(models_url(url), headers=headers, timeout=timeout)
    except requests.RequestException as e:
        raise LLMError("Couldn't load the model list. Check your internet connection.") from e
    if r.status_code in (401, 403):
        raise LLMError("The API rejected your key (HTTP {}), so the model list couldn't be "
                       "loaded. Check the key.".format(r.status_code))
    if r.status_code != 200:
        raise LLMError("Couldn't load the model list (HTTP {}). You can type a model name "
                       "instead.".format(r.status_code))
    try:
        data = r.json()
    except ValueError as e:
        raise LLMError("The provider's model list was in an unexpected format.") from e
    models = parse_models(data, settings.get("provider", ""))
    if not models:
        raise LLMError("The provider didn't list any chat models. You can type a model name instead.")
    return models


def preferred(models: List[dict], current: Optional[str], default: Optional[str]) -> Optional[str]:
    """Which model to pre-select: the saved one, else the preset, else the first."""
    ids = [m["id"] for m in models]
    for want in (current, default):
        if want and want in ids:
            return want
    return ids[0] if ids else None

"""Talks to the local llama.cpp server and makes its JSON output dependable."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable, Dict, Iterator, List, Optional

import requests

from . import config

Message = Dict[str, str]


class LLMError(Exception):
    """Raised when the local model can't be reached or keeps returning junk."""


class LLMClient:
    def __init__(self, settings: Optional[dict] = None, timeout: int = config.LLM_TIMEOUT):
        self.settings = settings or config.load_settings()
        self.url = self.settings["url"]
        self.model = self.settings["model"] or "local"
        self.api_key = self.settings.get("api_key", "")
        self.is_local = self.settings["provider"] == "local"
        self.timeout = timeout
        # llama-server accepts a JSON schema and turns it into a grammar, so a
        # small model can't produce broken JSON. Online providers vary, so we
        # only send it locally. If an older llama-server rejects it once, we
        # stop sending it and rely on JSON extraction + retries instead.
        self._schema_supported = self.is_local

    def describe(self) -> str:
        if self.is_local:
            return "local model at {}".format(self.base_url())
        return "{} ({})".format(self.settings["label"], self.model)

    # -- health ---------------------------------------------------------------
    def base_url(self) -> str:
        return self.url.split("/v1/")[0] if "/v1/" in self.url else self.url

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = "Bearer " + self.api_key
        return h

    def check(self) -> str:
        """Return a short status string, or raise LLMError."""
        if not self.url:
            raise LLMError("No API address set. Run `python main.py setup`.")
        if not self.is_local:
            if self.settings.get("needs_key") and not self.api_key:
                raise LLMError("No API key set for {}. Run `python main.py setup`."
                               .format(self.settings["label"]))
            reply = self.chat([{"role": "user", "content": "Reply with the word OK."}],
                              temperature=0, max_tokens=5)
            return "Connected to {}. It replied: {}".format(self.describe(), reply.strip()[:40])
        try:
            r = requests.get(self.base_url() + "/health", timeout=5)
        except requests.RequestException as e:
            raise LLMError(
                "Can't reach the model at {}. Is llama-server running? "
                "(see README, 'Start the model')".format(self.base_url())
            ) from e
        if r.status_code == 503:
            raise LLMError("The model server is still loading the model. Try again in a minute.")
        if r.status_code != 200:
            raise LLMError("Model server answered HTTP {}.".format(r.status_code))
        return "Model server is up at {}".format(self.base_url())

    # -- plain chat -------------------------------------------------------------
    def _payload(self, messages: List[Message], temperature: float, max_tokens: int,
                 stream: bool = False, schema: Optional[dict] = None) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        if schema is not None and self._schema_supported:
            # llama-server turns this schema into a grammar, so the model
            # literally can't emit anything except matching JSON.
            payload["response_format"] = {"type": "json_object", "schema": schema}
        return payload

    def _post(self, payload: dict, stream: bool = False) -> requests.Response:
        """POST, retrying a few times when a busy service says "try again" (503 or 429)."""
        delays = list(config.LLM_BUSY_RETRY_DELAYS)
        while True:
            r = self._post_once(payload, stream)
            if r.status_code not in (429, 503) or not delays:
                return self._check_response(r, payload, stream)
            wait = delays.pop(0)
            try:  # the service may say how long to wait; keep it short either way
                wait = min(30.0, max(wait, float(r.headers.get("Retry-After", 0))))
            except (TypeError, ValueError):
                pass
            r.close()
            _sleep(wait)

    def _post_once(self, payload: dict, stream: bool) -> requests.Response:
        try:
            r = requests.post(self.url, json=payload, headers=self._headers(),
                              timeout=self.timeout, stream=stream)
        except requests.Timeout as e:
            raise LLMError("The model took longer than {}s. Try again, or use a smaller "
                           "model (see README).".format(self.timeout)) from e
        except requests.RequestException as e:
            if self.is_local:
                raise LLMError("Can't reach the model at {}. Is llama-server running?"
                               .format(self.base_url())) from e
            raise LLMError("Can't reach {}. Check your internet connection."
                           .format(self.base_url())) from e
        return r

    def _check_response(self, r: requests.Response, payload: dict,
                        stream: bool) -> requests.Response:
        if r.status_code == 400 and "response_format" in payload:
            # Probably an older server that doesn't know json schemas.
            self._schema_supported = False
            payload = dict(payload)
            payload.pop("response_format", None)
            return self._post(payload, stream)
        if r.status_code in (401, 403):
            raise LLMError("The API rejected your key (HTTP {}). Run `python main.py setup` "
                           "to enter it again.".format(r.status_code))
        if r.status_code == 429:
            raise LLMError("The free API's rate limit was hit. Wait a minute and try again.")
        if r.status_code == 503 and not self.is_local:
            raise LLMError("{} is overloaded right now (HTTP 503). Wait a minute and try again, "
                           "or pick a different model in AI settings.".format(self.settings["label"]))
        if r.status_code == 404 and not self.is_local:
            raise LLMError("The API doesn't know the model '{}'. Free model names change; "
                           "run `python main.py setup` and pick a current one.".format(self.model))
        if r.status_code != 200:
            raise LLMError("Model server error HTTP {}: {}".format(r.status_code, r.text[:200]))
        return r

    def chat(self, messages: List[Message], temperature: float = 0.7,
             max_tokens: int = 700, schema: Optional[dict] = None) -> str:
        r = self._post(self._payload(messages, temperature, max_tokens, schema=schema))
        try:
            return r.json()["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError) as e:
            raise LLMError("Unexpected reply from model server: {}".format(r.text[:200])) from e

    def stream(self, messages: List[Message], temperature: float = 0.7,
               max_tokens: int = 700) -> Iterator[str]:
        """Yield text chunks as the model writes them (server-sent events)."""
        r = self._post(self._payload(messages, temperature, max_tokens, stream=True), stream=True)
        r.encoding = "utf-8"
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                delta = json.loads(data)["choices"][0].get("delta", {})
            except (ValueError, KeyError, IndexError):
                continue
            chunk = delta.get("content")
            if chunk:
                yield chunk

    # -- JSON chat --------------------------------------------------------------
    def chat_json(self, messages: List[Message], schema: dict,
                  validate: Callable[[Any], Any], temperature: float = 0.4,
                  max_tokens: int = 600, retries: int = config.LLM_JSON_RETRIES) -> Any:
        """Ask for JSON, parse it, validate it, retry with a nudge if it's broken.

        `validate` receives the parsed object and returns the cleaned value,
        or raises ValueError with a reason.
        """
        last_error = "no attempt made"
        convo = list(messages)
        for _ in range(retries + 1):
            text = self.chat(convo, temperature=temperature, max_tokens=max_tokens, schema=schema)
            try:
                return validate(extract_json(text))
            except ValueError as e:
                last_error = str(e)
                convo = list(messages) + [
                    {"role": "assistant", "content": text[:1500]},
                    {"role": "user", "content": "That was not valid ({}). Reply again with ONLY "
                     "the JSON object, nothing else.".format(last_error)},
                ]
        raise LLMError("The model kept returning unusable output ({}).".format(last_error))


def _sleep(seconds: float) -> None:
    time.sleep(seconds)  # a separate function so tests can skip the wait


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_json(text: str) -> Any:
    """Pull the first JSON object or array out of a model reply.

    Handles code fences, chatter before/after, and trailing commas.
    Raises ValueError if nothing parseable is found.
    """
    if not text or not text.strip():
        raise ValueError("empty reply")
    candidates = [m.group(1) for m in _FENCE.finditer(text)] + [text]
    for cand in candidates:
        cand = cand.strip()
        try:
            return json.loads(cand)
        except ValueError:
            pass
        block = _first_balanced(cand)
        if block is None:
            continue
        for attempt in (block, re.sub(r",\s*([}\]])", r"\1", block)):
            try:
                return json.loads(attempt)
            except ValueError:
                continue
    raise ValueError("no JSON object found")


def _first_balanced(text: str) -> Optional[str]:
    """Return the first balanced {...} or [...] block, respecting strings."""
    start = None
    for i, ch in enumerate(text):
        if ch in "{[":
            start = i
            break
    if start is None:
        return None
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None

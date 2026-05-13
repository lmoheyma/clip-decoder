from __future__ import annotations
import asyncio
import base64
import contextvars
import json
import logging
import random
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

logger = logging.getLogger(__name__)


# Per-task sink the orchestrator binds before running the pipeline. When
# set, NIM transient retries and >=400 responses publish a one-line
# update through it so the user-visible LogPane shows progress during
# slow LLM calls instead of staring at a frozen screen.
_NIM_EVENT_SINK: contextvars.ContextVar[
    Callable[[str, str], Awaitable[None]] | None
] = contextvars.ContextVar("_NIM_EVENT_SINK", default=None)


def bind_nim_event_sink(
    sink: Callable[[str, str], Awaitable[None]] | None,
) -> contextvars.Token:
    """Bind a sink for NIM client diagnostics in the current async context.

    The sink is invoked with (level, message) where level is one of
    'retry' / 'error'. Returns a Token the caller passes to
    `unbind_nim_event_sink` when the scope ends.
    """
    return _NIM_EVENT_SINK.set(sink)


def unbind_nim_event_sink(token: contextvars.Token) -> None:
    _NIM_EVENT_SINK.reset(token)


async def _emit_nim_event(level: str, message: str) -> None:
    sink = _NIM_EVENT_SINK.get()
    if sink is None:
        return
    try:
        await sink(level, message)
    except Exception:
        logger.exception("nim event sink raised")


class NimError(RuntimeError):
    pass


class NimClient:
    """Thin async wrapper around an OpenAI-compatible NIM endpoint.

    Why this exists: the OpenAI Python SDK is sync-leaning for some
    multimodal flows, and we need precise control over JSON-only
    parsing with retry. httpx async + a few helpers is simpler.
    """

    # NIM occasionally returns 5xx (especially 502) during load spikes.
    # We retry transient failures with exponential backoff + jitter so a
    # blip mid-pipeline doesn't fail the whole run.
    _RETRY_STATUS = {429, 500, 502, 503, 504}
    _MAX_TRANSIENT_RETRIES = 3
    _BACKOFF_BASE_S = 0.5

    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout_s: float = 60.0,
        max_json_retries: int = 1,
    ):
        # Validation is deferred to the first request so that the module
        # remains importable even when NVAPI_KEY is not set (e.g. in tests
        # that wire build_app directly without a real NIM key).
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._max_json_retries = max_json_retries

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def _post_chat(
        self, *, model: str, messages: list[dict[str, Any]], json_mode: bool
    ) -> str:
        if not self._api_key:
            raise ValueError("NIM api_key is required")
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 2048,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=self._timeout_s) as http:
            for attempt in range(self._MAX_TRANSIENT_RETRIES + 1):
                try:
                    r = await http.post(
                        f"{self._base_url}/chat/completions",
                        headers=self._headers(),
                        json=body,
                    )
                except (httpx.ReadTimeout, httpx.ConnectError, httpx.RemoteProtocolError) as e:
                    if attempt >= self._MAX_TRANSIENT_RETRIES:
                        await _emit_nim_event(
                            "error",
                            f"LLM unreachable ({type(e).__name__}) after "
                            f"{self._MAX_TRANSIENT_RETRIES + 1} attempts",
                        )
                        raise
                    delay = self._backoff_delay(attempt)
                    logger.warning(
                        "NIM transport error (%s) for model=%r; retry %d/%d in %.1fs",
                        type(e).__name__, model, attempt + 1,
                        self._MAX_TRANSIENT_RETRIES, delay,
                    )
                    await _emit_nim_event(
                        "retry",
                        f"LLM {type(e).__name__} — retrying "
                        f"{attempt + 1}/{self._MAX_TRANSIENT_RETRIES} in {delay:.1f}s",
                    )
                    await asyncio.sleep(delay)
                    continue
                if r.status_code in self._RETRY_STATUS and attempt < self._MAX_TRANSIENT_RETRIES:
                    delay = self._backoff_delay(attempt)
                    logger.warning(
                        "NIM %s for model=%r; retry %d/%d in %.1fs",
                        r.status_code, model, attempt + 1,
                        self._MAX_TRANSIENT_RETRIES, delay,
                    )
                    await _emit_nim_event(
                        "retry",
                        f"LLM HTTP {r.status_code} — retrying "
                        f"{attempt + 1}/{self._MAX_TRANSIENT_RETRIES} in {delay:.1f}s",
                    )
                    await asyncio.sleep(delay)
                    continue
                if r.status_code >= 400:
                    logger.error(
                        "NIM %s for model=%r: %s",
                        r.status_code, model, r.text[:500],
                    )
                    await _emit_nim_event(
                        "error", f"LLM HTTP {r.status_code}"
                    )
                    r.raise_for_status()
                data = r.json()
                break
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise NimError(f"Unexpected NIM response shape: {data}") from e

    @classmethod
    def _backoff_delay(cls, attempt: int) -> float:
        # Exponential backoff with jitter: 0.5s, 1s, 2s ± 25%
        base = cls._BACKOFF_BASE_S * (2 ** attempt)
        return base * (0.75 + random.random() * 0.5)

    async def complete_text(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        json_mode: bool = False,
    ) -> Any:
        attempts = 0
        last_err: Exception | None = None
        while attempts <= self._max_json_retries:
            content = await self._post_chat(
                model=model, messages=messages, json_mode=json_mode
            )
            if not json_mode:
                return content
            try:
                return json.loads(content)
            except json.JSONDecodeError as e:
                last_err = e
                logger.warning(
                    "NIM returned non-JSON content (attempt %d): %r", attempts, content
                )
                attempts += 1
        raise NimError(
            f"NIM did not return valid JSON after {attempts} attempts: {last_err}"
        )

    async def analyze_image(
        self,
        *,
        model: str,
        image_path: Path,
        prompt: str,
        json_mode: bool = True,
        system: str | None = None,
    ) -> Any:
        b64 = base64.b64encode(image_path.read_bytes()).decode()
        ext = image_path.suffix.lower().lstrip(".")
        mime = "jpeg" if ext in ("jpg", "jpeg") else ext or "jpeg"
        data_url = f"data:image/{mime};base64,{b64}"
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        )
        return await self.complete_text(
            model=model, messages=messages, json_mode=json_mode
        )

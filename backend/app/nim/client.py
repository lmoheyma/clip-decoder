from __future__ import annotations
import base64
import json
import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class NimError(RuntimeError):
    pass


class NimClient:
    """Thin async wrapper around an OpenAI-compatible NIM endpoint.

    Why this exists: the OpenAI Python SDK is sync-leaning for some
    multimodal flows, and we need precise control over JSON-only
    parsing with retry. httpx async + a few helpers is simpler.
    """

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
            r = await http.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise NimError(f"Unexpected NIM response shape: {data}") from e

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

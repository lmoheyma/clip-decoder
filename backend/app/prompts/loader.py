from pathlib import Path
from functools import lru_cache

_PROMPT_DIR = Path(__file__).parent


@lru_cache(maxsize=16)
def load_prompt(name: str) -> str:
    path = _PROMPT_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt not found: {name}")
    return path.read_text(encoding="utf-8")

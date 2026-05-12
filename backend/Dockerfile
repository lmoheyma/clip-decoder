FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_HTTP_TIMEOUT=300

# System deps for ffmpeg + scenedetect (opencv) + yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /bin/uv

WORKDIR /app

# Lockfile-first install for cache friendliness
COPY pyproject.toml uv.lock ./

ENV PATH="/app/.venv/bin:$PATH"

# ─── dev ─────────────────────────────────────────────────────────
# Used by docker-compose.dev.yml. Installs dev deps (pytest, ruff)
# so we can run the unit suite inside the container while source
# is bind-mounted.
FROM base AS dev
RUN uv sync
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ─── prod (default) ──────────────────────────────────────────────
FROM base AS prod
RUN uv sync --frozen --no-dev
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

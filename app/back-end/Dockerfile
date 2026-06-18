# syntax=docker/dockerfile:1
FROM python:3.12-slim

# Faster, quieter Python + put the uv-managed venv on PATH.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Install uv (pinned binary) for dependency resolution.
COPY --from=ghcr.io/astral-sh/uv:0.5.2 /uv /usr/local/bin/uv

# Install dependencies first for better layer caching. --frozen requires uv.lock
# to be in sync with pyproject.toml; --no-dev skips test/lint tooling.
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen --no-install-project

# Copy application code and config.
COPY app/ app/
COPY gunicorn.conf.py ./

# Install the project itself (now that its source is present).
RUN uv sync --no-dev --frozen

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health').status==200 else sys.exit(1)"

# Production WSGI server. create_app() is the Flask app factory in app/__init__.py.
CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:create_app()"]

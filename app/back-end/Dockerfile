FROM python:3.12-slim
WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen

# Copy application
COPY app/ app/

EXPOSE 8000
CMD ["uv", "run", "flask", "--app", "app", "run", "--host", "0.0.0.0", "-p", "8000"]

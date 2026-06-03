#!/usr/bin/env bash
# Start frontend (Vite) and backend (Flask) with auto-reload.
# Usage: ./dev.sh
#   Ctrl-C stops both processes.

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/app/back-end"
FRONTEND="$ROOT/app/front-end"
PIDS=()
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"

cleanup() {
  echo ""
  echo "Stopping services..."
  trap - EXIT INT TERM
  if [ "${#PIDS[@]}" -gt 0 ]; then
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi
  echo "Done."
}
trap cleanup EXIT INT TERM

export UV_CACHE_DIR="${UV_CACHE_DIR:-$ROOT/.uv-cache}"
export FRONTEND_PORT BACKEND_PORT FRONTEND_HOST BACKEND_HOST

ensure_port_free() {
  local port="$1"
  local label="$2"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Error: ${label} port ${port} is already in use."
    echo "Run: lsof -nP -iTCP:${port}"
    exit 1
  fi
}

ensure_port_free "$BACKEND_PORT" "backend"
ensure_port_free "$FRONTEND_PORT" "frontend"

# --- Backend (Flask with --reload) ---
echo "Starting backend on ${BACKEND_HOST}:${BACKEND_PORT} ..."
(
  cd "$BACKEND"
  uv run flask --app app run --host "$BACKEND_HOST" -p "$BACKEND_PORT" --reload
) &
PIDS+=("$!")

# --- Frontend (Vite dev server — HMR built-in) ---
echo "Starting frontend on ${FRONTEND_HOST}:${FRONTEND_PORT} ..."
(
  cd "$FRONTEND"
  npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
PIDS+=("$!")

wait "${PIDS[@]}"

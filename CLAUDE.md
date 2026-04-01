# AI Coding Instructions: Time Geography Kepler (Monorepo Root)

This is a monorepo for a geospatial analysis platform. It has two independent codebases that communicate over HTTP.

## Repo Structure

```
app/
  front-end/   # React + Kepler.gl (TypeScript, Vite)
  back-end/    # Flask API (Python, geopandas)
```

Each sub-project has its own `CLAUDE.md` with detailed instructions. **Read the relevant one before making changes.**

## Quick Start

### Frontend (`app/front-end/`)

```bash
cd app/front-end
npm install
npm run dev        # Vite dev server on localhost:5173
npm run build      # tsc + vite build → dist/
npm run lint       # ESLint
npm run preview    # Preview production build
```

Environment: copy `.env.example` to `app/front-end/.env`. Key vars:
- `VITE_BACKEND_URL` — Flask backend URL (default `http://localhost:8000`)
- `VITE_APP_MODE` — set to `frontend` for browser-only mode

### Backend (`app/back-end/`)

```bash
cd app/back-end
uv sync                              # Install deps (uses uv + pyproject.toml)
uv run flask --app app run -p 8000   # Start Flask on port 8000
uv run pytest tests/                 # Run tests
```

Requires Python ≥ 3.12. Uses **uv** as the package manager (`uv.lock`).

## Cross-Codebase Rules

- The **API contract** is the boundary. Both CLAUDE.md files define the same endpoint shapes — keep them in sync when changing the API.
- Frontend and backend share no code. Do not import from one into the other.
- The frontend works fully offline (all tools have a browser implementation or are disabled). The backend is optional and additive.
- When adding a new tool, implement it in **both** codebases if the execution policy is `hybrid`. Update both CLAUDE.md files if the contract changes.

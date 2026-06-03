# AI Coding Instructions: Time Geography Kepler (Monorepo Root)

This is a monorepo for a geospatial analysis platform. It has two independent codebases that communicate over HTTP.

## Repo Structure

```
app/
  front-end/   # React + deck.gl (TypeScript, Vite)
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

## Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876).

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

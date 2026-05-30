# Getting Started

There are two ways to run Time Geography Kepler:

- **[Option A — Docker](#option-a-docker-recommended)** — one command, recommended. You only install Docker.
- **[Option B — Dev servers](#option-b-run-the-dev-servers)** — run the frontend and backend directly. You install Node.js, Python, and uv.

Install the prerequisites for whichever path you choose, then follow that
section below.

## Prerequisites

### For Docker (Option A)

You only need **Docker** with Compose v2 (bundled with modern Docker).

- **macOS / Windows** — install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
- **Linux** — install Docker Engine:

  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

Verify:

```bash
docker --version
docker compose version
```

### For the dev servers (Option B)

You need **Node.js**, **Python ≥ 3.12**, and **uv** (a fast Python package manager).

#### Node.js

The frontend pins **Node 24.5.0** (via [Volta](https://volta.sh/)); any Node ≥ 18 works. Pick one installer:

::: code-group

```bash [Volta — matches the pin]
# Installs Volta, then auto-uses the version pinned in package.json
curl https://get.volta.sh | bash
# restart your shell, then:
volta install node
```

```bash [nvm (macOS/Linux)]
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart your shell, then:
nvm install 24
```

```bash [Homebrew (macOS)]
brew install node
```

```powershell [Windows]
winget install OpenJS.NodeJS.LTS
```

:::

#### uv (and Python)

[uv](https://docs.astral.sh/uv/) installs the backend's dependencies **and can manage Python for you** — so you don't have to install Python separately.

::: code-group

```bash [macOS / Linux]
curl -LsSf https://astral.sh/uv/install.sh | sh
```

```powershell [Windows]
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

```bash [Homebrew (macOS)]
brew install uv
```

:::

After installing uv, get Python 3.12 (skip if you already have it):

```bash
uv python install 3.12
```

Verify everything:

```bash
node --version      # v18+ (24.5.0 recommended)
uv --version
```

## Get the code

```bash
git clone https://github.com/WYZDevin/time-geography-kepler.git
cd time-geography-kepler
```

## Option A — Docker (recommended)

From the project root, build and start the whole stack with one command:

```bash
docker compose up --build
```

Then open **<http://localhost:5173>**. The backend runs on
**<http://localhost:8000>** and the frontend is wired to it automatically.

```bash
docker compose down      # stop and remove the containers
```

::: tip Pre-built images
To skip the local build, pull the published images instead:

```bash
docker compose -f docker-compose.prod.yml up
```
:::

## Option B — Run the dev servers

Run the frontend and (optionally) the backend in two terminals.

### Frontend

```bash
cd app/front-end
cp ../../.env.example .env     # configure environment
npm install
npm run dev                    # Vite dev server → http://localhost:5173
```

The frontend works fully offline — every tool has a browser implementation or is
gracefully disabled when the backend is unavailable.

### Backend (optional)

```bash
cd app/back-end
uv sync                                 # create the venv & install dependencies
uv run flask --app app run -p 8000      # → http://localhost:8000
```

When the backend is running, the frontend detects it via `/api/v1/health` and
enables server-side execution for the [Space-Time Cube](/tools/space-time-cube)
and [Space-Time Prism](/tools/space-time-prism) tools.

::: tip Run both at once
From the repo root you can start both dev servers together:

```bash
npm run dev          # runs ./dev.sh (frontend + backend)
```
:::

## Environment variables

Copy `.env.example` to `app/front-end/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_APP_MODE` | `frontend` | Application mode |
| `VITE_BACKEND_URL` | `http://localhost:8000` | Flask backend URL |

::: warning Build-time value
`VITE_BACKEND_URL` is baked into the frontend bundle at **build time**. If you
point the app at a different backend, rebuild the frontend (or the Docker image).
:::

## Verify your setup

Once the app is running, confirm both halves are healthy:

```bash
# Backend health check
curl http://localhost:8000/api/v1/health
# → {"status":"healthy","version":"1.0.0"}
```

Open **<http://localhost:5173>** — you should see the **Space-Time Analytics
Platform** home screen with the tool picker.

## Your first analysis

1. Click **Data → Upload** and load a trajectory
   (try the bundled `example_day_2022-09-16.geojson`).
2. Pick a tool — start with **3D Trajectory**.
3. Map the **Datetime Column** to your timestamp field (e.g. `date_logged`).
4. Click **Run Analysis** and explore the 3D result.

Full walkthrough: [Running an Analysis](/guide/workflow).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **Port already in use** (5173 / 8000) | Stop the other process, or change the published port in `docker-compose.yml`. |
| **Backend tools are greyed out** | The Flask backend isn't reachable — start it (Option B) or use Docker (Option A). |
| **`uv: command not found`** after install | Restart your shell, or add `~/.local/bin` to your `PATH`. |
| **Frontend can't reach the backend** | Confirm `VITE_BACKEND_URL` matches the backend URL and rebuild if you changed it. |

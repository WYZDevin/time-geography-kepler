# Getting Started

There are two ways to run Time Geography Kepler: with **Docker** (one command,
recommended) or by starting the **dev servers** directly.

## Option A — Docker (recommended)

The whole stack (Flask backend + Nginx-served frontend) runs with one command.
You only need [Docker](https://docs.docker.com/get-docker/) with Compose v2.

```bash
git clone https://github.com/WYZDevin/time-geography-kepler.git
cd time-geography-kepler
docker compose up --build
```

Then open **<http://localhost:5173>**. The backend runs on
**<http://localhost:8000>** and the frontend is wired to it automatically.

```bash
docker compose down      # stop and remove the containers
```

::: tip Pre-built images
To skip the local build, use the published images:

```bash
docker compose -f docker-compose.prod.yml up
```
:::

## Option B — Run the dev servers

### Prerequisites

- **Node.js** (see the `volta` pin in `package.json`)
- **Python ≥ 3.12**
- **[uv](https://docs.astral.sh/uv/getting-started/installation/)** (Python package manager)

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
uv sync                                 # install dependencies
uv run flask --app app run -p 8000      # → http://localhost:8000
```

When the backend is running, the frontend detects it via `/api/v1/health` and
enables server-side execution for backend tools.

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

## Your first analysis

1. Open the app and click **Data → Upload** to load a trajectory
   (try the bundled `example_day_2022-09-16.geojson`).
2. Pick a tool — start with **3D Trajectory**.
3. Map the **Datetime Column** to your timestamp field (e.g. `date_logged`).
4. Click **Run Analysis** and explore the 3D result.

Full walkthrough: [Running an Analysis](/guide/workflow).

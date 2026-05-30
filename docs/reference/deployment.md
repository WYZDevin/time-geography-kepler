# Deployment

## Docker (recommended)

Both services are containerized. The repo ships two compose files:

| File | Use |
|------|-----|
| `docker-compose.yml` | **Builds** both images locally and runs them. |
| `docker-compose.prod.yml` | **Pulls** pre-built images from Docker Hub and runs them. |

### Build & run locally

```bash
docker compose up --build      # → frontend http://localhost:5173, backend http://localhost:8000
docker compose down            # stop
```

### Run from published images

```bash
docker compose -f docker-compose.prod.yml up
```

Published images:

- `yongzwu/time-geography-backend:latest`
- `yongzwu/time-geography-frontend:latest`

### Configuring the backend URL

The frontend bakes `VITE_BACKEND_URL` at **build time**. To target a different
backend, set it before building:

```bash
VITE_BACKEND_URL=https://api.example.com docker compose build frontend
```

or edit the `args` under the `frontend` service in `docker-compose.yml`.

## The images

| Image | Base | Notes |
|-------|------|-------|
| Backend | `python:3.12-slim` + `uv` | Installs locked deps, runs Flask. Health-checked on `/api/v1/health`. |
| Frontend | `node:20` build → `nginx:alpine` | Builds the Vite bundle, serves static files via Nginx. |

The frontend `depends_on` the backend's health check, so it only starts once the
API is ready.

## Building without Docker

```bash
# Frontend → static files in app/front-end/dist
cd app/front-end && npm ci && npm run build

# Backend → run with any WSGI server
cd app/back-end && uv sync
```

## Documentation site

This documentation is a [VitePress](https://vitepress.dev/) site under `docs/`.

```bash
npm install            # once, at the repo root (installs vitepress)
npm run docs:dev       # local preview with hot reload
npm run docs:build     # static output → docs/.vitepress/dist
npm run docs:preview   # serve the built site
```

It deploys automatically to **GitHub Pages** via
`.github/workflows/docs.yml` on every push to `main` that touches `docs/`.
Enable it once in **GitHub → Settings → Pages → Source: GitHub Actions**. The
published URL is:

<https://wyzdevin.github.io/time-geography-kepler/>

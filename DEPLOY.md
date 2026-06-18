# Deploying to Docker Hub

This project ships two production images:

| Image | Source | Serves |
|-------|--------|--------|
| `<namespace>/time-geography-backend` | `app/back-end/Dockerfile` | Flask API via **gunicorn** on port `8000` |
| `<namespace>/time-geography-frontend` | `app/front-end/Dockerfile` | Static React bundle via **nginx** on port `80` |

`<namespace>` defaults to `yongzwu` and is configurable everywhere via the `IMAGE_NAMESPACE` environment variable.

Both images run as non-root users and define container `HEALTHCHECK`s (`GET /api/v1/health` for the backend, `GET /healthz` for the frontend).

---

## 1. Build & push manually

Log in once, then run the helper script. It builds multi-arch (`linux/amd64,linux/arm64`) images with buildx and pushes them.

```bash
docker login                                   # authenticate to Docker Hub

# Push :latest under the default namespace (yongzwu)
./scripts/docker-publish.sh

# Push a specific version tag
./scripts/docker-publish.sh v1.2.0

# Push under a different Docker Hub account
IMAGE_NAMESPACE=myorg ./scripts/docker-publish.sh v1.2.0
```

Useful overrides (environment variables):

| Variable | Default | Purpose |
|----------|---------|---------|
| `IMAGE_NAMESPACE` | `yongzwu` | Docker Hub user/org the images push to |
| `IMAGE_TAG` | `latest` (or 1st arg) | Tag applied alongside `:latest` |
| `PLATFORMS` | `linux/amd64,linux/arm64` | Target architectures |
| `VITE_BACKEND_URL` | `http://localhost:8000` | Backend URL baked into the frontend bundle |
| `PUSH` | `true` | Set `false` to build locally without pushing |

> **Frontend note:** `VITE_BACKEND_URL` is compiled into the JavaScript bundle at build time. The browser calls the backend directly, so this must be the URL the **browser** can reach (e.g. `https://api.example.com`), not an internal Docker hostname. Change it and rebuild to retarget.

---

## 2. Build & push via GitHub Actions

`.github/workflows/docker-publish.yml` builds and pushes both images automatically.

**Triggers**
- Pushing a tag matching `v*` (e.g. `git tag v1.2.0 && git push origin v1.2.0`) — publishes that semver tag plus `latest`.
- Manual run from the **Actions** tab (`workflow_dispatch`), with an optional tag input.

**Required repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `DOCKERHUB_USERNAME` | Docker Hub account — also used as the image namespace |
| `DOCKERHUB_TOKEN` | Docker Hub access token (Account Settings → Security → New Access Token) |

**Optional repository variable**

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_BACKEND_URL` | `http://localhost:8000` | Backend URL baked into the frontend bundle |

---

## 3. Run the published images

```bash
# Pull and run both services from Docker Hub (no local build)
docker compose -f docker-compose.prod.yml up -d

# Pin a namespace / tag
IMAGE_NAMESPACE=myorg IMAGE_TAG=v1.2.0 docker compose -f docker-compose.prod.yml up -d
```

The frontend is exposed on `http://localhost:5173`, the backend on `http://localhost:8000`. The frontend waits for the backend's healthcheck before starting.

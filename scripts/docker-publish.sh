#!/usr/bin/env bash
# Build and push the frontend + backend images to Docker Hub.
#
# Usage:
#   ./scripts/docker-publish.sh [TAG]
#
# Environment variables:
#   IMAGE_NAMESPACE   Docker Hub user/org (default: yongzwu)
#   IMAGE_TAG         Image tag (default: 1st arg, else "latest")
#   PLATFORMS         Target platforms (default: linux/amd64,linux/arm64)
#   VITE_BACKEND_URL  Backend URL baked into the frontend bundle
#                     (default: http://localhost:8000)
#   PUSH              "true" to push, "false" to build only (default: true)
#
# Prerequisites: `docker login` first, and Docker buildx (bundled with modern Docker).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-yongzwu}"
IMAGE_TAG="${IMAGE_TAG:-${1:-latest}}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
VITE_BACKEND_URL="${VITE_BACKEND_URL:-http://localhost:8000}"
PUSH="${PUSH:-true}"

BACKEND_IMAGE="${IMAGE_NAMESPACE}/time-geography-backend"
FRONTEND_IMAGE="${IMAGE_NAMESPACE}/time-geography-frontend"

OUTPUT_FLAG="--push"
if [ "$PUSH" != "true" ]; then
  # --load only supports a single platform; build for the host arch when not pushing.
  OUTPUT_FLAG="--load"
  PLATFORMS="${PLATFORMS%%,*}"
fi

# A persistent buildx builder is required for multi-platform builds.
if ! docker buildx inspect tgk-builder >/dev/null 2>&1; then
  docker buildx create --name tgk-builder --use >/dev/null
else
  docker buildx use tgk-builder
fi

echo ">> Building backend  ${BACKEND_IMAGE}:${IMAGE_TAG}  [${PLATFORMS}]"
docker buildx build \
  --platform "$PLATFORMS" \
  --tag "${BACKEND_IMAGE}:${IMAGE_TAG}" \
  --tag "${BACKEND_IMAGE}:latest" \
  $OUTPUT_FLAG \
  "${ROOT}/app/back-end"

echo ">> Building frontend ${FRONTEND_IMAGE}:${IMAGE_TAG}  [${PLATFORMS}]"
docker buildx build \
  --platform "$PLATFORMS" \
  --build-arg "VITE_BACKEND_URL=${VITE_BACKEND_URL}" \
  --tag "${FRONTEND_IMAGE}:${IMAGE_TAG}" \
  --tag "${FRONTEND_IMAGE}:latest" \
  $OUTPUT_FLAG \
  "${ROOT}/app/front-end"

echo ">> Done."
if [ "$PUSH" = "true" ]; then
  echo "   Pushed ${BACKEND_IMAGE}:${IMAGE_TAG} and ${FRONTEND_IMAGE}:${IMAGE_TAG}"
fi

# syntax=docker/dockerfile:1
# Stage 1: Build
# Pin to the native build arch: the compiled bundle in /app/dist is
# architecture-independent, so building under cross-arch emulation only buys us
# slowness and the npm optional-deps bug (missing @rollup/rollup-*). The final
# nginx stage below is still per-target-arch.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Baked into the bundle at build time — point the browser at the deployed backend.
ARG VITE_BACKEND_URL=http://localhost:8000
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]

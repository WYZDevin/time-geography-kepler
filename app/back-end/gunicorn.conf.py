"""Gunicorn configuration for the time-geography backend.

All values can be overridden via environment variables so the same image works
across deployments without rebuilding. Geospatial tool runs are CPU-bound, so we
default to a small number of sync workers with a generous request timeout.
"""

import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
# WEB_CONCURRENCY is gunicorn's conventional worker-count variable.
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
# Long timeout: some tool runs (STKDE grids, prism intersections) are heavy.
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "180"))
graceful_timeout = 30
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOGLEVEL", "info")

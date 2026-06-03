#!/usr/bin/env python3
"""
Generate synthetic hourly noise environment data (GeoJSON grid) covering the
spatial/temporal extent of a GPS trajectory file.

Output: noise_environment_2022-09-16.geojson
  - Point features (grid centroids), one per (100 m cell × hour)
  - Properties: timestamp (ISO-8601), hour (0–23), noise_db (35–90 dB)
  - CRS: EPSG:4326 (WGS84) — projected internally via UTM 17N (EPSG:32617)

Usage (from project root):
    cd app/back-end && uv run python ../../generate_noise_env.py
    # or from project root if pyproj is installed system-wide:
    python generate_noise_env.py
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import timezone

import numpy as np
from pyproj import Transformer

# ── Configuration ─────────────────────────────────────────────────────────────

INPUT_GEOJSON = os.path.join(os.path.dirname(__file__), "example_day_2022-09-16.geojson")
OUTPUT_GEOJSON = os.path.join(os.path.dirname(__file__), "noise_environment_2022-09-16.geojson")

DATE = "2022-09-16"
CELL_SIZE_M = 100       # metres per side
BUFFER_M = 200          # padding around trajectory bbox
NOISE_MIN = 35.0        # dB
NOISE_MAX = 90.0        # dB
RANDOM_SEED = 42

# ── Temporal noise profile: hourly boost (dB) above spatial base ──────────────
# Models: quiet overnight, morning rush, midday plateau, evening rush
HOURLY_BOOST = {
     0: -8,  1: -11,  2: -13,  3: -13,  4: -10,  5:  -5,
     6:  2,  7:  10,   8:  16,  9:  11, 10:   6, 11:   6,
    12:  6, 13:   6,  14:   6, 15:   9, 16:  13, 17:  20,
    18: 18, 19:  12,  20:   5, 21:   2, 22:  -1, 23:  -5,
}

# ── 1. Read trajectory & compute UTM bounding box ─────────────────────────────

with open(INPUT_GEOJSON) as f:
    traj = json.load(f)

lons = [feat["geometry"]["coordinates"][0] for feat in traj["features"]]
lats = [feat["geometry"]["coordinates"][1] for feat in traj["features"]]

to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32617", always_xy=True)
to_wgs84 = Transformer.from_crs("EPSG:32617", "EPSG:4326", always_xy=True)

xs, ys = to_utm.transform(lons, lats)

# Snap grid to CELL_SIZE_M, add buffer
x_min = math.floor(min(xs) / CELL_SIZE_M) * CELL_SIZE_M - BUFFER_M
y_min = math.floor(min(ys) / CELL_SIZE_M) * CELL_SIZE_M - BUFFER_M
x_max = math.ceil(max(xs)  / CELL_SIZE_M) * CELL_SIZE_M + BUFFER_M
y_max = math.ceil(max(ys)  / CELL_SIZE_M) * CELL_SIZE_M + BUFFER_M

n_cols = round((x_max - x_min) / CELL_SIZE_M)
n_rows = round((y_max - y_min) / CELL_SIZE_M)
n_cells = n_cols * n_rows
total_features = n_cells * 24

print(f"Grid      : {n_cols} cols × {n_rows} rows = {n_cells:,} cells")
print(f"Features  : {n_cells:,} cells × 24 h = {total_features:,}")
print(f"Est. size : ~{total_features * 130 // 1_000_000} MB (uncompressed)")

# ── 2. Spatial noise base (smooth, reproducible) ──────────────────────────────

rng = np.random.default_rng(RANDOM_SEED)

# Cell-centre UTM coordinates — shape (n_rows, n_cols)
cx = x_min + (np.arange(n_cols, dtype=np.float64) + 0.5) * CELL_SIZE_M
cy = y_min + (np.arange(n_rows, dtype=np.float64) + 0.5) * CELL_SIZE_M
CX, CY = np.meshgrid(cx, cy)

def _smooth_layer(seed: int, wavelength_m: float, amplitude: float) -> np.ndarray:
    """One sinusoidal noise layer — simulates spatial correlation at a given scale."""
    r = np.random.default_rng(seed)
    px, py = r.uniform(0, 2 * math.pi, size=2)
    return amplitude * (
        0.5 + 0.5 * np.sin(2 * math.pi * CX / wavelength_m + px)
              * np.sin(2 * math.pi * CY / wavelength_m + py)
    )

# Combine scales: major roads (~2 km), blocks (~500 m), micro-variation (~150 m)
spatial_field = (
    _smooth_layer(1, 2000, 0.40) +
    _smooth_layer(2,  500, 0.35) +
    _smooth_layer(3,  150, 0.15) +
    rng.uniform(0, 0.10, (n_rows, n_cols))
)
spatial_field /= spatial_field.max()   # normalise 0–1

# Map to dB range leaving headroom for temporal boost:
# spatial base: 35–68 dB; temporal adds up to +20 dB → max ~88 dB before clamp
SPATIAL_DB_MIN = 35.0
SPATIAL_DB_MAX = 68.0
base_db = SPATIAL_DB_MIN + spatial_field * (SPATIAL_DB_MAX - SPATIAL_DB_MIN)   # (n_rows, n_cols)

# Pre-compute WGS84 centroids for all cells — shape (n_rows * n_cols,)
cx_flat = CX.ravel()
cy_flat = CY.ravel()
lon_flat, lat_flat = to_wgs84.transform(cx_flat, cy_flat)

# ── 3. Build GeoJSON features ─────────────────────────────────────────────────

features: list[dict] = []

for hour in range(24):
    timestamp = f"{DATE}T{hour:02d}:00:00Z"
    boost = HOURLY_BOOST[hour]

    # Vectorised: base + hourly boost + small random perturbation per cell
    noise_db = base_db + boost + rng.normal(0.0, 2.5, (n_rows, n_cols))
    noise_db = np.clip(noise_db, NOISE_MIN, NOISE_MAX).ravel()

    for idx in range(n_cells):
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon_flat[idx], 6), round(lat_flat[idx], 6)],
            },
            "properties": {
                "timestamp": timestamp,
                "hour": hour,
                "noise_db": round(float(noise_db[idx]), 1),
            },
        })

# ── 4. Write output ───────────────────────────────────────────────────────────

fc = {"type": "FeatureCollection", "features": features}
with open(OUTPUT_GEOJSON, "w") as f:
    json.dump(fc, f, separators=(",", ":"))

size_mb = os.path.getsize(OUTPUT_GEOJSON) / 1_000_000
print(f"\nWrote {len(features):,} features → {OUTPUT_GEOJSON}")
print(f"File size : {size_mb:.1f} MB")
print("\nProperty schema:")
print("  timestamp  : ISO-8601 hourly string (e.g. '2022-09-16T08:00:00Z')")
print("  hour       : integer 0–23")
print("  noise_db   : float dB, range 35–90")
print("\nTo use with the Space-Time Cube tool:")
print("  • Load this file as the environment dataset")
print("  • Set time attribute → 'timestamp'")
print("  • Set value attribute → 'noise_db'")

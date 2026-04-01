"""
Test script to directly call STKDETool.execute() with sample data
and inspect the output structure in detail.
"""

import random
from datetime import UTC, datetime, timedelta

import geopandas as gpd
import numpy as np
from shapely.geometry import Point

from app.tools.stkde import STKDETool

# ── 1. Create a GeoDataFrame with ~20 random points ──────────────────────
random.seed(42)
np.random.seed(42)

center_lng, center_lat = -122.4, 37.8
n_points = 20
base_time = datetime(2025, 6, 15, 0, 0, 0, tzinfo=UTC)

points = []
timestamps = []
for i in range(n_points):
    lng = center_lng + np.random.uniform(-0.02, 0.02)
    lat = center_lat + np.random.uniform(-0.02, 0.02)
    ts = base_time + timedelta(hours=i * (24.0 / n_points))
    points.append(Point(lng, lat))
    timestamps.append(ts.isoformat())

gdf = gpd.GeoDataFrame(
    {"timestamp": timestamps},
    geometry=points,
    crs="EPSG:4326",
)

print("=" * 70)
print("INPUT DATA")
print("=" * 70)
print(f"Number of input points: {len(gdf)}")
print(f"Columns: {list(gdf.columns)}")
print(f"CRS: {gdf.crs}")
print(f"Time range: {timestamps[0]} -> {timestamps[-1]}")
print(f"Bounds: {gdf.total_bounds}")
print()

# ── 2. Call STKDETool().execute() ─────────────────────────────────────────
tool = STKDETool()
results = tool.execute(gdf, {}, {"time": "timestamp"})

print("=" * 70)
print("OUTPUT OVERVIEW")
print("=" * 70)
print(f"Number of output GeoDataFrames: {len(results)}")
for idx, r in enumerate(results):
    print(f"  GDF[{idx}]: {len(r)} features, CRS={r.crs}")
print()

# ── 3. Per-GDF details ───────────────────────────────────────────────────
for idx, r in enumerate(results):
    print("=" * 70)
    print(f"GDF[{idx}] — DETAILED INSPECTION")
    print("=" * 70)

    if r.empty:
        print("  (empty GeoDataFrame — no features)")
        print()
        continue

    print(f"  Feature count: {len(r)}")
    print(f"  Columns: {list(r.columns)}")
    print("  Dtypes:")
    for col in r.columns:
        print(f"    {col}: {r[col].dtype}")
    print()

    # ── First feature properties ─────────────────────────────────────
    first = r.iloc[0]
    print("  First feature properties (all keys & values):")
    for col in r.columns:
        if col == "geometry":
            continue
        val = first[col]
        print(f"    {col!r}: {val!r}  (type: {type(val).__name__})")
    print()

    # ── Geometry inspection ──────────────────────────────────────────
    geom = first.geometry
    print(f"  Geometry type: {geom.geom_type}")
    print(f"  Has Z (3D): {geom.has_z}")

    # Check coordinates for Z values
    if geom.geom_type == "Polygon":
        ring = list(geom.exterior.coords)
        print(f"  Exterior ring length: {len(ring)} coordinates")
        print(f"  First coordinate: {ring[0]}")
        print(f"  Coordinate dimensions: {len(ring[0])}")
        if len(ring[0]) > 2:
            z_values = [c[2] for c in ring]
            print(f"  Z values in ring: {z_values}")
    elif geom.geom_type == "Point":
        coords = list(geom.coords)[0]
        print(f"  Coordinate: {coords}")
        print(f"  Coordinate dimensions: {len(coords)}")

    print()

    # ── Value ranges for numeric properties ──────────────────────────
    print("  Value ranges for numeric columns:")
    for col in r.columns:
        if col == "geometry":
            continue
        if r[col].dtype in (np.float64, np.int64, np.int32, float, int):
            print(f"    {col}: min={r[col].min()}, max={r[col].max()}")
    print()

# ── 4. Summary: complete property key list per GDF ────────────────────────
print("=" * 70)
print("COMPLETE PROPERTY KEY SUMMARY (backend execute() output)")
print("=" * 70)
for idx, r in enumerate(results):
    keys = [c for c in r.columns if c != "geometry"]
    print(f"  GDF[{idx}]: {keys}")
print()

# ── 5. GeoJSON conversion (what goes through the API) ────────────────────
from app.utils import gdf_to_geojson

print("=" * 70)
print("GeoJSON CONVERSION (via gdf_to_geojson)")
print("=" * 70)
for idx, r in enumerate(results):
    fc = gdf_to_geojson(r)
    print(f"  FC[{idx}]: {len(fc['features'])} features")
    if fc["features"]:
        feat = fc["features"][0]
        print(f"    Geometry type: {feat['geometry']['type']}")
        # Check if geometry has Z
        if feat["geometry"]["type"] == "Polygon":
            ring = feat["geometry"]["coordinates"][0]
            print(f"    First coord: {ring[0]}")
            print(f"    Coord dimensions: {len(ring[0])}")
        print(f"    Properties keys: {list(feat['properties'].keys())}")
        print("    Properties values:")
        for k, v in feat["properties"].items():
            print(f"      {k!r}: {v!r}  (type: {type(v).__name__})")
    print()

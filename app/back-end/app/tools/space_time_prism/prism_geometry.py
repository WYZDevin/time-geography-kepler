import math

import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

from app.constants import PROCESSED_HEIGHT_FIELD
from .utils import _cell_polygon, _create_circle, _lift_polygon_z


def _euclidean_anchor_prism_rows(
    p1: dict,
    p2: dict,
    speed_ms: float,
    dt_s: float,
    num_slices: int,
    total_height: float,
    slice_height: float,
    show_ppa: bool,
    z_offset: float = 0.0,
) -> tuple[list[dict], list[Polygon]]:
    prism_rows: list[dict] = []
    ppa_polys: list[Polygon] = []

    for s in range(1, num_slices):
        t_frac = s / num_slices
        z_height = z_offset + t_frac * total_height
        r1 = speed_ms * dt_s * t_frac
        r2 = speed_ms * dt_s * (1 - t_frac)
        if r1 <= 0 or r2 <= 0:
            continue

        cross = _create_circle(p1["lng"], p1["lat"], r1, steps=48).intersection(
            _create_circle(p2["lng"], p2["lat"], r2, steps=48)
        )
        if cross.is_empty:
            continue

        prism_rows.append({
            "geometry": _lift_polygon_z(cross, z_height),
            "_slice": s,
            "_time_progress": t_frac,
            "_timestamp": float(p1["timestamp"] + t_frac * (p2["timestamp"] - p1["timestamp"])),
            PROCESSED_HEIGHT_FIELD: slice_height,
            "_slice_height": slice_height,
            "z": z_height,
            "_dataset_type": "space-time-prism",
            "_layer_config": "prism-3d",
        })
        if show_ppa:
            ppa_polys.append(cross)

    return prism_rows, ppa_polys


def _network_anchor_prism_rows(
    p1: dict,
    p2: dict,
    speed_ms: float,
    dt_s: float,
    num_slices: int,
    total_height: float,
    slice_height: float,
    show_ppa: bool,
    z_offset: float = 0.0,
) -> tuple[list[dict], list[Polygon]]:
    """Grid-based backend equivalent of the frontend network prism approximation."""
    max_reach_m = speed_ms * dt_s
    buffer_deg = (max_reach_m / 111_000) * 1.1
    min_lng = min(p1["lng"], p2["lng"]) - buffer_deg
    max_lng = max(p1["lng"], p2["lng"]) + buffer_deg
    min_lat = min(p1["lat"], p2["lat"]) - buffer_deg
    max_lat = max(p1["lat"], p2["lat"]) + buffer_deg

    grid_size = 60
    cell_deg = max(max_lng - min_lng, max_lat - min_lat) / grid_size
    cell_m = cell_deg * 111_000
    rows = max(1, math.ceil((max_lat - min_lat) / cell_deg))
    cols = max(1, math.ceil((max_lng - min_lng) / cell_deg))

    seed = abs(round((p1["lng"] + p2["lat"]) * 100_000)) % 1_000_000
    passable = np.ones((rows, cols), dtype=bool)
    for row in range(rows):
        for col in range(cols):
            hashed = ((seed + row * 7919 + col * 6271) * 2654435761) & 0xFFFFFFFF
            passable[row, col] = hashed % 100 >= 15

    src_row, src_col = _grid_cell_for_anchor(p1, min_lng, min_lat, cell_deg, rows, cols)
    dst_row, dst_col = _grid_cell_for_anchor(p2, min_lng, min_lat, cell_deg, rows, cols)
    _clear_anchor_corridor(passable, src_row, src_col, dst_row, dst_col)

    dist_a = _grid_travel_times(passable, src_row, src_col, speed_ms, dt_s, cell_m)
    dist_b = _grid_travel_times(passable, dst_row, dst_col, speed_ms, dt_s, cell_m)

    prism_rows: list[dict] = []
    ppa_polys: list[Polygon] = []
    for s in range(1, num_slices):
        t_frac = s / num_slices
        budget_a = dt_s * t_frac
        budget_b = dt_s * (1 - t_frac)
        cells = []
        for row in range(rows):
            for col in range(cols):
                idx = row * cols + col
                if dist_a[idx] <= budget_a and dist_b[idx] <= budget_b:
                    cells.append(_cell_polygon(min_lng, min_lat, cell_deg, col, row))
        if not cells:
            continue
        cross = unary_union(cells)
        if cross.is_empty:
            continue

        z_height = z_offset + t_frac * total_height
        prism_rows.append({
            "geometry": _lift_polygon_z(cross, z_height),
            "_slice": s,
            "_time_progress": t_frac,
            "_timestamp": float(p1["timestamp"] + t_frac * (p2["timestamp"] - p1["timestamp"])),
            PROCESSED_HEIGHT_FIELD: slice_height,
            "_slice_height": slice_height,
            "z": z_height,
            "_dataset_type": "space-time-prism",
            "_layer_config": "prism-3d",
        })
        if show_ppa:
            ppa_polys.append(cross)

    return prism_rows, ppa_polys


def _grid_cell_for_anchor(anchor: dict, min_lng: float, min_lat: float, cell_deg: float, rows: int, cols: int) -> tuple[int, int]:
    row = min(rows - 1, max(0, math.floor((anchor["lat"] - min_lat) / cell_deg)))
    col = min(cols - 1, max(0, math.floor((anchor["lng"] - min_lng) / cell_deg)))
    return row, col


def _clear_anchor_corridor(passable: np.ndarray, src_row: int, src_col: int, dst_row: int, dst_col: int) -> None:
    rows, cols = passable.shape
    step_r = 0 if dst_row == src_row else (1 if dst_row > src_row else -1)
    step_c = 0 if dst_col == src_col else (1 if dst_col > src_col else -1)
    row, col = src_row, src_col
    for _ in range(rows + cols):
        for dr in range(-1, 2):
            for dc in range(-1, 2):
                nr, nc = row + dr, col + dc
                if 0 <= nr < rows and 0 <= nc < cols:
                    passable[nr, nc] = True
        if row == dst_row and col == dst_col:
            break
        if row != dst_row:
            row += step_r
        if col != dst_col:
            col += step_c


def _grid_travel_times(
    passable: np.ndarray,
    src_row: int,
    src_col: int,
    speed_ms: float,
    max_time_s: float,
    cell_m: float,
) -> np.ndarray:
    rows, cols = passable.shape
    distances = np.full(rows * cols, np.inf)
    distances[src_row * cols + src_col] = 0.0
    queue = [(src_row, src_col, 0.0)]
    directions = (
        (-1, -1, math.sqrt(2)), (-1, 0, 1), (-1, 1, math.sqrt(2)),
        (0, -1, 1), (0, 1, 1),
        (1, -1, math.sqrt(2)), (1, 0, 1), (1, 1, math.sqrt(2)),
    )

    while queue:
        min_idx = min(range(len(queue)), key=lambda idx: queue[idx][2])
        row, col, travel_time = queue.pop(min_idx)
        if travel_time > distances[row * cols + col]:
            continue
        for dr, dc, multiplier in directions:
            nr, nc = row + dr, col + dc
            if nr < 0 or nr >= rows or nc < 0 or nc >= cols or not passable[nr, nc]:
                continue
            next_time = travel_time + (cell_m * multiplier) / speed_ms
            idx = nr * cols + nc
            if next_time <= max_time_s and next_time < distances[idx]:
                distances[idx] = next_time
                queue.append((nr, nc, next_time))
    return distances

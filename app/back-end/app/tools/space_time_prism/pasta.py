from collections import defaultdict

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from app.constants import PROCESSED_HEIGHT_FIELD
from .utils import (
    ActivityEpisode,
    AnchorWindow,
    _parse_epoch_ms,
)


def _build_activity_episodes(
    gdf: gpd.GeoDataFrame,
    *,
    time_field: str,
    end_time_field: str,
    person_field: str,
    activity_field: str,
    mode_field: str,
    weight_field: str,
    fixed_types: set[str],
    flexible_types: set[str],
    default_mode: str,
) -> list[ActivityEpisode]:
    """Parse gdf rows into ActivityEpisode records, grouped and sorted by person.

    gdf columns:
        geometry           : Point            required
        <time_field>       : str | numeric    required; activity start timestamp
        <end_time_field>   : str | numeric    optional; activity end timestamp;
                                              defaults to next episode's start
                                              (or start + 30 min for the last)
        <person_field>     : any              optional; rows missing it are
                                              grouped as "person-1"
        <activity_field>   : str              optional; matched against fixed_types
                                              and flexible_types to set is_fixed
        <mode_field>       : str              optional; travel mode for the episode
        <weight_field>     : numeric          optional; sampling/expansion weight
        "is_fixed"         : bool             optional; explicit fixed/flexible
                                              override when activity_type is not
                                              in fixed_types or flexible_types
    """
    grouped: dict[str, list[tuple[int, object]]] = defaultdict(list)
    for idx, row in gdf.iterrows():
        person_id = str(row[person_field]) if person_field in gdf.columns and pd.notna(row[person_field]) else "person-1"
        grouped[person_id].append((idx, row))

    episodes: list[ActivityEpisode] = []
    for person_id, rows in grouped.items():
        parsed = []
        for idx, row in rows:
            start_ms = _parse_epoch_ms(row.get(time_field))
            if start_ms is None:
                continue
            parsed.append((start_ms, idx, row))
        parsed.sort(key=lambda item: item[0])

        for local_idx, (start_ms, original_idx, row) in enumerate(parsed):
            if end_time_field and end_time_field in gdf.columns:
                end_ms = _parse_epoch_ms(row.get(end_time_field))
            else:
                end_ms = parsed[local_idx + 1][0] if local_idx + 1 < len(parsed) else start_ms + 30 * 60_000
            if end_ms is None or end_ms <= start_ms:
                continue

            activity_type = (
                str(row[activity_field]).strip().lower()
                if activity_field in gdf.columns and pd.notna(row[activity_field])
                else ""
            )
            if activity_type in fixed_types:
                is_fixed = True
            elif activity_type in flexible_types:
                is_fixed = False
            else:
                is_fixed = bool(row.get("is_fixed", False)) if "is_fixed" in gdf.columns else False

            mode = (
                str(row[mode_field]).strip().lower()
                if mode_field and mode_field in gdf.columns and pd.notna(row[mode_field])
                else default_mode
            )
            weight = 1.0
            if weight_field and weight_field in gdf.columns and pd.notna(row[weight_field]):
                try:
                    weight = float(row[weight_field])
                except (TypeError, ValueError):
                    weight = 1.0

            episodes.append(ActivityEpisode(
                person_id=person_id,
                index=int(original_idx),
                x=float(row.geometry.x),
                y=float(row.geometry.y),
                start_ms=int(start_ms),
                end_ms=int(end_ms),
                activity_type=activity_type,
                mode=mode,
                weight=weight,
                is_fixed=is_fixed,
            ))
    return episodes


def _build_anchor_windows(episodes: list[ActivityEpisode]) -> list[AnchorWindow]:
    by_person: dict[str, list[ActivityEpisode]] = defaultdict(list)
    for episode in episodes:
        by_person[episode.person_id].append(episode)

    windows: list[AnchorWindow] = []
    for person_id, person_eps in by_person.items():
        person_eps.sort(key=lambda e: e.start_ms)
        i = 0
        while i < len(person_eps):
            if person_eps[i].is_fixed:
                i += 1
                continue
            flex_start = i
            while i < len(person_eps) and not person_eps[i].is_fixed:
                i += 1
            flex_end = i - 1
            prev_fixed = person_eps[flex_start - 1] if flex_start > 0 and person_eps[flex_start - 1].is_fixed else None
            next_fixed = person_eps[i] if i < len(person_eps) and person_eps[i].is_fixed else None
            if not prev_fixed or not next_fixed:
                continue
            flex = tuple(ep.index for ep in person_eps[flex_start:flex_end + 1])
            mode = person_eps[flex_start].mode or prev_fixed.mode
            weight = max(ep.weight for ep in person_eps[flex_start:flex_end + 1])
            windows.append(AnchorWindow(
                person_id=person_id,
                window_id=f"{person_id}-{len(windows)}",
                start=prev_fixed,
                end=next_fixed,
                flexible_indices=flex,
                mode=mode,
                weight=weight,
            ))
    return windows


def _anchor_rows(window: AnchorWindow, global_start: int, z_per_ms: float, scenario_name: str) -> list[dict]:
    rows = []
    for role, ep, timestamp in (
        ("start_anchor", window.start, window.start.end_ms),
        ("end_anchor", window.end, window.end.start_ms),
    ):
        z = (timestamp - global_start) * z_per_ms
        rows.append({
            "geometry": Point(ep.x, ep.y, z),
            "_dataset_type": "pasta-anchor-windows",
            "_layer_config": "pasta-anchors",
            "_timestamp": float(timestamp),
            "_time_progress": 0,
            PROCESSED_HEIGHT_FIELD: z,
            "person_id": window.person_id,
            "window_id": window.window_id,
            "anchor_role": role,
            "activity_type": ep.activity_type,
            "mode": window.mode,
            "scenario": scenario_name,
            "weight": window.weight,
        })
    return rows

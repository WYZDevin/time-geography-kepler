"""Shared time-slice boundary computation for STKDE and Space-Time Cube.

Both tools divide the observation period into time slices. Three methods:

  equal_interval  N slices of equal duration over [t_min, t_max] (default —
                  the historical behaviour).
  equal_count     N slices holding ~equal point counts (quantile edges); slices
                  are uneven in duration but balanced in data.
  fixed_duration  Slices of a fixed wall-clock duration, aligned to an anchor
                  origin; the slice count is derived from the data span.

All times are in the same seconds domain as the caller's ``t_seconds`` array
(elapsed seconds from the run's reference instant).

Anything the helper does that differs from what the user asked for (collapsed
quantiles, capped slice counts) is reported through the optional ``warnings``
list so it can surface in ``runMeta.warnings`` instead of happening silently.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

SLICE_METHODS = ("equal_interval", "equal_count", "fixed_duration")

# Cap on fixed-duration slices so a tiny duration over a long span cannot
# explode the grid; the duration is widened to fit when the cap is hit.
MAX_FIXED_SLICES = 240


def parse_anchor_seconds(anchor: object, t_min_ms: int) -> float | None:
    """Convert a wall-clock anchor to elapsed seconds from ``t_min_ms``.

    Accepts an ISO datetime string or an epoch number (seconds when |v| < 1e12,
    otherwise milliseconds). Returns ``None`` for blank/unparseable input, which
    callers treat as "anchor at the first data point".
    """
    if anchor is None:
        return None
    if isinstance(anchor, str):
        if not anchor.strip():
            return None
        try:
            ms = pd.Timestamp(anchor).value / 1e6  # ns -> ms
        except Exception:
            return None
    elif isinstance(anchor, (int, float)):
        v = float(anchor)
        ms = v * 1000.0 if abs(v) < 1e12 else v
    else:
        return None
    return (ms - t_min_ms) / 1000.0


def slice_edges(
    t_seconds: np.ndarray,
    method: str,
    n_slices: int,
    duration_s: float | None = None,
    anchor_s: float | None = None,
    warnings: list[str] | None = None,
) -> np.ndarray:
    """Return monotonically increasing slice boundary times (length k+1, k>=1).

    ``duration_s`` and ``anchor_s`` are only consulted for ``fixed_duration``;
    a missing/non-positive duration raises so the user gets a clear error
    instead of a silent single-slice result.
    """
    t_min = float(np.min(t_seconds))
    t_max = float(np.max(t_seconds))
    if t_max <= t_min:
        return np.array([t_min, t_min + 1.0])

    n = max(int(n_slices), 1)

    if method == "equal_count":
        edges = np.quantile(t_seconds, np.linspace(0.0, 1.0, n + 1))
        edges = np.unique(edges)  # collapse duplicate quantiles (heavy ties)
        if edges.size < 2:
            return np.array([t_min, t_max])
        if edges.size < n + 1 and warnings is not None:
            warnings.append(
                f"Equal count produced {edges.size - 1} time slices instead of "
                f"{n} because many points share the same timestamps."
            )
        edges[0], edges[-1] = t_min, t_max
        return edges

    if method == "fixed_duration":
        if not duration_s or duration_s <= 0:
            raise ValueError(
                "Slice Duration (hours) must be greater than 0 when using the "
                "Fixed duration time slice method"
            )
        dur = float(duration_s)
        origin = float(anchor_s) if anchor_s is not None else t_min
        # Snap the origin down onto/just below t_min along the duration lattice
        # so the first slice always covers the earliest point.
        start = origin + math.floor((t_min - origin) / dur) * dur
        n_steps = max(1, math.ceil((t_max - start) / dur))
        if n_steps > MAX_FIXED_SLICES:
            # Too many slices: widen the duration to fit the safety cap.
            n_steps = MAX_FIXED_SLICES
            wide = (t_max - start) / n_steps
            if warnings is not None:
                warnings.append(
                    f"A {dur / 3600:g}h slice duration would create {math.ceil((t_max - start) / dur)} "
                    f"slices; widened to {wide / 3600:.2f}h to stay within {MAX_FIXED_SLICES} slices."
                )
            dur = wide
        return start + dur * np.arange(n_steps + 1)

    # equal_interval (default)
    return np.linspace(t_min, t_max, n + 1)

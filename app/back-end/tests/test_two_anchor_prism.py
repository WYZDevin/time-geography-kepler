"""Tests for the two-anchor network space-time prism.

Covers the per-edge two-cone interval math (``feasible_intervals``) and an
end-to-end run of ``execute_network_anchor_prism`` on a synthetic straight road.
"""
from __future__ import annotations

import pytest
from shapely.geometry import LineString

from app.tools.space_time_prism.network_prism import (
    _anchor_ellipse_bbox,
    _corridor_bbox_to_area,
    execute_network_anchor_prism,
)
from app.tools.space_time_prism.ppa_engine import make_mode_profile
from app.tools.space_time_prism.ppa_engine.extent import (
    compute_padded_extent,
    extent_area_km2,
)
from app.tools.space_time_prism.ppa_engine.graph_cache import clear_cache
from app.tools.space_time_prism.ppa_engine.two_anchor import (
    _cone_lines,
    feasible_intervals,
)


@pytest.fixture(autouse=True)
def _clear_graph_cache():
    clear_cache()
    yield
    clear_cache()


# ────────────────────────────────────────────────────────────────────────
# Per-edge two-cone interval math
# ────────────────────────────────────────────────────────────────────────

class TestFeasibleIntervals:
    def _lines_a_at_u_b_at_v(self):
        # A at endpoint u, B at endpoint v, edge cost 100s.
        lines_a = _cone_lines(du=0.0, dv=100.0, c=100.0, is_snap_edge=False, snap_fraction=0.0)
        lines_b = _cone_lines(du=100.0, dv=0.0, c=100.0, is_snap_edge=False, snap_fraction=0.0)
        return lines_a, lines_b

    def test_corridor_total_travel_is_edge_cost(self):
        # On the direct corridor g(s) = d_a + d_b = edge cost everywhere = 100.
        lines_a, lines_b = self._lines_a_at_u_b_at_v()
        # K well above 100 → whole edge feasible.
        assert feasible_intervals(lines_a, lines_b, budget_k=200.0) == [(0.0, 1.0)]

    def test_infeasible_when_budget_below_shortest_path(self):
        lines_a, lines_b = self._lines_a_at_u_b_at_v()
        assert feasible_intervals(lines_a, lines_b, budget_k=50.0) == []

    def test_partial_interval_when_both_anchors_same_end(self):
        # A and B both at u → reaching fraction s costs 2 * 100 * s (round trip).
        lines_a = _cone_lines(du=0.0, dv=100.0, c=100.0, is_snap_edge=False, snap_fraction=0.0)
        lines_b = _cone_lines(du=0.0, dv=100.0, c=100.0, is_snap_edge=False, snap_fraction=0.0)
        # g(s) = 200 s ≤ 100  → s ≤ 0.5
        intervals = feasible_intervals(lines_a, lines_b, budget_k=100.0)
        assert len(intervals) == 1
        a, b = intervals[0]
        assert a == pytest.approx(0.0, abs=1e-6)
        assert b == pytest.approx(0.5, abs=1e-6)


# ────────────────────────────────────────────────────────────────────────
# Reachability-ellipse download extent
# ────────────────────────────────────────────────────────────────────────

class TestEllipseExtent:
    def _anchors(self, km_apart: float):
        import math
        lat = 42.3
        dlng = km_apart / (111.320 * math.cos(math.radians(lat)))
        return {"lng": -83.0, "lat": lat}, {"lng": -83.0 + dlng, "lat": lat}

    def test_ellipse_far_smaller_than_box_buffer(self):
        prof = make_mode_profile("driving")
        a, b = self._anchors(30.0)
        k = 3300.0
        import numpy as np
        old = compute_padded_extent(
            np.array([a["lng"], b["lng"]]), np.array([a["lat"], b["lat"]]),
            prof, k, anchor_a=a, anchor_b=b,
        )
        new = _anchor_ellipse_bbox(a, b, prof, k)
        assert extent_area_km2(new) < 0.4 * extent_area_km2(old)

    def test_ellipse_contains_both_anchors(self):
        prof = make_mode_profile("driving")
        a, b = self._anchors(30.0)
        west, south, east, north = _anchor_ellipse_bbox(a, b, prof, 3300.0)
        for pt in (a, b):
            assert west <= pt["lng"] <= east
            assert south <= pt["lat"] <= north

    def test_corridor_stays_tight_as_anchors_separate(self):
        # Pushing the anchors apart spends more of the budget on the trip, so
        # the perpendicular slack shrinks — area must not blow up.
        prof = make_mode_profile("driving")
        near = _anchor_ellipse_bbox(*self._anchors(30.0), prof, 3300.0)
        far = _anchor_ellipse_bbox(*self._anchors(55.0), prof, 3300.0)
        assert extent_area_km2(far) <= extent_area_km2(near) * 1.2

    def test_corridor_clamp_hits_cap_and_contains_anchors(self):
        a, b = self._anchors(40.0)
        bbox = _corridor_bbox_to_area(a, b, 50_000.0)
        assert extent_area_km2(bbox) == pytest.approx(50_000.0, rel=1e-3)
        west, south, east, north = bbox
        for pt in (a, b):
            assert west <= pt["lng"] <= east
            assert south <= pt["lat"] <= north

    def test_corridor_clamp_keeps_anchors_even_when_span_exceeds_cap(self):
        # Anchors farther apart than the cap → margin clamps to 0 but both
        # anchors still sit inside the returned box.
        a = {"lng": -90.0, "lat": 30.0}
        b = {"lng": -70.0, "lat": 45.0}
        west, south, east, north = _corridor_bbox_to_area(a, b, 5_000.0)
        assert west <= -90.0 and east >= -70.0
        assert south <= 30.0 and north >= 45.0


# ────────────────────────────────────────────────────────────────────────
# End-to-end on a synthetic straight road
# ────────────────────────────────────────────────────────────────────────

# ~2.23 km straight road near the equator (1 deg lon ≈ 111.32 km at lat 0).
_ROAD = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[0.0, 0.0], [0.005, 0.0], [0.010, 0.0],
                                [0.015, 0.0], [0.020, 0.0]],
            },
            "properties": {"highway": "residential"},
        }
    ],
}

# Walking 5 km/h ⇒ ~1603 s to cross the whole 2.23 km road.
_ANCHOR_A = {"lng": 0.0, "lat": 0.0, "alt": 0.0, "timestamp": 0, "label": "A"}
_ANCHOR_B = {"lng": 0.020, "lat": 0.0, "alt": 1000.0, "timestamp": 3_000_000, "label": "B"}


def _opts(**overrides):
    base = {
        "speedMode": "walking",
        "minActivityMinutes": 5,
        "timeSlices": 6,
        "roadNetworkData": _ROAD,
        "autoDownloadOSM": False,
    }
    base.update(overrides)
    return base


def _run(**overrides):
    return execute_network_anchor_prism(
        _ANCHOR_A, _ANCHOR_B, _opts(**overrides),
        z_start=0.0, z_end=1000.0, total_height=1000.0,
    )


class TestEndToEnd:
    def test_returns_prism_and_anchors(self):
        outputs = _run()
        assert len(outputs) == 2
        prism, anchors = outputs
        assert not prism.empty
        assert (prism["_dataset_type"] == "ppa-road-network").all()
        assert len(anchors) == 2

    def test_segments_have_3d_geometry_and_activity(self):
        prism = _run()[0]
        # Each edge is lifted to a per-edge height within [0, total_height].
        all_z = [c[2] for f in prism.geometry for c in f.coords]
        assert all(0.0 <= z <= 1000.0 + 1e-6 for z in all_z)
        assert max(all_z) > 0.0  # roads near B rise toward the top
        assert (prism["activity_sec_max"] >= 0).all()

    def test_kept_segments_can_meet_min_activity(self):
        # A kept edge is in the PPA, so its best point offers >= the activity
        # floor (activity_sec_max = T - g_min). Boundary edges are over-included
        # whole, so the *min* may dip below the floor — only the max is a promise.
        min_activity_sec = 10 * 60
        prism = _run(minActivityMinutes=10)[0]
        assert (prism["activity_sec_max"] >= min_activity_sec - 1e-3).all()

    def test_infeasible_budget_raises(self):
        # 1000 s budget < ~1603 s shortest path → infeasible.
        with pytest.raises(ValueError, match="infeasible|exceed"):
            execute_network_anchor_prism(
                _ANCHOR_A,
                {**_ANCHOR_B, "timestamp": 1_000_000},
                _opts(minActivityMinutes=1),
                z_start=0.0, z_end=1000.0, total_height=1000.0,
            )

    def test_anchor_far_from_road_raises(self):
        with pytest.raises(ValueError, match="too far from any road"):
            execute_network_anchor_prism(
                {**_ANCHOR_A, "lat": 5.0},  # 550 km away
                _ANCHOR_B,
                _opts(),
                z_start=0.0, z_end=1000.0, total_height=1000.0,
            )

    def test_prism_has_varied_heights(self):
        # Per-edge time-window heights → roads spread across the Z axis (low near
        # A, high near B), not a single flat level.
        zs = {round(c[2], 1) for f in _run()[0].geometry for c in f.coords}
        assert len(zs) > 1

    def test_render_cap_subsamples(self):
        prism = _run(maxRenderSegments=1000)[0]
        assert len(prism) <= 1000

    def test_graph_guard_raises_fast(self):
        # Force the graph-size backstop with a tiny cap.
        with pytest.raises(ValueError, match="too large"):
            _run(maxGraphEdges=1)

    def test_huge_extent_fails_fast_without_download(self):
        # 5.5 h driving budget over tiny spatial separation → reachability extent
        # is ~100× the cap, so it must reject before any Overpass call.
        with pytest.raises(ValueError, match="too large to fetch"):
            execute_network_anchor_prism(
                {"lng": 0.0, "lat": 0.0, "alt": 0.0, "timestamp": 0, "label": "A"},
                {"lng": 0.02, "lat": 0.0, "alt": 0.0, "timestamp": 20_000_000, "label": "B"},
                {"speedMode": "driving", "minActivityMinutes": 5, "autoDownloadOSM": True},
                z_start=0.0, z_end=1000.0, total_height=1000.0,
            )

    def test_no_road_network_raises(self):
        with pytest.raises(ValueError, match="No road network"):
            execute_network_anchor_prism(
                _ANCHOR_A, _ANCHOR_B,
                {"speedMode": "walking", "autoDownloadOSM": False},
                z_start=0.0, z_end=1000.0, total_height=1000.0,
            )

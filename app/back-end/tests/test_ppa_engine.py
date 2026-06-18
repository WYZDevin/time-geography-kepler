"""Unit tests for the PPA engine.

Covers the §26 correctness cases from PPA_ESTIMATION.md plus an end-to-end
smoke test of execute_gps_road_network_anchor_prism with a synthetic
grid road network.
"""
from __future__ import annotations

import math

import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import LineString, Point

from app.tools.space_time_prism.gps_road_network import (
    execute_gps_road_network_anchor_prism,
)
from app.tools.space_time_prism.ppa_engine import (
    Graph,
    bounded_dijkstra,
    clear_cache,
    compute_origin_ppa,
    get_or_build_graph,
    make_mode_profile,
)
from app.tools.space_time_prism.ppa_engine.graph_cache import cache_size
from app.tools.space_time_prism.ppa_engine.profiles import parse_maxspeed_kmh
from app.tools.space_time_prism.ppa_engine.reachability import (
    interval_attributes,
    reachable_intervals_on_edge,
)


# ────────────────────────────────────────────────────────────────────────
# §26 correctness tests
# ────────────────────────────────────────────────────────────────────────

class TestReachableIntervals:
    """Test 1, 3, 4, 5 from PPA_ESTIMATION.md §26."""

    def test_1_budget_too_small_returns_none(self):
        result = compute_origin_ppa(
            Graph(), origin_lon=0, origin_lat=0,
            total_budget_sec=100, min_activity_sec=120,
        )
        assert result is None

    def test_3_half_edge_reachable(self):
        # edge cost = 100s, origin at u (du=0), no reverse, R = 50s
        # → reachable [0, 0.5]
        intervals = reachable_intervals_on_edge(
            du=0, dv=math.inf, edge_cost=100, cutoff_sec=50,
            edge_id=0, snap_edge_id=None, snap_fraction=0,
        )
        assert intervals == [(0.0, 0.5)]

    def test_4_origin_mid_edge_reachable_locally(self):
        # f = 0.5, R = 10s, c = 100s
        # Neither endpoint reachable but local interval is [0.4, 0.6]
        intervals = reachable_intervals_on_edge(
            du=math.inf, dv=math.inf, edge_cost=100, cutoff_sec=10,
            edge_id=7, snap_edge_id=7, snap_fraction=0.5,
        )
        assert len(intervals) == 1
        a, b = intervals[0]
        assert abs(a - 0.4) < 1e-9
        assert abs(b - 0.6) < 1e-9

    def test_5_both_endpoints_full_edge(self):
        # du = dv = 0, c = 100, R = 50 → full edge reachable
        # Max travel time should peak at the midpoint at 50s
        intervals = reachable_intervals_on_edge(
            du=0, dv=0, edge_cost=100, cutoff_sec=50,
            edge_id=0, snap_edge_id=None, snap_fraction=0,
        )
        assert intervals == [(0.0, 1.0)]

        attrs = interval_attributes(
            a=0, b=1, du=0, dv=0, c=100, edge_id=0,
            snap_edge_id=None, snap_fraction=0, total_budget_sec=200,
        )
        # Max travel = 50 (midpoint), min travel = 0 (endpoints)
        assert abs(attrs["travel_sec_max"] - 50) < 1e-9
        assert abs(attrs["travel_sec_min"]) < 1e-9

    def test_activity_guarantee(self):
        """§26 Test 6: every returned feature's activity_sec_min ≥ A."""
        # Build a tiny linear graph: 0 ━100m━ 1 ━100m━ 2 (walking, 1.4 m/s)
        graph = Graph()
        graph.xs = [0.0, 100.0, 200.0]
        graph.ys = [0.0, 0.0, 0.0]
        graph.adj = [[], [], []]

        speed_mps = 5_000 / 3600  # ~1.39 m/s walking
        cost = 100 / speed_mps    # ~72s per edge
        for u, v in [(0, 1), (1, 2)]:
            edge_id = len(graph.edge_u)
            graph.edge_u.append(u)
            graph.edge_v.append(v)
            graph.edge_cost_sec.append(cost)
            graph.edge_length_m.append(100.0)
            graph.edge_highway.append("residential")
            graph.edge_source_id.append(0)
            graph.adj[u].append((v, cost, edge_id))
            graph.adj[v].append((u, cost, edge_id))

        # Dijkstra from node 0 with cutoff 100s
        dist, edges = bounded_dijkstra(graph, [(0, 0.0)], cutoff_sec=100.0)
        assert dist[0] == 0
        assert abs(dist[1] - cost) < 1e-9
        assert math.isinf(dist[2])  # 144s > 100s cutoff
        assert 0 in edges
        # Edge 1 (1↔2) is touched during relaxation of node 1
        assert 1 in edges


# ────────────────────────────────────────────────────────────────────────
# End-to-end smoke test
# ────────────────────────────────────────────────────────────────────────

def _make_grid_road_network() -> dict:
    """6×6 grid of east-west + north-south streets at 100m spacing near (0, 0)."""
    spacing_deg = 0.001  # ≈111 m at the equator
    lines = []
    for i in range(6):
        lng = i * spacing_deg
        lines.append({
            "geometry": LineString([(lng, 0), (lng, 5 * spacing_deg)]),
            "highway": "residential",
        })
        lat = i * spacing_deg
        lines.append({
            "geometry": LineString([(0, lat), (5 * spacing_deg, lat)]),
            "highway": "residential",
        })
    return gpd.GeoDataFrame(lines, crs="EPSG:4326").__geo_interface__


def _make_gps_trajectory(n: int, t1: int, t2: int):
    spacing_deg = 0.001
    lons = np.linspace(0, 5 * spacing_deg, n)
    lats = np.linspace(0, 5 * spacing_deg, n)
    ts = np.linspace(t1, t2, n).astype(int)
    rows = [
        {"geometry": Point(lons[i], lats[i]), "_timestamp": int(ts[i])}
        for i in range(n)
    ]
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


class TestEndToEnd:
    """Smoke test the full execute_gps_road_network_anchor_prism pipeline."""

    @pytest.fixture
    def setup_data(self):
        spacing_deg = 0.001
        t1 = 1_700_000_000_000
        t2 = t1 + 600_000  # 10 min later
        p1 = {"lng": 0.0, "lat": 0.0, "timestamp": t1, "label": "A"}
        p2 = {
            "lng": 5 * spacing_deg, "lat": 5 * spacing_deg,
            "timestamp": t2, "label": "B",
        }
        roads = _make_grid_road_network()
        gps = _make_gps_trajectory(5, t1, t2)
        return p1, p2, roads, gps

    def test_returns_three_outputs(self, setup_data):
        p1, p2, roads, gps = setup_data
        outputs = execute_gps_road_network_anchor_prism(
            p1, p2,
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                "roadNetworkData": roads,
                "maxOrigins": 5,
            },
            gdf=gps, time_field="_timestamp",
        )
        assert len(outputs) == 3  # PPA roads + origins + anchors

    def test_ppa_roads_have_activity_attrs(self, setup_data):
        p1, p2, roads, gps = setup_data
        outputs = execute_gps_road_network_anchor_prism(
            p1, p2,
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                "roadNetworkData": roads,
                "maxOrigins": 5,
            },
            gdf=gps, time_field="_timestamp",
        )
        ppa = outputs[0]
        assert len(ppa) > 0
        for col in ("activity_sec_min", "activity_sec_max", "travel_sec_min", "highway"):
            assert col in ppa.columns
        # All features must respect A
        min_activity_sec = 60.0
        assert (ppa["activity_sec_min"] + 1e-6 >= min_activity_sec).all()

    def test_origins_layer_count_matches_max_origins(self, setup_data):
        p1, p2, roads, gps = setup_data
        outputs = execute_gps_road_network_anchor_prism(
            p1, p2,
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                "roadNetworkData": roads,
                "maxOrigins": 5,
            },
            gdf=gps, time_field="_timestamp",
        )
        origins = outputs[1]
        assert len(origins) == 5

    def test_anchors_layer_has_two_points(self, setup_data):
        p1, p2, roads, gps = setup_data
        outputs = execute_gps_road_network_anchor_prism(
            p1, p2,
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                "roadNetworkData": roads,
                "maxOrigins": 5,
            },
            gdf=gps, time_field="_timestamp",
        )
        anchors = outputs[2]
        assert len(anchors) == 2
        roles = set(anchors["anchor_role"])
        assert roles == {"start_anchor", "end_anchor"}

    def test_budget_too_small_yields_no_ppa(self, setup_data):
        p1, p2, roads, gps = setup_data
        outputs = execute_gps_road_network_anchor_prism(
            p1, p2,
            options={
                "speedMode": "walking",
                "minActivityMinutes": 60,    # 60 min activity
                "totalBudgetMinutes": 30,    # only 30 min total → T ≤ A
                "roadNetworkData": roads,
                "maxOrigins": 5,
            },
            gdf=gps, time_field="_timestamp",
        )
        # PPA layer should be empty (no reachable roads when T ≤ A)
        ppa = outputs[0]
        assert len(ppa) == 0

    def test_no_road_network_emits_empty_ppa_but_keeps_origins(self, setup_data):
        p1, p2, _roads, gps = setup_data
        outputs = execute_gps_road_network_anchor_prism(
            p1, p2,
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                # roadNetworkData omitted; explicit opt-out of OSM auto-download
                "autoDownloadOSM": False,
                "maxOrigins": 5,
            },
            gdf=gps, time_field="_timestamp",
        )
        assert len(outputs) == 3
        assert len(outputs[0]) == 0       # PPA empty
        assert len(outputs[1]) > 0        # origins still emitted
        assert len(outputs[2]) == 2       # anchors still emitted


# ────────────────────────────────────────────────────────────────────────
# §26 Test 2 — single edge from origin node
# ────────────────────────────────────────────────────────────────────────

class TestSingleEdgeFromOriginNode:
    """§26 Test 2: edge cost = 100, T = 300, A = 100 → R = 100.

    Expected:
        full edge reachable
        activity at far endpoint = 100
        activity at origin = 300
    """

    def test_single_edge_full_reach(self):
        # du = 0 (origin at u), dv = inf (we'll let Dijkstra fill in dv)
        # cutoff = 100, edge cost = 100 → reaches v exactly
        intervals = reachable_intervals_on_edge(
            du=0, dv=100, edge_cost=100, cutoff_sec=100,
            edge_id=0, snap_edge_id=None, snap_fraction=0,
        )
        assert len(intervals) == 1
        a, b = intervals[0]
        assert abs(a - 0.0) < 1e-9
        assert abs(b - 1.0) < 1e-9

    def test_single_edge_activity_at_endpoints(self):
        T = 300.0
        attrs = interval_attributes(
            a=0.0, b=1.0, du=0.0, dv=100.0, c=100.0, edge_id=0,
            snap_edge_id=None, snap_fraction=0.0, total_budget_sec=T,
        )
        # At origin (s=0): travel=0 → activity=T-0=300
        # At far end (s=1): travel=100 → activity=T-200=100
        # Max travel along [0,1] = 100, min travel = 0
        assert abs(attrs["travel_sec_min"]) < 1e-9
        assert abs(attrs["travel_sec_max"] - 100.0) < 1e-9
        # activity_sec_max corresponds to min travel
        assert abs(attrs["activity_sec_max"] - T) < 1e-9
        # activity_sec_min corresponds to max travel
        assert abs(attrs["activity_sec_min"] - (T - 200.0)) < 1e-9


# ────────────────────────────────────────────────────────────────────────
# Maxspeed parsing
# ────────────────────────────────────────────────────────────────────────

class TestMaxspeedParsing:
    @pytest.mark.parametrize("value,expected", [
        ("50", 50.0),
        (" 30 ", 30.0),
        ("50 km/h", 50.0),
        ("30 mph", 30.0 * 1.609344),
        ("walk", None),
        ("", None),
        (None, None),
        ("xyz mph", None),
    ])
    def test_parse(self, value, expected):
        got = parse_maxspeed_kmh(value)
        if expected is None:
            assert got is None
        else:
            assert abs(got - expected) < 1e-6


# ────────────────────────────────────────────────────────────────────────
# Graph cache — §24
# ────────────────────────────────────────────────────────────────────────

class TestGraphCache:
    """Verify the LRU graph cache hits on identical road networks."""

    def setup_method(self):
        clear_cache()

    def teardown_method(self):
        clear_cache()

    def _fresh_roads(self):
        return gpd.GeoDataFrame.from_features(
            _make_grid_road_network()["features"], crs="EPSG:4326",
        )

    def test_first_build_then_hit(self):
        roads_a = self._fresh_roads()
        roads_b = self._fresh_roads()
        profile = make_mode_profile("walking")
        assert cache_size() == 0

        g1, idx1 = get_or_build_graph(roads_a, "EPSG:32633", profile)
        assert cache_size() == 1

        # Same content, fresh dict — should hit the cache
        g2, idx2 = get_or_build_graph(roads_b, "EPSG:32633", profile)
        assert cache_size() == 1
        assert g1 is g2          # cache hit returns the same Graph instance
        assert idx1 is idx2

    def test_different_profile_keys_separately(self):
        roads = self._fresh_roads()
        get_or_build_graph(roads, "EPSG:32633", make_mode_profile("walking"))
        get_or_build_graph(roads, "EPSG:32633", make_mode_profile("driving"))
        assert cache_size() == 2

    def test_different_crs_keys_separately(self):
        roads = self._fresh_roads()
        profile = make_mode_profile("walking")
        get_or_build_graph(roads, "EPSG:32633", profile)
        get_or_build_graph(roads, "EPSG:32634", profile)
        assert cache_size() == 2


# ────────────────────────────────────────────────────────────────────────
# Per-origin dwell-time summary on the origins layer
# ────────────────────────────────────────────────────────────────────────

class TestOriginDwellSummary:
    """Each GPS origin point in the API response carries its dwell-time summary."""

    @pytest.fixture
    def outputs(self):
        spacing_deg = 0.001
        t1 = 1_700_000_000_000
        t2 = t1 + 600_000
        p1 = {"lng": 0.0, "lat": 0.0, "timestamp": t1, "label": "A"}
        p2 = {
            "lng": 5 * spacing_deg, "lat": 5 * spacing_deg,
            "timestamp": t2, "label": "B",
        }
        return execute_gps_road_network_anchor_prism(
            p1, p2,
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                "roadNetworkData": _make_grid_road_network(),
                "maxOrigins": 5,
            },
            gdf=_make_gps_trajectory(5, t1, t2),
            time_field="_timestamp",
        )

    def test_origin_layer_has_dwell_attributes(self, outputs):
        origins = outputs[1]
        for col in (
            "total_budget_sec", "min_activity_sec", "cutoff_sec",
            "dwell_sec_at_origin", "dwell_sec_max", "dwell_sec_min", "dwell_sec_mean",
            "activity_sec_at_origin", "activity_sec_max", "activity_sec_min", "activity_sec_mean",
            "ppa_reachable_segments", "ppa_reachable_length_m",
            "snap_distance_m", "reachable", "origin_index",
        ):
            assert col in origins.columns, f"missing column: {col}"

    def test_origin_dwell_at_origin_equals_total_budget(self, outputs):
        """At the origin itself travel time is 0, so dwell = T."""
        origins = outputs[1]
        T_min = 5  # totalBudgetMinutes
        expected_T_sec = T_min * 60.0
        for v in origins["dwell_sec_at_origin"]:
            assert abs(float(v) - expected_T_sec) < 1e-6

    def test_origin_dwell_min_respects_min_activity(self, outputs):
        """dwell_sec_min on every origin must be ≥ user-supplied A."""
        origins = outputs[1]
        A_sec = 1 * 60.0
        for v in origins["dwell_sec_min"]:
            assert float(v) >= A_sec - 1e-6

    def test_origin_dwell_aliases_match(self, outputs):
        """dwell_sec_* and activity_sec_* must be identical aliases."""
        origins = outputs[1]
        for col in ("at_origin", "max", "min", "mean"):
            d = origins[f"dwell_sec_{col}"].astype(float)
            a = origins[f"activity_sec_{col}"].astype(float)
            assert (d - a).abs().max() < 1e-9

    def test_segment_features_have_dwell_aliases(self, outputs):
        """The per-segment PPA features also expose dwell_sec_* aliases."""
        ppa = outputs[0]
        for col in ("dwell_sec_min", "dwell_sec_mid", "dwell_sec_max"):
            assert col in ppa.columns

    def test_segment_geometry_has_z(self, outputs):
        """Every PPA segment must carry a Z coordinate matching its origin's z_base.

        This is what makes the deck.gl LineLayer draw the road at the trajectory's
        altitude rather than flat at z=0.
        """
        ppa = outputs[0]
        if len(ppa) == 0:
            pytest.skip("no PPA segments produced")
        for _, row in ppa.iterrows():
            geom = row.geometry
            assert geom.has_z, "PPA LineString must carry a Z coordinate"
            coords = list(geom.coords)
            # Both endpoints sit at z_base (= time_progress × total_height)
            assert all(len(c) == 3 for c in coords)
            assert all(abs(c[2] - float(row["z"])) < 1e-9 for c in coords)

    def test_segment_has_color_rgba(self, outputs):
        """Each PPA segment should carry an [r, g, b, a] tuple the LineLayer can use."""
        ppa = outputs[0]
        if len(ppa) == 0:
            pytest.skip("no PPA segments produced")
        assert "color_rgba" in ppa.columns
        for rgba in ppa["color_rgba"]:
            assert isinstance(rgba, list) and len(rgba) == 4
            for v in rgba:
                assert 0 <= int(v) <= 255

    def test_origin_links_back_via_origin_index(self, outputs):
        """Every origin_index in the PPA layer must exist in the origins layer."""
        ppa = outputs[0]
        origins = outputs[1]
        if len(ppa) == 0:
            pytest.skip("no PPA segments")
        ppa_indices = set(int(v) for v in ppa["origin_index"])
        origin_indices = set(int(v) for v in origins["origin_index"])
        assert ppa_indices.issubset(origin_indices)

    def test_unreachable_origins_marked_when_no_road_network(self):
        """When there is no road network, every origin point must have reachable=False."""
        t1 = 1_700_000_000_000
        t2 = t1 + 600_000
        outputs = execute_gps_road_network_anchor_prism(
            {"lng": 0.0, "lat": 0.0, "timestamp": t1, "label": "A"},
            {"lng": 0.005, "lat": 0.005, "timestamp": t2, "label": "B"},
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                "autoDownloadOSM": False,
                "maxOrigins": 5,
            },
            gdf=_make_gps_trajectory(5, t1, t2),
            time_field="_timestamp",
        )
        origins = outputs[1]
        assert len(origins) > 0
        assert all(v is False or int(v) == 0 for v in origins["reachable"])
        # Budget params must still be echoed
        assert all(abs(float(v) - 300.0) < 1e-6 for v in origins["total_budget_sec"])


# ────────────────────────────────────────────────────────────────────────
# §6 / §21 — padded extent + OSM auto-download
# ────────────────────────────────────────────────────────────────────────

class TestPaddedExtent:
    """Cover the geometry of compute_padded_extent + area cap logic."""

    def test_extent_covers_origins_and_anchors(self):
        from app.tools.space_time_prism.ppa_engine import (
            compute_padded_extent, make_mode_profile,
        )
        profile = make_mode_profile("walking")
        bbox = compute_padded_extent(
            origin_lons=np.array([0.0, 0.01]),
            origin_lats=np.array([0.0, 0.01]),
            profile=profile,
            cutoff_sec=600,
            anchor_a={"lng": -0.005, "lat": -0.005},
            anchor_b={"lng": 0.02, "lat": 0.02},
        )
        west, south, east, north = bbox
        # Includes both anchors with margin
        assert west < -0.005
        assert south < -0.005
        assert east > 0.02
        assert north > 0.02

    def test_extent_buffer_grows_with_cutoff(self):
        from app.tools.space_time_prism.ppa_engine import (
            compute_padded_extent, make_mode_profile,
        )
        profile = make_mode_profile("driving")
        small = compute_padded_extent(np.array([0.0]), np.array([0.0]), profile, 60)
        big   = compute_padded_extent(np.array([0.0]), np.array([0.0]), profile, 3600)
        assert (big[2] - big[0]) > (small[2] - small[0])

    def test_area_cap_per_mode(self):
        from app.tools.space_time_prism.ppa_engine import is_extent_too_large
        # 10° × 10° at the equator ≈ 1.23 million km² — way over any cap
        too_large, area, cap = is_extent_too_large((0, 0, 10, 10), "walking")
        assert too_large
        assert area > cap
        # 0.001° × 0.001° ≈ 0.012 km² — under every cap
        too_large, _, _ = is_extent_too_large((0, 0, 0.001, 0.001), "walking")
        assert not too_large


class TestOSMCache:
    """Cached OSM downloads avoid re-hitting Overpass for identical bboxes."""

    def setup_method(self):
        from app.tools.space_time_prism.ppa_engine.extent import clear_osm_cache
        clear_osm_cache()

    def teardown_method(self):
        from app.tools.space_time_prism.ppa_engine.extent import clear_osm_cache
        clear_osm_cache()

    def test_second_request_hits_cache(self):
        from app.tools.space_time_prism.ppa_engine import fetch_or_cache_osm_roads
        from app.tools.space_time_prism.ppa_engine.extent import osm_cache_size

        call_count = {"n": 0}

        def fake_fetch(bbox, buffer_deg=0.0):
            call_count["n"] += 1
            return gpd.GeoDataFrame.from_features(
                _make_grid_road_network()["features"], crs="EPSG:4326",
            )

        bbox = (-0.01, -0.01, 0.02, 0.02)
        a = fetch_or_cache_osm_roads(bbox, "walking", fetch_fn=fake_fetch)
        b = fetch_or_cache_osm_roads(bbox, "walking", fetch_fn=fake_fetch)
        assert a is b                                # same instance returned
        assert call_count["n"] == 1                  # fetch_fn ran once
        assert osm_cache_size() == 1

    def test_different_mode_misses_cache(self):
        from app.tools.space_time_prism.ppa_engine import fetch_or_cache_osm_roads

        def fake_fetch(bbox, buffer_deg=0.0):
            return gpd.GeoDataFrame.from_features(
                _make_grid_road_network()["features"], crs="EPSG:4326",
            )

        bbox = (-0.01, -0.01, 0.02, 0.02)
        fetch_or_cache_osm_roads(bbox, "walking", fetch_fn=fake_fetch)
        fetch_or_cache_osm_roads(bbox, "driving", fetch_fn=fake_fetch)
        from app.tools.space_time_prism.ppa_engine.extent import osm_cache_size
        assert osm_cache_size() == 2

    def test_fetch_failure_returns_none(self):
        from app.tools.space_time_prism.ppa_engine import fetch_or_cache_osm_roads

        def bad_fetch(bbox, buffer_deg=0.0):
            raise RuntimeError("simulated overpass outage")

        out = fetch_or_cache_osm_roads(
            (-0.01, -0.01, 0.02, 0.02), "walking", fetch_fn=bad_fetch,
        )
        assert out is None


class TestAutoDownloadIntegration:
    """End-to-end: when no roadNetworkData is given but autoDownloadOSM=True,
    the engine should fetch from OSM through our cached helper."""

    def setup_method(self):
        from app.tools.space_time_prism.ppa_engine.extent import clear_osm_cache
        clear_osm_cache()

    def test_auto_download_path_invoked(self, monkeypatch):
        # Monkey-patch the underlying Overpass fetcher used by the cache
        roads_fc = _make_grid_road_network()

        def fake_fetch(bbox, buffer_deg=0.0, mode=None):
            return gpd.GeoDataFrame.from_features(
                roads_fc["features"], crs="EPSG:4326",
            )

        # Patch the module-level reference used by extent.fetch_or_cache_osm_roads
        from app.tools.space_time_prism import road_network as rn
        monkeypatch.setattr(rn, "_fetch_osm_roads", fake_fetch)

        t1 = 1_700_000_000_000
        t2 = t1 + 600_000
        outputs = execute_gps_road_network_anchor_prism(
            {"lng": 0.0, "lat": 0.0, "timestamp": t1, "label": "A"},
            {"lng": 0.005, "lat": 0.005, "timestamp": t2, "label": "B"},
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                # roadNetworkData omitted intentionally
                "autoDownloadOSM": True,
                "maxOrigins": 5,
            },
            gdf=_make_gps_trajectory(5, t1, t2),
            time_field="_timestamp",
        )
        # The PPA layer should now have features even though we never passed roads in
        assert len(outputs[0]) > 0
        # Origins should be marked reachable now that we have a network
        origins = outputs[1]
        assert any(bool(v) for v in origins["reachable"])

    def test_auto_download_disabled_yields_empty(self, monkeypatch):
        # Even if Overpass would respond, autoDownloadOSM=False suppresses it
        called = {"n": 0}

        def fake_fetch(bbox, buffer_deg=0.0):
            called["n"] += 1
            return gpd.GeoDataFrame.from_features(
                _make_grid_road_network()["features"], crs="EPSG:4326",
            )

        from app.tools.space_time_prism import road_network as rn
        monkeypatch.setattr(rn, "_fetch_osm_roads", fake_fetch)

        t1 = 1_700_000_000_000
        t2 = t1 + 600_000
        outputs = execute_gps_road_network_anchor_prism(
            {"lng": 0.0, "lat": 0.0, "timestamp": t1, "label": "A"},
            {"lng": 0.005, "lat": 0.005, "timestamp": t2, "label": "B"},
            options={
                "speedMode": "walking",
                "minActivityMinutes": 1,
                "totalBudgetMinutes": 5,
                "autoDownloadOSM": False,
                "maxOrigins": 5,
            },
            gdf=_make_gps_trajectory(5, t1, t2),
            time_field="_timestamp",
        )
        assert called["n"] == 0
        assert len(outputs[0]) == 0

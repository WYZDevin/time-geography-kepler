"""Realistic-speed adjustment (speedAdjustment option) for the network prism.

Fixture geometry mirrors test_two_anchor_prism: a ~2.23 km straight road on the
equator, walked end-to-end in ~1603 s at the 5 km/h profile speed.
"""
import geopandas as gpd
import pytest
from shapely.geometry import Point

from app.tools.space_time_prism.network_prism import execute_network_anchor_prism
from app.tools.space_time_prism.ppa_engine.graph_build import build_road_graph
from app.tools.space_time_prism.ppa_engine.graph_cache import clear_cache
from app.tools.space_time_prism.ppa_engine.profiles import make_mode_profile
from app.tools.space_time_prism.ppa_engine.snap import EdgeIndex
from app.tools.space_time_prism.ppa_engine.speed_adjust import (
    calibrate_speed_factor,
    congestion_factor,
    resolve_speed_factor,
)


@pytest.fixture(autouse=True)
def _clear_graph_cache():
    clear_cache()
    yield
    clear_cache()


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

_ANCHOR_A = {"lng": 0.0, "lat": 0.0, "alt": 0.0, "timestamp": 0, "label": "A"}
_ANCHOR_B = {"lng": 0.020, "lat": 0.0, "alt": 1000.0, "timestamp": 3_000_000, "label": "B"}

_HOUR_MS = 3_600_000.0


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


def _walking_graph():
    roads = gpd.GeoDataFrame.from_features(_ROAD["features"], crs="EPSG:4326")
    profile = make_mode_profile("walking")
    graph = build_road_graph(roads, "EPSG:32631", profile)
    return graph, EdgeIndex(graph), profile


class TestCongestionFactor:
    def test_peak_hour_driving(self):
        factor, _ = congestion_factor(8 * _HOUR_MS, lon=0.0, mode="driving")
        assert factor == pytest.approx(0.55)

    def test_night_driving(self):
        factor, _ = congestion_factor(2 * _HOUR_MS, lon=0.0, mode="driving")
        assert factor == pytest.approx(0.95)

    def test_walking_unaffected(self):
        factor, _ = congestion_factor(8 * _HOUR_MS, lon=0.0, mode="walking")
        assert factor == 1.0

    def test_longitude_shifts_local_hour(self):
        # 8:00 UTC at lon -120 → ~midnight local → night factor, not peak.
        factor, _ = congestion_factor(8 * _HOUR_MS, lon=-120.0, mode="driving")
        assert factor == pytest.approx(0.95)


class TestCalibration:
    def _trajectory(self, speed_kmh: float, n: int = 20, dt_s: float = 60.0):
        """(lon, lat, ms) fixes walking east along the road at speed_kmh."""
        step_deg = (speed_kmh / 3.6 * dt_s) / 111_320.0
        return [(i * step_deg, 0.0, i * dt_s * 1000.0) for i in range(n)]

    def test_recovers_observed_speed_ratio(self):
        graph, idx, profile = _walking_graph()
        # Observed 2.5 km/h vs 5 km/h profile → factor ≈ 0.5.
        result = calibrate_speed_factor(self._trajectory(2.5), graph, profile, idx)
        assert result is not None
        factor, n = result
        assert n >= 8
        assert factor == pytest.approx(0.5, abs=0.1)

    def test_stationary_trajectory_unusable(self):
        graph, idx, profile = _walking_graph()
        pts = [(0.001, 0.0, i * 60_000.0) for i in range(20)]  # never moves
        assert calibrate_speed_factor(pts, graph, profile, idx) is None

    def test_too_few_points_unusable(self):
        graph, idx, profile = _walking_graph()
        assert calibrate_speed_factor(self._trajectory(2.5, n=4), graph, profile, idx) is None


class TestResolve:
    def test_off_is_default_identity(self):
        graph, idx, profile = _walking_graph()
        factor, note = resolve_speed_factor(
            {}, graph=graph, edge_index=idx, profile=profile,
            trajectory_points=None, window_mid_ms=8 * _HOUR_MS, anchor_lon=0.0,
        )
        assert factor == 1.0 and note is None

    def test_manual_clamped(self):
        graph, idx, profile = _walking_graph()
        factor, note = resolve_speed_factor(
            {"speedAdjustment": "manual", "speedFactor": 0.05},
            graph=graph, edge_index=idx, profile=profile,
            trajectory_points=None, window_mid_ms=0.0, anchor_lon=0.0,
        )
        assert factor == pytest.approx(0.25)
        assert note

    def test_auto_falls_back_to_congestion(self):
        graph, idx, _ = _walking_graph()
        factor, note = resolve_speed_factor(
            {"speedAdjustment": "auto"},
            graph=graph, edge_index=idx, profile=make_mode_profile("driving"),
            trajectory_points=None, window_mid_ms=8 * _HOUR_MS, anchor_lon=0.0,
        )
        assert factor == pytest.approx(0.55)
        assert "rush-hour" in note


class TestEndToEnd:
    def test_manual_factor_scales_travel_times(self):
        base = _run()[0]
        slow = _run(speedAdjustment="manual", speedFactor=0.9)[0]
        ratio = slow["forward_sec"].max() / base["forward_sec"].max()
        assert ratio == pytest.approx(1.0 / 0.9, rel=0.05)

    def test_slow_factor_makes_budget_infeasible(self):
        # Real shortest path 1603/0.5 ≈ 3206 s > 2700 s budget-after-activity.
        with pytest.raises(ValueError, match="infeasible|exceed"):
            _run(speedAdjustment="manual", speedFactor=0.5)

    def test_auto_calibrates_from_trajectory(self):
        # Trajectory walked at 2.5 km/h → factor ≈ 0.5 → same infeasibility as
        # the manual 0.5 case, proving the gdf → calibration path is wired up.
        step_deg = (2.5 / 3.6 * 60.0) / 111_320.0
        base_ms = 1_700_000_000_000  # realistic epoch ms so the parser reads ms
        traj = gpd.GeoDataFrame(
            {"_timestamp": [base_ms + i * 60_000.0 for i in range(20)]},
            geometry=[Point(i * step_deg, 0.0) for i in range(20)],
            crs="EPSG:4326",
        )
        with pytest.raises(ValueError, match="infeasible|exceed"):
            execute_network_anchor_prism(
                _ANCHOR_A, _ANCHOR_B, _opts(speedAdjustment="auto"),
                z_start=0.0, z_end=1000.0, total_height=1000.0,
                trajectory_gdf=traj, time_field="_timestamp",
            )

    def test_off_matches_legacy_results(self):
        base = _run()[0]
        off = _run(speedAdjustment="off")[0]
        assert len(base) == len(off)
        assert base["forward_sec"].max() == pytest.approx(off["forward_sec"].max())

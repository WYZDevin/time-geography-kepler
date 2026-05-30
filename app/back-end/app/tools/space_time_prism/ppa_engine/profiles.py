"""Travel-mode profiles for the PPA engine.

A profile defines:
    speed_kmh:      mapping from highway tag → speed in km/h
    default_kmh:    fallback speed when the highway tag is missing or unknown
    excluded:       highway tags to skip entirely (e.g. driving on footways)
    max_speed_kmh:  hard upper bound, used for analysis-extent buffering
    max_snap_m:     maximum distance an origin can be from the nearest edge
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


DRIVING_SPEED_KMH: dict[str, float] = {
    "motorway": 100,
    "motorway_link": 60,
    "trunk": 80,
    "trunk_link": 50,
    "primary": 60,
    "primary_link": 40,
    "secondary": 50,
    "secondary_link": 35,
    "tertiary": 40,
    "tertiary_link": 30,
    "unclassified": 35,
    "residential": 30,
    "living_street": 10,
    "service": 15,
    "track": 15,
}

DRIVING_EXCLUDED = frozenset({
    "footway", "cycleway", "path", "steps", "bridleway",
    "pedestrian", "corridor", "elevator", "platform",
    "construction", "proposed",
})

WALKING_SPEED_KMH: dict[str, float] = {
    "residential": 5, "living_street": 5, "service": 5,
    "pedestrian": 5, "footway": 5, "path": 5,
    "steps": 2.5, "track": 5, "unclassified": 5,
    "tertiary": 5, "secondary": 5, "primary": 5,
    "tertiary_link": 5, "secondary_link": 5, "primary_link": 5,
}

WALKING_EXCLUDED = frozenset({
    "motorway", "motorway_link", "trunk", "trunk_link",
    "construction", "proposed",
})

CYCLING_SPEED_KMH: dict[str, float] = {
    "cycleway": 18, "residential": 15, "living_street": 12,
    "service": 12, "path": 12, "track": 10, "footway": 8,
    "unclassified": 15, "tertiary": 18, "secondary": 18,
    "primary": 15, "tertiary_link": 12, "secondary_link": 12,
    "primary_link": 12,
}

CYCLING_EXCLUDED = frozenset({
    "motorway", "motorway_link", "trunk", "trunk_link",
    "steps", "construction", "proposed",
})

# Transit treated as fast-walking equivalent — we don't model bus routes
TRANSIT_SPEED_KMH: dict[str, float] = {k: 30 for k in WALKING_SPEED_KMH}


@dataclass(frozen=True)
class ModeProfile:
    """Resolved travel mode used during graph construction and Dijkstra."""
    mode: str
    speed_kmh: dict[str, float]
    default_kmh: float
    excluded: frozenset[str]
    max_speed_kmh: float
    max_snap_m: float = field(default=200.0)

    def speed_for_highway(self, highway: Optional[str]) -> float:
        """Return km/h for a given highway tag, falling back to default_kmh."""
        if highway is None:
            return self.default_kmh
        return self.speed_kmh.get(highway, self.default_kmh)

    def is_excluded(self, highway: Optional[str]) -> bool:
        if highway is None:
            return False
        return highway in self.excluded


_BUILTIN_PROFILES: dict[str, ModeProfile] = {
    "driving": ModeProfile(
        mode="driving",
        speed_kmh=DRIVING_SPEED_KMH,
        default_kmh=30.0,
        excluded=DRIVING_EXCLUDED,
        max_speed_kmh=110.0,
        max_snap_m=500.0,
    ),
    "walking": ModeProfile(
        mode="walking",
        speed_kmh=WALKING_SPEED_KMH,
        default_kmh=5.0,
        excluded=WALKING_EXCLUDED,
        max_speed_kmh=6.0,
        max_snap_m=50.0,
    ),
    "cycling": ModeProfile(
        mode="cycling",
        speed_kmh=CYCLING_SPEED_KMH,
        default_kmh=15.0,
        excluded=CYCLING_EXCLUDED,
        max_speed_kmh=25.0,
        max_snap_m=100.0,
    ),
    "transit": ModeProfile(
        mode="transit",
        speed_kmh=TRANSIT_SPEED_KMH,
        default_kmh=30.0,
        excluded=frozenset(),
        max_speed_kmh=40.0,
        max_snap_m=200.0,
    ),
}


def make_mode_profile(
    mode: str,
    custom_speed_kmh: Optional[float] = None,
) -> ModeProfile:
    """Resolve a profile by name.

    custom_speed_kmh: when provided (mode == 'custom'), creates a flat-speed profile
    that treats every road equally. Useful when the caller has only a single speed
    parameter and no road typology.
    """
    if mode == "custom" and custom_speed_kmh is not None:
        speed = max(0.1, float(custom_speed_kmh))
        flat = {hwy: speed for hwy in DRIVING_SPEED_KMH}
        flat.update({hwy: speed for hwy in WALKING_SPEED_KMH})
        return ModeProfile(
            mode="custom",
            speed_kmh=flat,
            default_kmh=speed,
            excluded=frozenset(),
            max_speed_kmh=speed * 1.2,
            max_snap_m=300.0,
        )
    return _BUILTIN_PROFILES.get(mode, _BUILTIN_PROFILES["walking"])


def parse_maxspeed_kmh(value) -> Optional[float]:
    """Parse OSM ``maxspeed`` tag values: '50', '30 mph', '50 km/h'."""
    if value is None:
        return None
    s = str(value).strip().lower()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        pass
    if s.endswith("mph"):
        try:
            return float(s.replace("mph", "").strip()) * 1.609344
        except ValueError:
            return None
    if s.endswith("km/h"):
        try:
            return float(s.replace("km/h", "").strip())
        except ValueError:
            return None
    return None

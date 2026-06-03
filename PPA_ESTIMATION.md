Below is a full implementation handbook for a local, simplified OSM-based activity-time road-network engine.

The design assumes:

```text
No OSRM.
No persistent precomputed network.
Roads are downloaded from OSM for the user-selected extent.
A temporary graph is built per request or per extent.
The computation runs locally on the user’s computer.
The same request may contain 100+ origins.
Output is reachable road lines with activity-time attributes.
```

This handbook uses the simplified **undirected, symmetric travel model**. That means travel from origin to a road point and travel back from that road point to the origin are assumed to take the same time. This is not fully correct for one-way driving networks, but it is the right first implementation for local, repeated computation.

## 1. Core mathematical model

For each road-network point `x`:

```text
T = total time budget, seconds
A = minimum required activity time, seconds
d(origin, x) = one-way shortest travel time from origin to x
```

Because the simplified model assumes symmetric travel:

```text
return_time(x) = d(origin, x)
```

So:

```text
activity_time(x) = T - 2 * d(origin, x)
```

A point is valid when:

```text
activity_time(x) >= A
```

Therefore:

```text
T - 2 * d(origin, x) >= A
```

which gives:

```text
d(origin, x) <= (T - A) / 2
```

Define:

```text
R = (T - A) / 2
```

`R` is the maximum allowed one-way travel time. For each origin, the algorithm is now just:

```text
Run bounded Dijkstra from origin with cutoff R.
Return all road portions with shortest travel time <= R.
Set activity_time = T - 2 * travel_time.
```

If:

```text
T <= A
```

then there is no travel time available. Return empty result unless you want to return only the road point at the origin when `T == A`.

## 2. Required input contract

Use a request object like this:

```json
{
  "extent": {
    "west": -79.55,
    "south": 43.55,
    "east": -79.20,
    "north": 43.85
  },
  "origins": [
    {
      "id": "origin_1",
      "lon": -79.3832,
      "lat": 43.6532
    }
  ],
  "total_budget_sec": 7200,
  "min_activity_sec": 1800,
  "mode": "driving",
  "return_only_inside_user_extent": true
}
```

All time values should be in seconds. All input and output coordinates should be WGS84 longitude/latitude. Internally, convert coordinates to a local metric coordinate system for distance, snapping, and line cutting.

## 3. Required output contract

Return a GeoJSON FeatureCollection. Use one feature per reachable road piece.

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-79.39, 43.65],
          [-79.388, 43.651]
        ]
      },
      "properties": {
        "origin_id": "origin_1",
        "osm_way_id": 123456789,
        "highway": "residential",
        "edge_id": 9123,
        "travel_sec_min": 620.4,
        "travel_sec_max": 740.1,
        "travel_sec_mid": 683.2,
        "activity_sec_min": 5719.8,
        "activity_sec_max": 5959.2,
        "activity_sec_mid": 5833.6,
        "cutoff_sec": 2700.0,
        "total_budget_sec": 7200,
        "min_activity_sec": 1800
      }
    }
  ]
}
```

The safest single display value is:

```text
activity_sec_min
```

That means every point on the returned line piece should allow at least that much activity time, subject to the simplified model.

## 4. OSM data assumptions

OpenStreetMap data is built from nodes, ways, and relations. Nodes are coordinate points; ways are ordered lists of nodes and are commonly used for roads and other linear features; tags describe what an element means. ([OpenStreetMap][1])

For this algorithm, you mainly need OSM ways tagged with `highway=*`. The OSM highway key is the main key used to identify roads, streets, and paths, and the value indicates the road type or network importance. ([OpenStreetMap][2])

Use only OSM ways for the first version. Ignore relations, turn restrictions, route relations, and complex access rules unless you later build a directed routing model.

## 5. Request-level pipeline

The full request-level method is:

```text
1. Validate input.
2. Compute one-way cutoff R = (T - A) / 2.
3. Compute padded analysis extent.
4. Download OSM highway ways for padded extent.
5. Parse OSM nodes and ways.
6. Build temporary undirected graph.
7. Build temporary spatial index over graph edges.
8. Snap all origins to nearest graph edge.
9. For each origin:
      run bounded Dijkstra up to cutoff R
      compute reachable edge intervals
      clip road lines
      compute activity-time attributes
10. Clip or filter result to original user extent.
11. Return GeoJSON.
```

Important distinction:

```text
Download / analysis extent = user extent + travel buffer
Return / display extent     = original user extent
```

Do not download only the visible user extent. If the user origin is near the boundary, a valid route may temporarily leave the visible extent and re-enter it.

## 6. Analysis extent padding

Compute:

```text
R = (total_budget_sec - min_activity_sec) / 2
```

Then:

```text
buffer_m = max_speed_mps * R * safety_factor
```

Use:

```text
safety_factor = 1.15 or 1.25
```

Example:

```text
total_budget_sec = 7200       # 120 min
min_activity_sec = 1800       # 30 min
R = (7200 - 1800) / 2 = 2700  # 45 min

max_speed = 100 km/h = 27.78 m/s
buffer_m = 27.78 * 2700 * 1.2 ≈ 90,000 m
```

For walking:

```text
max_speed = 5 km/h = 1.39 m/s
buffer_m = 1.39 * 2700 * 1.2 ≈ 4,500 m
```

Use a local projected coordinate system to buffer the extent in meters. Then convert the padded extent back to WGS84 for OSM download.

If the padded extent is too large, reject the request or ask the caller to reduce the extent, budget, or mode. For a local app, a whole metro area may be acceptable; a province/state-scale extent is not suitable for this direct-download method.

## 7. OSM download query

If using Overpass API, use a bounding-box query for highway ways, then recurse down to retrieve referenced nodes. Overpass bounding boxes use the coordinate order `(south, west, north, east)`, and the recurse-down form `(._; >;);` is used to add referenced child elements such as way nodes. ([OpenStreetMap][3])

Example Overpass QL:

```text
[out:json][timeout:90];
way["highway"](SOUTH,WEST,NORTH,EAST);
(._;>;);
out body qt;
```

Where:

```text
SOUTH = padded_extent.south
WEST  = padded_extent.west
NORTH = padded_extent.north
EAST  = padded_extent.east
```

For example:

```text
[out:json][timeout:90];
way["highway"](43.50,-79.60,43.90,-79.10);
(._;>;);
out body qt;
```

The implementation should treat OSM download as fallible:

```text
If request times out:
    split padded extent into smaller tiles

If result is too large:
    reduce extent, reduce budget, or use coarser road filtering

If no highway ways are returned:
    return empty result with warning
```

## 8. Travel mode profiles

Define a mode profile. For the first version, keep this deterministic.

Example driving profile:

```python
DRIVING_SPEED_KMH = {
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
    "track": 15
}
```

Example walking profile:

```python
WALKING_SPEED_KMH = {
    "residential": 5,
    "living_street": 5,
    "service": 5,
    "pedestrian": 5,
    "footway": 5,
    "path": 5,
    "steps": 2.5,
    "track": 5,
    "unclassified": 5,
    "tertiary": 5,
    "secondary": 5,
    "primary": 5
}
```

Convert speed to meters per second:

```python
speed_mps = speed_kmh / 3.6
```

Then edge cost is:

```python
cost_sec = length_m / speed_mps
```

For a simple driving version, exclude these highway types:

```python
DRIVING_EXCLUDED = {
    "footway",
    "cycleway",
    "path",
    "steps",
    "bridleway",
    "pedestrian",
    "corridor",
    "elevator",
    "platform",
    "construction",
    "proposed"
}
```

For a simple walking version, exclude:

```python
WALKING_EXCLUDED = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "construction",
    "proposed"
}
```

Optional minimal access filtering:

```python
def is_blocked_by_access(tags, mode):
    access = tags.get("access")
    if access in {"no", "private"}:
        return True

    if mode == "driving":
        if tags.get("motor_vehicle") in {"no", "private"}:
            return True
        if tags.get("vehicle") in {"no", "private"}:
            return True

    if mode == "walking":
        if tags.get("foot") in {"no", "private"}:
            return True

    return False
```

For this simplified version, ignore `oneway=*`. That is deliberate. If you use an undirected model but partially apply one-way tags, the mathematical shortcut `activity_time = T - 2d` breaks.

## 9. Coordinate handling

Use WGS84 longitude/latitude for input and output, but not for internal metric operations.

Internally use:

```text
x, y in meters
```

Preferred implementation:

```text
Use pyproj.
Choose a local projected CRS based on the extent center.
```

Simpler fallback for small extents:

```python
import math

EARTH_R = 6371000.0

def make_local_projector(center_lat_deg, center_lon_deg):
    lat0 = math.radians(center_lat_deg)
    lon0 = math.radians(center_lon_deg)

    def project(lon_deg, lat_deg):
        lon = math.radians(lon_deg)
        lat = math.radians(lat_deg)
        x = EARTH_R * (lon - lon0) * math.cos(lat0)
        y = EARTH_R * (lat - lat0)
        return x, y

    def unproject(x, y):
        lat = y / EARTH_R + lat0
        lon = x / (EARTH_R * math.cos(lat0)) + lon0
        return math.degrees(lon), math.degrees(lat)

    return project, unproject
```

Use the fallback only for local extents. For large regions or high accuracy, use a projection library.

## 10. Internal data structures

Use compact data structures. Avoid NetworkX for the runtime computation.

Recommended graph object:

```python
class Graph:
    # node index -> projected coordinate
    xs: list[float]
    ys: list[float]

    # edge index -> endpoints and attributes
    edge_u: list[int]
    edge_v: list[int]
    edge_cost_sec: list[float]
    edge_length_m: list[float]
    edge_way_id: list[int]
    edge_highway: list[str]

    # WGS84 endpoint coordinates for output
    edge_lon0: list[float]
    edge_lat0: list[float]
    edge_lon1: list[float]
    edge_lat1: list[float]

    # adjacency list
    # adj[u] = [(v, edge_cost_sec, edge_id), ...]
    adj: list[list[tuple[int, float, int]]]
```

Node mapping:

```python
osm_node_id_to_graph_index: dict[int, int]
```

Do not use OSM node IDs as direct array indices. They are large sparse integers.

For the first version, create one graph edge for every consecutive pair of OSM nodes in a routable way:

```text
way nodes: [n1, n2, n3, n4]

edges:
    n1 - n2
    n2 - n3
    n3 - n4
```

This creates many short straight edges, which makes clipping easier.

## 11. Parse OSM response

Pseudo-code:

```python
def parse_osm_json(osm_json):
    nodes = {}
    ways = []

    for element in osm_json["elements"]:
        if element["type"] == "node":
            nodes[element["id"]] = {
                "lon": element["lon"],
                "lat": element["lat"]
            }

    for element in osm_json["elements"]:
        if element["type"] == "way":
            tags = element.get("tags", {})
            node_ids = element.get("nodes", [])

            if "highway" not in tags:
                continue

            ways.append({
                "id": element["id"],
                "tags": tags,
                "node_ids": node_ids
            })

    return nodes, ways
```

Skip ways that have fewer than two valid nodes.

## 12. Build the temporary graph

Pseudo-code:

```python
def build_graph(nodes, ways, mode_profile, project):
    graph = Graph()
    osm_to_idx = {}

    def get_node_index(osm_node_id):
        if osm_node_id in osm_to_idx:
            return osm_to_idx[osm_node_id]

        n = nodes[osm_node_id]
        x, y = project(n["lon"], n["lat"])

        idx = len(graph.xs)
        osm_to_idx[osm_node_id] = idx

        graph.xs.append(x)
        graph.ys.append(y)
        graph.adj.append([])

        return idx

    for way in ways:
        tags = way["tags"]
        highway = tags.get("highway")

        if not is_way_allowed(tags, mode_profile):
            continue

        speed_mps = speed_for_way(tags, mode_profile)
        if speed_mps <= 0:
            continue

        node_ids = way["node_ids"]

        for node_a, node_b in zip(node_ids[:-1], node_ids[1:]):
            if node_a not in nodes or node_b not in nodes:
                continue

            u = get_node_index(node_a)
            v = get_node_index(node_b)

            x0, y0 = graph.xs[u], graph.ys[u]
            x1, y1 = graph.xs[v], graph.ys[v]

            dx = x1 - x0
            dy = y1 - y0
            length_m = (dx * dx + dy * dy) ** 0.5

            if length_m <= 0.01:
                continue

            cost_sec = length_m / speed_mps

            edge_id = len(graph.edge_u)

            graph.edge_u.append(u)
            graph.edge_v.append(v)
            graph.edge_cost_sec.append(cost_sec)
            graph.edge_length_m.append(length_m)
            graph.edge_way_id.append(way["id"])
            graph.edge_highway.append(highway)

            graph.edge_lon0.append(nodes[node_a]["lon"])
            graph.edge_lat0.append(nodes[node_a]["lat"])
            graph.edge_lon1.append(nodes[node_b]["lon"])
            graph.edge_lat1.append(nodes[node_b]["lat"])

            # Undirected simplified graph
            graph.adj[u].append((v, cost_sec, edge_id))
            graph.adj[v].append((u, cost_sec, edge_id))

    return graph
```

Mode functions:

```python
def is_way_allowed(tags, profile):
    highway = tags.get("highway")

    if highway not in profile["speed_kmh"]:
        return False

    if tags.get("area") == "yes":
        return False

    if highway in profile.get("excluded_highways", set()):
        return False

    if is_blocked_by_access(tags, profile["mode"]):
        return False

    return True


def speed_for_way(tags, profile):
    highway = tags["highway"]

    # Optional: parse maxspeed if present and valid
    parsed = parse_maxspeed_kmh(tags.get("maxspeed"))
    if parsed is not None:
        speed_kmh = parsed
    else:
        speed_kmh = profile["speed_kmh"][highway]

    speed_kmh = max(profile.get("min_speed_kmh", 2), speed_kmh)
    speed_kmh = min(profile.get("max_speed_kmh", 130), speed_kmh)

    return speed_kmh / 3.6
```

A minimal `maxspeed` parser:

```python
def parse_maxspeed_kmh(value):
    if not value:
        return None

    s = value.strip().lower()

    try:
        # "50"
        return float(s)
    except ValueError:
        pass

    if s.endswith("mph"):
        try:
            mph = float(s.replace("mph", "").strip())
            return mph * 1.609344
        except ValueError:
            return None

    if s.endswith("km/h"):
        try:
            return float(s.replace("km/h", "").strip())
        except ValueError:
            return None

    return None
```

## 13. Build spatial index for snapping

You need to snap each origin to the nearest graph edge.

Preferred: use an R-tree or Shapely `STRtree`.

For each edge, store its bounding box in projected meters:

```python
edge_bbox = (
    min(x0, x1),
    min(y0, y1),
    max(x0, x1),
    max(y0, y1)
)
```

If no spatial-index library is available, use a simple grid index:

```text
cell_size_m = 250 or 500
edge_id is inserted into every grid cell touched by its bbox
origin search checks nearby cells, expanding outward until candidates are found
```

## 14. Snap origin to nearest edge

For each origin coordinate:

```text
1. Project origin lon/lat to x/y.
2. Query nearby graph edges.
3. Compute closest point on each edge segment.
4. Choose edge with minimum perpendicular distance.
5. Compute fraction f along edge:
       f = 0 at edge.u
       f = 1 at edge.v
6. Create Dijkstra seeds at both endpoints.
```

Point-to-segment snapping:

```python
def snap_point_to_segment(px, py, ax, ay, bx, by):
    vx = bx - ax
    vy = by - ay
    wx = px - ax
    wy = py - ay

    denom = vx * vx + vy * vy
    if denom <= 0:
        return 0.0, ax, ay, ((px - ax)**2 + (py - ay)**2) ** 0.5

    f = (wx * vx + wy * vy) / denom
    f = max(0.0, min(1.0, f))

    sx = ax + f * vx
    sy = ay + f * vy

    dist = ((px - sx)**2 + (py - sy)**2) ** 0.5

    return f, sx, sy, dist
```

Snap result:

```python
class SnapResult:
    edge_id: int
    fraction: float
    distance_m: float
    seeds: list[tuple[int, float]]
```

For snapped edge `u-v` with cost `c` and fraction `f`:

```text
cost from snap point to u = f * c
cost from snap point to v = (1 - f) * c
```

So:

```python
seeds = [
    (u, f * c),
    (v, (1.0 - f) * c)
]
```

If the snap distance is too large, return empty result for that origin:

```text
max_snap_distance_m:
    walking: 50 m
    urban driving: 100 m
    rural driving: 500 m
```

The snap edge must also be included in candidate edges, even when neither endpoint is reachable within the cutoff. Example: the origin is in the middle of a long rural road segment and the budget is only enough to travel locally along that segment.

## 15. Bounded Dijkstra

For each origin, run one bounded Dijkstra search with cutoff `R`.

Do not run full shortest paths over the entire graph.

```python
import heapq
import math

def bounded_dijkstra(graph, seeds, cutoff_sec, snap_edge_id=None):
    n = len(graph.xs)
    dist = [math.inf] * n
    touched_nodes = []
    candidate_edges = set()

    pq = []

    for node, cost in seeds:
        if cost <= cutoff_sec and cost < dist[node]:
            dist[node] = cost
            touched_nodes.append(node)
            heapq.heappush(pq, (cost, node))

    if snap_edge_id is not None:
        candidate_edges.add(snap_edge_id)

    while pq:
        cost, u = heapq.heappop(pq)

        if cost != dist[u]:
            continue

        if cost > cutoff_sec:
            break

        for v, edge_cost, edge_id in graph.adj[u]:
            candidate_edges.add(edge_id)

            new_cost = cost + edge_cost

            if new_cost <= cutoff_sec and new_cost < dist[v]:
                if math.isinf(dist[v]):
                    touched_nodes.append(v)

                dist[v] = new_cost
                heapq.heappush(pq, (new_cost, v))

    return dist, candidate_edges
```

For 100+ origins, optimize this later using reusable arrays:

```text
dist array reused across queries
touched_nodes list records which nodes to reset
edge_seen_stamp array avoids clearing edge sets
```

Optimized structure:

```python
class DijkstraWorkspace:
    def __init__(self, node_count, edge_count):
        self.inf = float("inf")
        self.dist = [self.inf] * node_count
        self.touched_nodes = []
        self.edge_stamp = [0] * edge_count
        self.stamp = 0

    def reset(self):
        for node in self.touched_nodes:
            self.dist[node] = self.inf
        self.touched_nodes.clear()
        self.stamp += 1
```

This avoids allocating and clearing large arrays 100+ times.

## 16. Reachable interval on an edge

For an undirected edge `u-v`:

```text
c  = edge cost in seconds
du = shortest travel time to u
dv = shortest travel time to v
s  = fraction along the edge, from u to v
```

Travel time to fraction `s` is:

```text
d(s) = min(
    du + s * c,
    dv + (1 - s) * c
)
```

If this edge is the snapped origin edge, add the direct local movement term:

```text
d_origin_edge(s) = abs(s - f) * c
```

So:

```text
d(s) = min(
    du + s * c,
    dv + (1 - s) * c,
    abs(s - f) * c if this is the snapped edge
)
```

The road portion is reachable when:

```text
d(s) <= R
```

Endpoint-based intervals:

From `u`:

```text
if du <= R:
    reachable interval = [0, (R - du) / c]
```

From `v`:

```text
if dv <= R:
    reachable interval = [1 - (R - dv) / c, 1]
```

From snapped origin point on the same edge:

```text
if edge_id == snap.edge_id:
    reachable interval = [f - R / c, f + R / c]
```

Clamp all intervals to `[0, 1]`, discard empty intervals, then merge overlapping intervals.

Pseudo-code:

```python
def clamp01(x):
    return max(0.0, min(1.0, x))


def merge_intervals(intervals, eps=1e-9):
    if not intervals:
        return []

    intervals = sorted(intervals)
    merged = [intervals[0]]

    for a, b in intervals[1:]:
        last_a, last_b = merged[-1]

        if a <= last_b + eps:
            merged[-1] = (last_a, max(last_b, b))
        else:
            merged.append((a, b))

    return merged


def reachable_intervals_on_edge(
    du,
    dv,
    edge_cost,
    cutoff_sec,
    edge_id,
    snap_edge_id,
    snap_fraction
):
    intervals = []

    if du <= cutoff_sec:
        b = clamp01((cutoff_sec - du) / edge_cost)
        intervals.append((0.0, b))

    if dv <= cutoff_sec:
        a = clamp01(1.0 - (cutoff_sec - dv) / edge_cost)
        intervals.append((a, 1.0))

    if edge_id == snap_edge_id:
        f = snap_fraction
        delta = cutoff_sec / edge_cost
        a = clamp01(f - delta)
        b = clamp01(f + delta)
        intervals.append((a, b))

    intervals = [
        (a, b)
        for a, b in intervals
        if b > a + 1e-9
    ]

    return merge_intervals(intervals)
```

## 17. Clip edge geometry by interval

Because the first version creates one edge per pair of consecutive OSM nodes, each edge is a straight segment.

For interval `[a, b]`:

```text
a = start fraction along edge
b = end fraction along edge
```

Projected coordinates:

```python
def interpolate(p0, p1, s):
    return (
        p0[0] + s * (p1[0] - p0[0]),
        p0[1] + s * (p1[1] - p0[1])
    )
```

WGS84 output coordinates can be obtained by interpolating lon/lat for short segments, or by interpolating projected coordinates and then unprojecting. Prefer unprojecting:

```python
x0, y0 = graph.xs[u], graph.ys[u]
x1, y1 = graph.xs[v], graph.ys[v]

xa, ya = interpolate((x0, y0), (x1, y1), a)
xb, yb = interpolate((x0, y0), (x1, y1), b)

lon_a, lat_a = unproject(xa, ya)
lon_b, lat_b = unproject(xb, yb)

geometry = {
    "type": "LineString",
    "coordinates": [
        [lon_a, lat_a],
        [lon_b, lat_b]
    ]
}
```

Later, if you store whole OSM way polylines instead of segment edges, use cumulative lengths and cut by distance along the polyline. For the first version, segment edges are simpler and safer.

## 18. Compute activity-time attributes

For any fraction `s` on edge `u-v`:

```python
def travel_time_at_fraction(
    s,
    du,
    dv,
    edge_cost,
    edge_id,
    snap_edge_id,
    snap_fraction
):
    values = []

    if du != float("inf"):
        values.append(du + s * edge_cost)

    if dv != float("inf"):
        values.append(dv + (1.0 - s) * edge_cost)

    if edge_id == snap_edge_id:
        values.append(abs(s - snap_fraction) * edge_cost)

    return min(values)
```

Then:

```python
activity_sec = total_budget_sec - 2 * travel_sec
```

For interval `[a, b]`, compute:

```text
travel_sec_min
travel_sec_mid
travel_sec_max
activity_sec_min = T - 2 * travel_sec_max
activity_sec_mid = T - 2 * travel_sec_mid
activity_sec_max = T - 2 * travel_sec_min
```

Do not assume the maximum travel time occurs at the interval endpoints. On a road reachable from both endpoints, travel time may peak in the middle.

A robust method is to evaluate all breakpoints of the piecewise-linear travel-time function.

Represent possible route functions as lines:

```text
from u:      du + c*s
from v:      dv + c*(1-s) = (dv + c) - c*s
from origin: abs(s-f)*c on the snapped edge
```

Generic pseudo-code:

```python
def route_functions_for_edge(
    du,
    dv,
    c,
    edge_id,
    snap_edge_id,
    snap_fraction
):
    funcs = []

    # Each function: (slope_m, intercept_b, domain_a, domain_b)
    # value = m * s + b

    if du != float("inf"):
        funcs.append((c, du, 0.0, 1.0))

    if dv != float("inf"):
        funcs.append((-c, dv + c, 0.0, 1.0))

    if edge_id == snap_edge_id:
        f = snap_fraction

        # left side of abs(s-f)*c: c*(f-s) = -c*s + c*f
        funcs.append((-c, c * f, 0.0, f))

        # right side: c*(s-f) = c*s - c*f
        funcs.append((c, -c * f, f, 1.0))

    return funcs


def value_of_function(func, s):
    m, b, domain_a, domain_b = func
    return m * s + b


def function_valid_at(func, s, eps=1e-9):
    _, _, a, b = func
    return a - eps <= s <= b + eps


def travel_time_piecewise(s, funcs):
    values = [
        value_of_function(fn, s)
        for fn in funcs
        if function_valid_at(fn, s)
    ]
    return min(values)


def candidate_s_values_for_interval(a, b, funcs):
    candidates = {a, b, (a + b) / 2.0}

    # Add function domain boundaries.
    for fn in funcs:
        _, _, da, db = fn
        if a <= da <= b:
            candidates.add(da)
        if a <= db <= b:
            candidates.add(db)

    # Add pairwise intersections.
    for i in range(len(funcs)):
        m1, b1, da1, db1 = funcs[i]

        for j in range(i + 1, len(funcs)):
            m2, b2, da2, db2 = funcs[j]

            if abs(m1 - m2) < 1e-12:
                continue

            s = (b2 - b1) / (m1 - m2)

            if not (a <= s <= b):
                continue

            if not function_valid_at(funcs[i], s):
                continue

            if not function_valid_at(funcs[j], s):
                continue

            candidates.add(s)

    return sorted(candidates)


def interval_attributes(
    a,
    b,
    du,
    dv,
    c,
    edge_id,
    snap_edge_id,
    snap_fraction,
    total_budget_sec
):
    funcs = route_functions_for_edge(
        du, dv, c, edge_id, snap_edge_id, snap_fraction
    )

    candidates = candidate_s_values_for_interval(a, b, funcs)

    travel_values = [
        travel_time_piecewise(s, funcs)
        for s in candidates
    ]

    mid = (a + b) / 2.0
    travel_mid = travel_time_piecewise(mid, funcs)

    travel_min = min(travel_values)
    travel_max = max(travel_values)

    return {
        "travel_sec_min": travel_min,
        "travel_sec_mid": travel_mid,
        "travel_sec_max": travel_max,
        "activity_sec_min": total_budget_sec - 2.0 * travel_max,
        "activity_sec_mid": total_budget_sec - 2.0 * travel_mid,
        "activity_sec_max": total_budget_sec - 2.0 * travel_min
    }
```

This is more careful than only sampling the midpoint.

## 19. Build reachable road features

Pseudo-code:

```python
def build_reachable_features_for_origin(
    graph,
    dist,
    candidate_edges,
    snap,
    cutoff_sec,
    total_budget_sec,
    min_activity_sec,
    unproject
):
    features = []

    for edge_id in candidate_edges:
        u = graph.edge_u[edge_id]
        v = graph.edge_v[edge_id]
        c = graph.edge_cost_sec[edge_id]

        du = dist[u]
        dv = dist[v]

        intervals = reachable_intervals_on_edge(
            du=du,
            dv=dv,
            edge_cost=c,
            cutoff_sec=cutoff_sec,
            edge_id=edge_id,
            snap_edge_id=snap.edge_id,
            snap_fraction=snap.fraction
        )

        if not intervals:
            continue

        for a, b in intervals:
            attrs = interval_attributes(
                a=a,
                b=b,
                du=du,
                dv=dv,
                c=c,
                edge_id=edge_id,
                snap_edge_id=snap.edge_id,
                snap_fraction=snap.fraction,
                total_budget_sec=total_budget_sec
            )

            # Numerical tolerance
            if attrs["activity_sec_min"] + 1e-6 < min_activity_sec:
                continue

            geom = clipped_edge_geometry(
                graph,
                edge_id,
                a,
                b,
                unproject
            )

            feature = {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "edge_id": edge_id,
                    "osm_way_id": graph.edge_way_id[edge_id],
                    "highway": graph.edge_highway[edge_id],
                    "interval_start": a,
                    "interval_end": b,
                    "cutoff_sec": cutoff_sec,
                    "total_budget_sec": total_budget_sec,
                    "min_activity_sec": min_activity_sec,
                    **attrs
                }
            }

            features.append(feature)

    return features
```

Then attach `origin_id`:

```python
for feature in features:
    feature["properties"]["origin_id"] = origin.id
```

## 20. Full request pseudo-code

```python
def process_activity_network_request(request):
    T = request["total_budget_sec"]
    A = request["min_activity_sec"]

    if T <= 0:
        return empty_response("total_budget_sec must be positive")

    if A < 0:
        return empty_response("min_activity_sec must be non-negative")

    if T <= A:
        return empty_response("No travel time available after activity constraint")

    cutoff_sec = (T - A) / 2.0

    profile = make_mode_profile(request["mode"])

    original_extent = request["extent"]

    project, unproject = make_projector_for_extent(original_extent)

    padded_extent = compute_padded_extent(
        original_extent=original_extent,
        origins=request["origins"],
        cutoff_sec=cutoff_sec,
        max_speed_mps=profile["max_speed_kmh"] / 3.6,
        safety_factor=1.2,
        project=project,
        unproject=unproject
    )

    osm_json = download_osm_highways(padded_extent)

    osm_nodes, osm_ways = parse_osm_json(osm_json)

    graph = build_graph(
        nodes=osm_nodes,
        ways=osm_ways,
        mode_profile=profile,
        project=project
    )

    if len(graph.edge_u) == 0:
        return empty_response("No routable road edges found")

    edge_index = build_edge_spatial_index(graph)

    all_features = []

    for origin in request["origins"]:
        snap = snap_origin_to_graph(
            origin=origin,
            graph=graph,
            edge_index=edge_index,
            project=project,
            max_snap_distance_m=profile["max_snap_distance_m"]
        )

        if snap is None:
            continue

        dist, candidate_edges = bounded_dijkstra(
            graph=graph,
            seeds=snap.seeds,
            cutoff_sec=cutoff_sec,
            snap_edge_id=snap.edge_id
        )

        features = build_reachable_features_for_origin(
            graph=graph,
            dist=dist,
            candidate_edges=candidate_edges,
            snap=snap,
            cutoff_sec=cutoff_sec,
            total_budget_sec=T,
            min_activity_sec=A,
            unproject=unproject
        )

        for feature in features:
            feature["properties"]["origin_id"] = origin["id"]

        if request.get("return_only_inside_user_extent", True):
            features = clip_or_filter_features_to_extent(
                features,
                original_extent
            )

        all_features.extend(features)

    return {
        "type": "FeatureCollection",
        "features": all_features,
        "metadata": {
            "model": "undirected_symmetric_activity_network",
            "cutoff_sec": cutoff_sec,
            "total_budget_sec": T,
            "min_activity_sec": A,
            "road_graph_edges": len(graph.edge_u),
            "road_graph_nodes": len(graph.xs)
        }
    }
```

## 21. Extent padding implementation

The padded extent should include both the user display extent and the origins. This matters if an origin lies outside the display extent.

```python
def compute_padded_extent(
    original_extent,
    origins,
    cutoff_sec,
    max_speed_mps,
    safety_factor,
    project,
    unproject
):
    points = []

    # Extent corners
    for lon in [original_extent["west"], original_extent["east"]]:
        for lat in [original_extent["south"], original_extent["north"]]:
            points.append(project(lon, lat))

    # Origins
    for origin in origins:
        points.append(project(origin["lon"], origin["lat"]))

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]

    buffer_m = max_speed_mps * cutoff_sec * safety_factor

    min_x = min(xs) - buffer_m
    max_x = max(xs) + buffer_m
    min_y = min(ys) - buffer_m
    max_y = max(ys) + buffer_m

    corners_lonlat = [
        unproject(min_x, min_y),
        unproject(min_x, max_y),
        unproject(max_x, min_y),
        unproject(max_x, max_y)
    ]

    lons = [p[0] for p in corners_lonlat]
    lats = [p[1] for p in corners_lonlat]

    return {
        "west": min(lons),
        "south": min(lats),
        "east": max(lons),
        "north": max(lats)
    }
```

## 22. Clipping or filtering to user extent

There are two options.

Simpler:

```text
Return all reachable edges from the padded analysis extent.
Frontend filters by viewport.
```

Better:

```text
Clip returned line features to the original user extent.
```

If you clip after computing reachable intervals, recompute activity attributes for the clipped interval if possible. Otherwise, the attributes may describe the pre-clipped piece rather than the returned piece.

For the first implementation, filtering by intersection is acceptable:

```text
If line intersects original extent:
    return it
else:
    discard it
```

For a cleaner output, use a geometry library to clip the line to the extent polygon.

## 23. Performance strategy for 100+ origins

The expensive work should happen once:

```text
Download OSM once.
Parse OSM once.
Build graph once.
Build spatial index once.
Run Dijkstra 100+ times.
```

Avoid this:

```text
for each origin:
    download OSM
    parse OSM
    build graph
    run Dijkstra
```

Use this:

```text
download/build graph once for padded extent
for each origin:
    snap
    bounded Dijkstra
    extract reachable edges
```

Main optimizations:

```text
1. Bound Dijkstra by cutoff R.
2. Use adjacency lists, not NetworkX.
3. Use candidate_edges collected during Dijkstra.
4. Reuse distance arrays between origins.
5. Use an edge spatial index for snapping.
6. Do not generate polygons.
7. Cache downloaded OSM and graph for repeated similar extents.
8. Parallelize origins if CPU allows.
```

If multiple origins share the same snapped edge and almost the same fraction, reuse the previous result.

If the same origin is evaluated for multiple budgets:

```text
Run Dijkstra once with the largest cutoff.
Reuse distances for smaller cutoffs.
```

## 24. Temporary caching without “precomputation”

Even if you cannot persistently precompute a network, you can still use request-level or session-level caching.

Cache key:

```text
rounded padded extent
mode
speed profile version
OSM query type
```

Example:

```python
cache_key = (
    round(padded_extent["west"], 3),
    round(padded_extent["south"], 3),
    round(padded_extent["east"], 3),
    round(padded_extent["north"], 3),
    request["mode"],
    profile["version"]
)
```

Cache value:

```text
OSM JSON
parsed nodes/ways
temporary graph
spatial index
```

This is not offline precomputation. It is just avoiding duplicated work during the user session.

## 25. Handling large extents

Set hard limits. Example:

```text
max_padded_area_km2_driving = 10,000
max_padded_area_km2_walking = 500
max_osm_elements = 1,000,000
max_graph_edges = 2,000,000
```

If exceeded:

```json
{
  "error": "analysis_extent_too_large",
  "message": "Reduce the extent, reduce time budget, or use a smaller travel mode."
}
```

Alternatively, degrade:

```text
For large driving extents:
    include only motorway, trunk, primary, secondary, tertiary

For local details near origins:
    include residential/service roads within smaller buffers
```

Do not add this degradation in the first implementation unless necessary.

## 26. Correctness tests

Use small artificial graphs before testing OSM.

Test 1: budget too small.

```text
T = 100
A = 120
Expected: empty
```

Test 2: single edge from origin node.

```text
edge cost = 100
T = 300
A = 100
R = 100

Expected:
    full edge reachable
    activity at far endpoint = 100
    activity at origin = 300
```

Test 3: half edge reachable.

```text
edge cost = 100
T = 200
A = 100
R = 50

Expected:
    interval [0, 0.5] reachable
```

Test 4: origin in middle of long edge.

```text
edge cost = 100
origin fraction f = 0.5
T = 40
A = 20
R = 10

Expected:
    reachable interval [0.4, 0.6]
    even though neither endpoint is reachable
```

Test 5: edge reachable from both endpoints.

```text
du = 0
dv = 0
edge cost = 100
R = 50

Expected:
    interval [0, 1]
    max travel time at s = 0.5
```

Test 6: activity guarantee.

```text
For every returned feature:
    activity_sec_min >= min_activity_sec - epsilon
```

Test 7: boundary padding.

```text
Origin near edge of user extent.
A route exits the user extent and re-enters.
Expected:
    reachable road inside display extent is still returned
```

## 27. Known limitations of this simplified model

This version intentionally ignores:

```text
one-way roads
turn restrictions
turn penalties
traffic
time of day
road closures
private roads beyond simple access tags
routing hierarchy
ferries
complex restrictions
elevation
different outbound and return paths
```

For walking or rough accessibility mapping, the simplified undirected model may be acceptable. For car routing in dense downtown networks, it will overestimate reachability because it ignores one-way streets and turn restrictions.

The next more accurate version is:

```text
directed graph
forward Dijkstra from origin
reverse Dijkstra from origin on reversed graph
activity_time(x) = T - go_time(x) - return_time(x)
```

That roughly doubles the search work and complicates edge clipping, but it handles one-way directionality.

## 28. Recommended implementation modules

An AI coding agent should implement these modules in this order:

```text
models.py
    Request
    Extent
    Origin
    ModeProfile
    Graph
    SnapResult

projection.py
    make_projector_for_extent
    project
    unproject
    buffer_extent

osm_download.py
    build_overpass_query
    download_osm_highways
    split_extent_if_needed

osm_parse.py
    parse_osm_json

profiles.py
    make_mode_profile
    is_way_allowed
    speed_for_way
    parse_maxspeed_kmh

graph_build.py
    build_graph

spatial_index.py
    build_edge_spatial_index
    query_nearest_edges

snap.py
    snap_origin_to_graph
    snap_point_to_segment

dijkstra.py
    bounded_dijkstra
    DijkstraWorkspace

edge_reachability.py
    reachable_intervals_on_edge
    travel_time_at_fraction
    interval_attributes
    clipped_edge_geometry

geojson_output.py
    build_feature
    clip_or_filter_features_to_extent

engine.py
    process_activity_network_request
```

Implementation order:

```text
1. Projection
2. OSM parsing from saved sample JSON
3. Graph building
4. Dijkstra on artificial graph
5. Edge interval clipping
6. GeoJSON output
7. Origin snapping
8. Live OSM download
9. Multi-origin request orchestration
10. Caching and performance optimization
```

## 29. Minimal first version

The smallest useful implementation is:

```text
Input:
    extent
    origins
    total_budget_sec
    min_activity_sec
    mode

Algorithm:
    R = (T - A) / 2
    padded_extent = extent buffered by max_speed * R * 1.2
    download way["highway"] from OSM
    parse nodes and ways
    build undirected graph from consecutive OSM node pairs
    build edge spatial index
    for each origin:
        snap to nearest edge
        run bounded Dijkstra
        compute reachable intervals on candidate edges
        output clipped LineString features
```

This version is implementable locally and can handle 100+ origins if the padded extent is not too large.

## 30. Final implementation rule

The graph is temporary, but it must still be built once per analysis extent:

```text
Correct:
    one OSM download
    one graph build
    100+ bounded Dijkstra searches

Incorrect:
    100+ OSM downloads
    100+ graph builds
    100+ full-network shortest path searches
```

That is the main design constraint. The algorithm is feasible locally because each origin uses a bounded one-way search, and the OSM-to-graph conversion is shared across all origins in the request.

[1]: https://wiki.openstreetmap.org/wiki/Elements "https://wiki.openstreetmap.org/wiki/Elements"
[2]: https://wiki.openstreetmap.org/wiki/Key%3Ahighway "https://wiki.openstreetmap.org/wiki/Key%3Ahighway"
[3]: https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL "https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL"

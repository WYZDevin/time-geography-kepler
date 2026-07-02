# Space-Time Prism — Algorithm

> How the tool computes where a subject could have been between two timed
> anchors, using a real road network and a two-cone reachability test.

This page describes the **computation** behind the Space-Time Prism tool. For the
options that control it, see the [Space-Time Prism parameters](/tools/space-time-prism)
page. For the underlying theory — time budget, potential path area — see
[Core Concepts](/guide/concepts#the-space-time-prism).

::: info Where this runs
The active prism is computed on the Flask backend over a downloaded road network.
The formulas below describe that network path (the current default). A simpler
Euclidean two-circle fallback also exists and is noted where relevant.
:::

## Pipeline at a glance

```
two anchors (A, B with lon/lat + time)
      │
      ▼
order by time ──▶ time budget T, travel budget K = T − activity
      │
      ▼
download OSM roads around anchors ──▶ build weighted graph (edge cost = length / speed)
      │
      ▼
snap A and B to nearest edges
      │
      ▼
forward Dijkstra from A  +  backward Dijkstra from B
      │
      ▼
keep edges where reach(A) + reach(B) ≤ K   ← the potential path area
      │
      ├─ lift each edge to a height from its time window → 3D prism
      └─ aggregate slack time into H3 cells → flat dwell surface
```

## 1. Anchors and the time budget

The two anchors are ordered by timestamp (swapped if needed) so A is the earlier
point. From them:

```
T = t_B − t_A                     total time between the anchors
A_min = minimum activity time     (default 5 minutes)
K = T − A_min                     time actually available for travel
```

`K` is the round-trip travel budget: a place is reachable only if the subject can
get there from A **and** still reach B, while leaving at least `A_min` free.

## 2. Downloading the road network

Roads are pulled from OpenStreetMap (via the Overpass API) for a bounding box
around the two anchors, padded by how far the fastest allowed speed could travel
in the available time (with a safety margin). Highway types are filtered by mode
— driving keeps through-roads (motorway → tertiary), walking adds footways and
paths and drops motorways.

To stay responsive, the download area is capped per mode (roughly **1 500 km²**
walking, **4 000** cycling, **15 000** transit, **25 000** driving). Moderately
oversized requests are trimmed to a corridor between the anchors; extreme ones
are rejected. Results are cached both in memory and on disk, and a larger cached
extent is clipped and reused when it already covers the request.

## 3. Building the travel-time graph

The road lines are projected to a local metric (UTM) CRS and split into
edges between consecutive vertices. Shared endpoints are merged into shared nodes.
Every edge is weighted by its **free-flow travel time**:

```
edge_cost_seconds = edge_length_meters / speed_meters_per_second
```

Edge speed comes from the road's OSM `maxspeed` tag when present, otherwise from
the mode profile's speed for that highway class, otherwise the mode default. The
travel modes map to these base speeds:

| Mode | Speed |
|------|-------|
| Walking | 5 km/h (≈ 1.39 m/s) |
| Cycling | 15 km/h (≈ 4.17 m/s) |
| Transit | 30 km/h (≈ 8.33 m/s) |
| Driving | 60 km/h (≈ 16.67 m/s) |
| Custom | user-set (1–120 km/h) |

## 4. Speed realism

The cached graph stores free-flow speeds. Real travel is usually slower, so a
single **factor** `f` scales all speeds without rebuilding the graph:

- **Free-flow** — `f = 1.0` (optimistic upper bound).
- **Manual** — an explicit factor, clamped to `[0.25, 1.5]`.
- **Auto** — calibrated from the loaded GPS fixes: the median ratio of observed
  speed to the expected road speed over consecutive fixes (needs ≥ 8 moving
  samples); if that is not available, a time-of-day congestion heuristic is used
  (≈ 0.55× at peak hours, 0.75× at shoulders, 0.95× at night, motorized modes
  only).

The factor is applied by scaling the Dijkstra cutoff and rescaling the resulting
travel times (`time_scale = 1 / f`).

## 5. Snapping the anchors

Each anchor is projected to metric coordinates and snapped to the **nearest road
edge** using a spatial index. The closest point along the edge gives a fraction
`f ∈ [0, 1]`, which seeds the search at both endpoints of that edge with the
appropriate partial travel cost. If the nearest road is farther than the mode's
snap limit (≈ 50 m walking up to 500 m driving), the anchor is rejected.

## 6. Two-cone reachability

Two bounded Dijkstra searches run over the graph, each stopping at the travel
budget:

- **Forward** from A → `d_a(node)` = earliest time to *reach* each node from A.
- **Backward** from B → `d_b(node)` = time still needed to *get from* each node
  to B.

A location is inside the potential path area when the round trip fits the budget:

```
feasible(x)  ⇔  d_a(x) + d_b(x) ≤ K
```

The exact test is done per edge as a lower-envelope of piecewise-linear travel
times so partial edges near the boundary are handled; the production path keeps
whole feasible edges for speed. The 2D union of all feasible edges **is** the
potential path area (PPA).

## 7. Slack (dwell) time

Every feasible location also has a **slack time** — how long the subject could
linger there and still make it to B on time:

```
activity(x) = T − d_a(x) − d_b(x)     ( ≥ A_min across the PPA )
```

This is the value that fills the dwell surface: high near the anchors' shared
"comfortable" middle, dropping to zero at the reachable frontier.

## 8. The dwell surface (H3)

Feasible edges are sampled into **H3 hexagonal cells**. The resolution is chosen
automatically from the reachable extent (aiming for a manageable cell count,
within H3 levels 6–11) or set explicitly. Each edge contributes a few sample
points; a cell's dwell value is the **maximum** `activity(x)` of any sample
falling in it, reported in minutes. The result is a flat polygon layer colored by
dwell minutes — this is the default map view.

## 9. The 3D prism

To give the prism its shape, each feasible edge is lifted to a **height** derived
from the midpoint of its occupiable time window `[t_A + d_a, t_B − d_b]` —
low near A, rising toward B. Stacked together, the edges form the classic prism:
a forward cone from A intersected with a backward cone to B. The total drawing
height matches the trajectory's Z scale so the prism aligns with the 3D path:

```
frac = (t − t_A) / (t_B − t_A)             # 0 … 1 along the time budget
z    = z_start + frac · (z_end − z_start)
total_height = max(spatial_extent_deg · 111 000 · 0.5, 1000)   # meters
```

The **Time Slices** option controls how finely this vertical structure is drawn.

::: details Euclidean fallback
When the network path is not used, each slice is the intersection of two circles:
one grown from A with radius `speed · (s/N) · T` and one from B with radius
`speed · (1 − s/N) · T`. The stacked intersections approximate the prism without
road constraints.
:::

## 10. Output

The tool returns up to three GeoJSON layers:

| Layer | Geometry | Key properties |
|-------|----------|----------------|
| **PPA road network** | 3D `LineString` per feasible edge | `activity_sec_min/mid/max` (slack), `forward_sec`, `backward_sec`, `highway`, `color_rgba` |
| **Dwell surface** | H3 `Polygon` | `h3_index`, `dwell_minutes`, `edge_count`, `total_budget_min`, `min_activity_min` |
| **Anchors** | 3D `Point` | `anchor_role` (`start_anchor` / `end_anchor`), `anchor_label`, `_timestamp` |

The road-network layer is subsampled (default ~15 000 segments) before rendering
to keep the browser responsive, and very minor road classes are dropped first so
the visible network stays meaningful.

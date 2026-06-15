# Space-Time Prism

> Compute the potential path area — where a subject could have been between two
> timed anchor points, constrained by a road network and a travel speed.

**Tool ID:** `space-time-prism` · **Runs:** Backend (`backend_only`)

Given two known points in space and time (*"here at 9:00, there at 10:00"*), the
**space-time prism** is everything reachable in between. Its ground shadow is the
**Potential Path Area (PPA)**.

Unlike the other tools, the prism is driven by the **Prism Explorer** — a
floating panel where you place anchors directly on the map.

## Getting the tool

- **Where:** click **Start Prism Explorer** (bottom-left of the map) — the prism
  is *not* in the regular tool picker; it has its own panel.
- **Where it runs:** on the **Flask backend** (`backend_only`). Start the backend
  (or use Docker) first. The explorer downloads OSM roads for the anchor extent at
  run time, so the machine running the backend needs network access to OSM (the
  result is cached on disk for reuse).
- **Input:** two anchors A and B placed on the map (each carrying a location and a
  time). Anchors may snap to data points or be picked freely. No dataset is
  strictly required, but the time budget comes from the two anchors' timestamps.
- **Disabled while** [pin-point mode](/guide/map-controls#pin-point-mode) is
  active — turn pins off to use it.

## Opening the explorer

Click **Start Prism Explorer** (bottom-left of the map). The panel appears and
the map enters anchor-selection mode.

::: tip Hide vs. close
The panel header has two buttons:
- **Hide** (chevron) collapses the panel but keeps the explorer active — the
  prism stays on the map and you can re-open the controls anytime.
- **Close** (✕) exits the explorer and removes its layers.
:::

## Placing anchors

1. With the explorer active, **click a point on the map** to set **Anchor A**.
2. Click again to set **Anchor B**.

Each anchor shows as a colored marker with a vertical stem to the ground (red for
A, blue for B). Use **Swap** to exchange A/B, **Clear B** to re-pick the second
anchor, or **Pick New Anchors** to restart. Once both anchors exist, set the
parameters and click **Start Building** to compute the prism.

## Walkthrough

The prism needs two anchors with **different timestamps** — click directly on
two GPS points of a loaded trajectory so each anchor inherits that point's time,
or set the time budget manually with the **durationMinutes** fallback that
appears when the anchors share a time.

### 1. Open the explorer

Click **Start Prism Explorer** (bottom-left of the map). The panel opens and the
map enters anchor-selection mode.

![Prism Explorer opened, prompting for Anchor A](/screenshots/prism-explorer.png)

### 2. Place the anchors & set parameters

Click the map to drop **Anchor A**, then **Anchor B**. The panel then shows the
travel parameters: **Travel Speed** (mode profile), **Speed Realism**, the
**Time Budget** (here 45 min, taken from the two anchor timestamps), **Min
Activity Duration**, **Time Slices**, and the **Road Network** source
(auto-downloaded from OSM for the anchors' extent).

![Both anchors placed with parameters and Start Building](/screenshots/prism-anchors.png)

### 3. Build & read the result

Click **Start Building**. The backend downloads the road network, runs the two
bounded Dijkstra searches (forward from A, backward from B), and returns the
potential path area:

![Computed potential path area between the anchors](/screenshots/prism-result.png)

- The **potential dwell-time surface** (blue → red hexes) covers everywhere the
  subject could have been, colored by how many minutes of activity each
  location allows within the budget.
- The **reachable roads** trace the exact network segments behind the surface.
- A faster **Speed** or a larger time gap between anchors widens the prism;
  **hover** any cell or road to read its values.

## Algorithm

The active model is a **two-anchor road-network potential path area** — the
network form of Hägerstrand's space-time prism (Miller, 1991), computed as the
intersection of two reachability cones. See `PPA_ESTIMATION.md` in the repository
for the full handbook.

Let `T = t_B − t_A` be the time budget and `A_min` the minimum activity time. A
road-network point `x` is in the PPA when the subject can leave A, reach `x`,
still get to B, and have at least `A_min` to spend there:

```text
travel(A → x) + travel(x → B) + A_min ≤ T
```

How it's computed:

1. **Download & build graph.** OSM roads for the anchors' bounding extent are
   fetched (and disk-cached), then turned into a travel-time graph using a
   **mode profile** (a fixed max speed per mode). The extent is rejected if it is
   too large for an interactive run.
2. **Two bounded Dijkstra searches** over the shared graph — one **forward from A**,
   one **backward from B** — give `travel(A → x)` and `travel(x → B)` for every
   reachable edge.
3. **Cone intersection.** Each edge is kept when the sum above fits the budget;
   `activity_time(x) = T − travel(A→x) − travel(x→B) − A_min` is the slack, which
   colors the result. (The travel model is **undirected and symmetric**, so the
   return trip is assumed to take as long as the outbound trip.)
4. **Dwell surface (default map view).** All reachable edges are aggregated
   into flat H3 cells colored by the **best available activity time** there —
   *"if you stop here, how long could you stay and still make it from A to B
   on time"*. This is the main-map rendering, drawn together with the
   ground-projected roads.
5. **3D prism sheets.** The prism is drawn as discrete horizontal time sheets:
   at elapsed time `τ` a road is in the cross-section when it lies in both
   cones (`travel(A→x) ≤ τ` and `travel(x→B) ≤ T − τ`), so the prism tapers to
   A at the bottom and B at the top. The sheets render on the **main map at the
   original Z scale** (anchor A at its trajectory height, B at its) and in the
   **Focused 3D View** with Z re-stretched to fill the dialog — useful when the
   anchor window is a small slice of a multi-day trajectory.

::: info Replaces the old per-GPS-point model
This two-anchor cone intersection replaces the earlier `gps_road_network` model,
where the two anchors only bounded a sampling window and each GPS point produced
its own single-cone round-trip PPA.
:::

## Options

| Option | Key | Default | Description |
|--------|-----|---------|-------------|
| **Prism Mode** | `prismMode` | PPA Road Network | The reachability model (see below). |
| **Speed** | `speedMode` | Walking (5 km/h) | Maximum travel speed / mode profile: Walking 5 · Cycling 15 · Transit 30 · Driving 60 · Custom. Sets the graph's travel times. |
| **Custom speed** | `customSpeed` | 5 km/h | Used when Speed is set to *Custom*. |
| **Speed Realism** | `speedAdjustment` | Free-flow (`off`) | Adjust free-flow profile speeds to real conditions. `auto` calibrates a personal speed factor from the loaded GPS trajectory (observed vs. expected speed between fixes); without usable movement data it falls back to a time-of-day congestion factor (rush hour ×0.55, daytime ×0.75, night ×0.95 — motorised modes only). `manual` applies **Speed Factor** directly. The applied factor is reported in the run warnings. |
| **Speed Factor** | `speedFactor` | ×0.7 | Real speed = factor × profile speed; used when Speed Realism is *Manual* (clamped to 0.25–1.5). |
| **Show PPA** | `showPPA` | on | Draw the potential path area surface. |

When OSM roads are auto-downloaded, posted speed limits (`maxspeed` tags) now
override the class-default speeds wherever they are mapped, regardless of the
Speed Realism setting.

::: info Backend tunables
The backend also accepts `timeSlices` (default 10) for how many vertical slices
the 3D prism is stacked into, and `h3Resolution` (default: auto from the
reachable extent) for the dwell surface's cell size.
:::

### Prism modes

| Mode | Description |
|------|-------------|
| **PPA Road Network** (`road-network-stp`) | The realistic, network-constrained PPA computed by the two-anchor cone intersection above. This is the active mode. |
| **PASTA – H3 Potential Path Area** (`pasta`) | An H3-grid potential-dwell-time variant. Currently **disabled** in the UI (the panel coerces back to PPA Road Network). |

## Reading the result

- **Anchors A & B** — your two fixed space-time points.
- **Potential dwell time surface** — flat hex cells covering everywhere the
  subject could have been, colored blue → red by how many minutes of activity
  the location allows within the budget. Hot cells near the direct corridor
  mean lots of slack; cold cells at the rim are barely reachable.
- **Reachable roads (ground)** — the exact network segments behind the surface,
  on the same color ramp.
- **Space-Time Prism (3D Sheets)** — the prism's time cross-sections stacked
  between the anchors at the original Z scale; animating sweeps the
  cross-section from A to B. The **Focused 3D View** shows the same prism with
  Z re-stretched for legibility. (The older one-height-per-edge 3D stack is
  still available in the legend, off by default.)
- A faster **Speed** widens the prism (more is reachable); a slower speed narrows
  it. A larger time gap between anchors also widens it.

## Exported data

Exports follow the [shared conventions](/tools/#exporting-results): flat 2D
WGS84 geometry, analysis attributes only. The time-stacked 3D lift is
stripped; the reachability quantities below are what carry the analysis.

All travel/activity times are **seconds**; the travel model is undirected and
symmetric. A road point `x` satisfies
`forward_sec + backward_sec + min_activity_sec ≤ total_budget_sec`.

### Reachable roads (`ppa-road-network`)

One LineString per reachable road edge. The ground layer is the same dataset,
so both export identically. Note the drawn set may be reduced by the
minor-road filter and the render cap (see Options) — the dwell surface below
aggregates the *full* reachable set.

| Field | Type | Meaning |
|---|---|---|
| `edge_id` | integer | Road-graph edge index (stable within one run). |
| `highway` | string | OSM highway class (e.g. `primary`, `residential`). |
| `forward_sec` | number | Shortest travel time A → edge. |
| `backward_sec` | number | Shortest travel time edge → B. |
| `activity_sec_min` / `_mid` / `_max` | number | Available activity time when stopping at this edge (worst / middle / best point on the edge). Boundary edges are included whole, so only `activity_sec_max` is a per-edge guarantee. |
| `total_budget_sec` | number | `T = t_B − t_A` (or the override). |
| `min_activity_sec` | number | The configured activity floor `A_min`. |
| `shortest_path_sec` | number | Network shortest path A → B. |
| `timestamp_ms`, `time_iso` | — | Midpoint of the edge's occupiable time window. |

### Dwell surface (`ppa-dwell-surface`)

Flat H3 hexagon polygons aggregated from **all** reachable edges (before the
render filters).

| Field | Type | Meaning |
|---|---|---|
| `h3_index` | string | H3 cell index (join key for `h3`/`h3-py`). |
| `dwell_minutes` | number | Best available activity time in the cell, minutes (max of `activity_sec_max` over its edges ÷ 60). |
| `edge_count` | integer | Reachable edges sampled into the cell. |
| `total_budget_min` | number | `T` in minutes. |
| `min_activity_min` | number | `A_min` in minutes. |

### Anchors (`prism-anchors`)

Two Point features.

| Field | Type | Meaning |
|---|---|---|
| `anchor_role` | string | `start_anchor` (A) or `end_anchor` (B). |
| `anchor_label` | string | The label shown in the explorer. |
| `timestamp_ms`, `time_iso` | — | The anchor's time. |

## Notes

- The prism is **backend-only** — start the Flask server (or use Docker) before
  running it.
- The explorer is **disabled while [pin-point mode](/guide/map-controls#pin-point-mode)
  is active**; turn pins off to use it.
- For the mathematics behind the network PPA estimation, see `PPA_ESTIMATION.md`
  in the repository.

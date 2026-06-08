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
anchor, or **Pick New Anchors** to restart. As soon as both anchors exist, the
prism computes automatically.

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
4. **3D prism.** Kept road segments are stacked into time slices and lifted to
   `Z = time`; the frontend also mirrors them to a flat ground-projected sibling —
   the 2D PPA.

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
| **Show PPA** | `showPPA` | on | Draw the potential path area surface. |

::: info Backend tunable
The backend also accepts `timeSlices` (default 10) for how many vertical slices
the 3D prism is stacked into.
:::

### Prism modes

| Mode | Description |
|------|-------------|
| **PPA Road Network** (`road-network-stp`) | The realistic, network-constrained PPA computed by the two-anchor cone intersection above. This is the active mode. |
| **PASTA – H3 Potential Path Area** (`pasta`) | An H3-grid potential-dwell-time variant. Currently **disabled** in the UI (the panel coerces back to PPA Road Network). |

## Reading the result

- **Anchors A & B** — your two fixed space-time points.
- **Reachable roads / PPA** — the network segments (or area) the subject could
  have traversed between the anchors, stacked in 3D by time and colored by
  available activity time (slack).
- A faster **Speed** widens the prism (more is reachable); a slower speed narrows
  it. A larger time gap between anchors also widens it.

## Notes

- The prism is **backend-only** — start the Flask server (or use Docker) before
  running it.
- The explorer is **disabled while [pin-point mode](/guide/map-controls#pin-point-mode)
  is active**; turn pins off to use it.
- For the mathematics behind the network PPA estimation, see `PPA_ESTIMATION.md`
  in the repository.

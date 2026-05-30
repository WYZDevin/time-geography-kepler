# Space-Time Prism

> Compute the potential path area — where a subject could have been between two
> timed anchor points, constrained by a road network and a travel speed.

**Tool ID:** `space-time-prism` · **Runs:** Backend (`backend_only`)

Given two known points in space and time (*"here at 9:00, there at 10:00"*), the
**space-time prism** is everything reachable in between. Its ground shadow is the
**Potential Path Area (PPA)**.

Unlike the other tools, the prism is driven by the **Prism Explorer** — a
floating panel where you place anchors directly on the map.

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

## Options

| Option | Default | Description |
|--------|---------|-------------|
| **Prism Mode** | PPA Road Network | The reachability model (see below). |
| **Speed** | Walking (5 km/h) | Maximum travel speed: Walking 5 · Cycling 15 · Transit 30 · Driving 60 · Custom. |
| **Custom speed** | 5 km/h | Used when Speed is set to *Custom*. |
| **Show PPA** | on | Draw the potential path area surface. |

### Prism modes

| Mode | Description |
|------|-------------|
| **PPA Road Network (per-GPS-point)** | Reachability computed along the real road network around each point — the realistic, network-constrained PPA. This is the active mode. |
| **PASTA – H3 Potential Path Area** | An H3-grid potential-path-area variant. Currently disabled in the UI. |

## Reading the result

- **Anchors A & B** — your two fixed space-time points.
- **Reachable roads / PPA** — the network segments (or area) the subject could
  have traversed between the anchors, often stacked in 3D by time.
- A faster **Speed** widens the prism (more is reachable); a slower speed narrows
  it.

## Notes

- The prism is **backend-only** — start the Flask server (or use Docker) before
  running it.
- The explorer is **disabled while [pin-point mode](/guide/map-controls#pin-point-mode)
  is active**; turn pins off to use it.
- For the mathematics behind the network PPA estimation, see `PPA_ESTIMATION.md`
  in the repository.

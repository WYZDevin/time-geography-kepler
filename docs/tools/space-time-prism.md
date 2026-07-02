# Space-Time Prism

> Compute where a subject could have been between two timed anchor points.

**Tool ID:** `space-time-prism`

The Space-Time Prism tool estimates the **Potential Path Area (PPA)** between
two known points in space and time, using a road network, a travel speed, and
the time available between the anchors. Unlike the other tools, it is
controlled from the **Prism Explorer** after running the **3D Trajectory**
tool: you place Anchor A and Anchor B directly on the map. For the computation
— the road-network graph, the two-cone reachability test, and the dwell
surface — see the
[Space-Time Prism algorithm](/tools/space-time-prism-algorithm).

## Parameters

Most parameters control reachability: a higher speed or longer time budget
expands the prism, a larger required activity time shrinks it.

| Option | Default | Description |
|--------|---------|-------------|
| **Anchor A / Anchor B** | selected on map | The two known space-time points. Place each on a GPS point from the trajectory so it inherits both location and timestamp. The backend orders them by timestamp. |
| **Time Budget** | from anchors | The difference between the two anchor timestamps — there is no manual slider. Longer budgets widen the prism; budgets shorter than the network travel time make it infeasible. |
| **Travel Speed** | Walking (5 km/h) | Speed profile used to build road travel times: Walking (5), Cycling (15), Transit (30), Driving (60 km/h), or Custom. The strongest control on PPA size. |
| **Custom Speed** | 5 km/h | Manual speed (1–120 km/h) used when **Travel Speed** is Custom. |
| **Speed Realism** | Free-flow | **Free-flow** uses the mode speed directly (optimistic upper bound). **Auto** estimates an adjustment from the loaded GPS trajectory. **Manual** applies the Speed Factor. |
| **Speed Factor** | ×0.70 | Multiplier (×0.25–×1.50) applied to the selected speed when **Speed Realism** is Manual. |
| **Min Activity Time** | 5 min | Minimum time (0–120 min) the subject must be able to spend at a location for it to count as reachable. Larger values shrink the prism. |
| **Time Slices** | 15 | Number of cross-sections (2–30) used to draw the 3D prism. More slices are smoother but cost more to compute and render; the 2D dwell surface is unaffected. |
| **Road Network** | auto-downloaded | OpenStreetMap roads fetched around the anchor area and cached. There is no network picker. |

## Notes

- Choose anchors with **different timestamps** — identical timestamps leave no
  positive time window and the backend cannot compute a prism.
- The prism asks: can the subject leave the earlier anchor, visit a location
  for at least the **Min Activity Time**, and still reach the later anchor on
  time? Set the activity time to `0` to count pass-through locations too.
- The road network makes the prism more realistic than a straight-line buffer,
  but the result depends on OSM coverage around the anchors. Very large anchor
  areas may be rejected to keep the tool responsive.
- **Custom Speed** should reflect a reasonable *maximum* travel speed, not an
  average, unless a conservative average-speed model is intended.

# Space-Time Kernel Density

> Generate a 3D space-time kernel density estimation with auto-determined
> parameters.

**Tool ID:** `stkde` · **Runs:** Browser (`frontend_only`)

STKDE smooths discrete events into a continuous **3D density volume**, revealing
where **and when** activity concentrates. The result is rendered as nested
confidence surfaces.

## When to use it

- Find spatio-temporal **hotspots** across many points.
- Summarize a busy trajectory (or many subjects) into a readable density.
- Highlight recurring activity windows.

## How it works

The estimator picks spatial and temporal bandwidths automatically from the data,
evaluates a kernel density over a space-time grid, and extracts isosurfaces at
three confidence levels:

| Surface | Meaning |
|---------|---------|
| **90%** | Broadest extent of activity |
| **95%** | Tighter core |
| **99%** | Densest concentration |

The surfaces nest inside one another, so the innermost shell marks the most
intense space-time activity.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| **Datetime Column** | — | Field holding each point's timestamp (required). |
| **Show 3D Coordinate Axes** | on | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels Interval** | Auto | Tick spacing on the time axis (Auto / 1h / 4h / 12h / 24h). |
| **User ID Column** | — | Column identifying each subject. Required to enable alignment. |
| **Align User Start Times (Normalize Time)** | off | Re-base each subject to elapsed time from their own first observation, so subjects tracked over different date ranges overlap on a shared Day 1…Day n axis. |

## Reading the result

- Each confidence level is a separate, toggleable layer in the legend.
- **Rotate** to see how density changes with height (time).
- **Animate** to watch the density build up over the period.

## Tips

- Bandwidths are auto-determined — no manual tuning required to get a first
  result.
- For multi-subject comparisons, set a **User ID Column** and enable
  **Align Start Times** so different recording periods overlay correctly.

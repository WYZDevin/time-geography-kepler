# Tools Overview

Time Geography Kepler ships four analysis tools. Each takes a point trajectory
and produces an interactive 3D result.

| Tool | Question it answers | Runs on | Time player |
|------|--------------------|---------|:-----------:|
| [3D Trajectory](/tools/trajectory-3d) | Where and when did the subject move? | Browser | ✅ |
| [Space-Time Kernel Density](/tools/stkde) | Where/when does activity concentrate? | Browser | ✅ |
| [Space-Time Cube](/tools/space-time-cube) | What was the exposure along the path? | Backend | — |
| [Space-Time Prism](/tools/space-time-prism) | Where could the subject have been? | Backend | ✅ |

## Choosing a tool

- **Just want to see the movement?** → [3D Trajectory](/tools/trajectory-3d)
- **Looking for hotspots across many points?** → [STKDE](/tools/stkde)
- **Overlaying an environmental field (noise, pollution)?** → [Space-Time Cube](/tools/space-time-cube)
- **Reasoning about reachability between two timed points?** → [Space-Time Prism](/tools/space-time-prism)

## Shared options

Several options recur across tools:

| Option | Tools | Effect |
|--------|-------|--------|
| **Datetime Column** | all | Which field holds each point's timestamp (required). |
| **Show 3D Axes** | trajectory, STKDE, cube | Draw labeled X/Y/Z reference axes. |
| **Z-Axis Time Labels** | trajectory, STKDE, cube | Tick interval on the time axis (Auto, 1h, 4h, 12h, 24h). |
| **User / Trajectory ID Column** | trajectory, STKDE, cube | Identifies separate subjects. |
| **Align Start Times (Normalize Time)** | trajectory, STKDE, cube | Re-base each subject to elapsed time from their own start, so subjects tracked over different date ranges overlay on a shared Day 1…Day n axis. |

::: info Execution policy
Each tool declares where it can run — `frontend_only`, `backend_only`, or
`hybrid`. The UI shows a mode toggle only when more than one mode is available.
See [Architecture](/reference/architecture).
:::

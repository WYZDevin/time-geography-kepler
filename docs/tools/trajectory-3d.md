# 3D Trajectory

> Visualize movement trajectories in 3D space-time (X = longitude, Y = latitude,
> Z = time).

**Tool ID:** `time-geography`

The 3D Trajectory tool is the best first view of a movement dataset. It draws
each subject's **space-time path** as a line that climbs as time advances:
near-vertical segments usually indicate stays, long shallow segments faster
movement. For the computation — how time becomes the vertical axis, how stays
are detected, and what the output contains — see the
[3D Trajectory algorithm](/tools/trajectory-3d-algorithm).

![3D Trajectory Visualization](/screenshots/3d-trajectory.png)

## Parameters

| Option | Default | Description |
|--------|---------|-------------|
| **Datetime Column** | — | Required. Field that stores each point's timestamp. Defines point order, the Z-axis height, time labels, animation, and exported `timestamp_ms` / `time_iso` values. |
| **Show 3D Axis** | on | Draw labeled X/Y/Z reference axes around the result. Display only. |
| **Show 2D Ground Path** | off | Add a flattened copy of the route at Z = 0 as a geographic reference. Does not change the 3D path. |
| **Z-Axis Time Labels Interval** | Auto | Tick spacing on the time axis (Auto, 1h, 4h, 12h, 24h). Auto picks a spacing from the data's time span. |
| **User ID Column** | — | Field that identifies separate people, devices, or trajectories. Splits the input into separate colored paths. |
| **Align User Start Times** | off | Re-base each subject to elapsed time from their own first point, so subjects tracked on different dates share a Day 1 … Day n axis. Requires a **User ID Column**. |
| **Visualize Stay Points** | off | Mark places where the subject lingered, such as home, work, or long visits. |
| **Stay Location Field** | — | Optional label field: consecutive points with the same label are grouped into one stay. Leave empty to infer stays from GPS proximity instead. |
| **Stay Point Time Window (hours)** | 24 | Minimum dwell duration (1–168 h) for proximity-based stay detection. Used only when **Visualize Stay Points** is on and no **Stay Location Field** is set. |

## Notes

- **Datetime Column** is the parameter that matters most. If it points at the
  wrong field, or the field mixes formats, the path can appear out of order,
  flattened to one height, or stretched across an unexpected time range.
- Set a **User ID Column** for any multi-subject dataset. Without it, all points
  are treated as one trajectory and the tool may draw false connecting lines
  between different people.
- Use **Align User Start Times** to compare daily patterns across subjects
  recorded on different dates; leave it off when calendar dates and clock time
  matter.
- For stay detection, a larger **time window** shows only long stays; smaller
  values reveal short stops but may flag traffic delays or GPS noise as stays.
  If your data already has reliable place labels, a **Stay Location Field**
  usually gives cleaner markers than proximity detection.

# Space-Time Kernel Density

> Estimate where and when trajectory points concentrate.

**Tool ID:** `stkde`

Space-Time Kernel Density Estimation (STKDE) smooths individual GPS points into
a continuous **3D density volume**. Use it when the raw trajectory is too dense
to read point by point and you want the main activity concentrations in both
space and time. For the computation — the kernel, bandwidth selection, and how
hotspot confidence shells are built — see the
[STKDE algorithm](/tools/stkde-algorithm).

## Parameters

| Option | Default | Description |
|--------|---------|-------------|
| **Datetime Column** | — | Required. Field that stores each point's timestamp. Defines the time axis, slice assignment, animation order, and exported time attributes. |
| **Grid Cell Size (meters)** | 0 | Side length of each density grid cell. `0` auto-detects from the data extent (a 50 × 50 grid by default); the UI shows the estimated auto size. Very fine values may be coarsened by the grid cap. |
| **Time Slice Method** | Equal interval | How the time range is divided: **Equal interval** (uniform time steps), **Equal count** (similar point count per slice), or **Fixed duration** (real-world periods such as hours or days). |
| **Number of Time Slices** | 10 | *(Equal interval / Equal count only.)* More slices show finer temporal change but can be noisier and slower; fewer produce a smoother pattern. |
| **Slice Duration (hours)** | 24 | *(Fixed duration only.)* Length of each slice. Very short durations can create empty or sparse slices. |
| **Align Slices To** | — | *(Fixed duration only.)* Optional anchor for slice boundaries, e.g. midnight to make 24-hour slices behave like calendar days. Empty starts at the first timestamp. |
| **Show 3D Coordinate Axes** | on | Draw labeled X/Y/Z reference axes. Display only. |
| **Z-Axis Time Labels Interval** | Auto | Tick spacing on the vertical time axis. |
| **Show 2D Ground Projection** | off | Add a flat **2D KDE** surface on the map plane, computed from the same points with time dropped — a separate estimate, not a flattened slice of the 3D volume. |
| **Overlay 3D Trajectory** | off | Draw the original trajectory path inside the density volume. |
| **User ID Column** | — | Field that identifies separate subjects. Keeps them separate before optional time alignment. |
| **Align User Start Times** | off | Re-base each subject to elapsed time from their own first point. Requires a **User ID Column**. |

## Notes

- Choose the **Time Slice Method** by the question: **Equal interval** when time
  itself should be uniform on the Z axis, **Equal count** when sampling is
  uneven and sparse periods should stay visible, **Fixed duration** when slices
  should match hours, days, or an external dataset.
- Start with the auto **Grid Cell Size** (`0`), then set an explicit value only
  when you need a specific ground resolution. Finer grids cost more computation
  and may be coarsened for performance.
- Use the **2D Ground Projection** to read the overall hotspot footprint when
  the 3D shells overlap or the angled view is hard to read.
- For pooled hotspot analysis an empty **User ID Column** is acceptable; set it
  for subject-level comparison or when using start-time alignment.

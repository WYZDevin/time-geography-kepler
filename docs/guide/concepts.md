# Core Concepts

This page explains the time-geography ideas used across the tools. If you
already know the theory, you can skip to [Getting Started](/guide/getting-started).

## The space-time path

A moving object can be drawn as a line through three dimensions:

- **X** — longitude
- **Y** — latitude
- **Z** — time

A GPS trajectory plotted this way becomes a **space-time path**. The path climbs
as time passes. Near-vertical segments usually mean the subject stayed in one
place. Long, shallow segments usually mean faster movement. The
[3D Trajectory](/tools/trajectory-3d) tool renders this path directly.

## Stations and stays

When a subject lingers in one place, the path forms a near-vertical **station**.
Detecting these **stay points** helps identify activity locations such as home,
work, a school, or a shop.

## The space-time prism

Given two timed anchor points, such as *"I was here at 9:00 and there at
10:00"*, a **space-time prism** describes where the subject could have gone in
between. The result depends on the time budget and the maximum travel speed.
Its 2D footprint on the ground is the **Potential Path Area (PPA)**.

The [Space-Time Prism](/tools/space-time-prism) tool computes this either on a
**road network** for realistic reachability, or as a grid-based approximation
where supported.

## Density in space and time

A single trajectory tells one story. Many points together can reveal broader
patterns. **Space-Time Kernel Density Estimation (STKDE)** smooths events into a
continuous 3D density volume, showing where **and when** activity concentrates.
The [STKDE tool](/tools/stkde) renders nested confidence surfaces for those
hotspots.

## The space-time cube

The **space-time cube** discretizes the study area into a grid of cells and
stacks those cells through time slices. Each cube represents one place during
one time interval.

Without an environmental layer, the cube counts how many trajectory points fall
inside each cell. With an environmental field, such as hourly noise or
pollution, each cube can show the mean exposure experienced there. See the
[Space-Time Cube tool](/tools/space-time-cube).

## Normalizing time across subjects

When subjects are tracked on different dates, their absolute timestamps do not
line up. **Align Start Times** re-bases each subject to elapsed time from their
own first observation, so everyone appears on a shared "Day 1 ... Day n" time
axis. This option appears in the 3D Trajectory, STKDE, and Space-Time Cube
tools.

# Core Concepts

A short primer on the time-geography ideas behind the tools. If you already know
the theory, skip to [Getting Started](/guide/getting-started).

## The space-time path

A moving object traces a continuous line through a three-dimensional space whose
axes are **two spatial dimensions and time**:

- **X** — longitude
- **Y** — latitude
- **Z** — time

A GPS trajectory, plotted this way, becomes a **space-time path** that climbs as
the day progresses. Vertical segments mean the subject stayed put; shallow,
stretched segments mean fast movement. This is exactly what the
[3D Trajectory](/tools/trajectory-3d) tool renders.

## Stations and stays

When a subject lingers in one place, the path becomes a near-vertical **station**.
Detecting these *stay points* (a cluster of points within a small radius over a
time window) reveals activity locations — home, work, a shop.

## The space-time prism

Given two timed anchor points — *"I was here at 9:00 and there at 10:00"* — the
**space-time prism** is the set of all locations the subject *could* have visited
in between, given a maximum travel speed. Its 2D shadow on the ground is the
**Potential Path Area (PPA)**.

The [Space-Time Prism](/tools/space-time-prism) tool computes this either on a
**road network** (realistic, network-constrained reachability) or as a grid/
ellipse approximation.

## Density in space and time

A single trajectory tells one story; many points together reveal *patterns*.
**Space-Time Kernel Density Estimation (STKDE)** smooths events into a continuous
3D density volume, exposing where **and when** activity concentrates. The
[STKDE tool](/tools/stkde) renders nested 90 / 95 / 99% confidence surfaces.

## The space-time cube

The **space-time cube** discretizes the study area into a grid of cells and
stacks those cells through time slices. Each cell-slice counts how many
trajectory points fell inside it. When you attach an **environmental field**
(e.g. an hourly noise grid), each cube can instead show the *mean exposure*
experienced there — and the trajectory itself is drawn through the stack, colored
by exposure. See the [Space-Time Cube tool](/tools/space-time-cube).

## Normalizing time across subjects

When comparing several subjects tracked over **different date ranges**, absolute
timestamps don't line up. The **"Align Start Times / Normalize Time"** option
re-bases each subject's events to *elapsed time from their own first observation*,
so everyone overlays on a shared "Day 1 … Day n" Z-axis. This option appears on
the 3D Trajectory, STKDE, and Space-Time Cube tools.

# Spatial-Temporal Data Toolbox

## Core Time-Geography Feature Specification

### Document status

Draft v1

### Purpose

Define only the core time-geography features for a spatial-temporal analytics toolbox. This document excludes utility, platform, and support features such as import workflows, export, general UI infrastructure, and implementation detail unless they are directly required by a time-geography function.

---

## 1. Product definition

The product is a time-geography analysis toolbox for representing, inspecting, and analyzing how entities move through space and time.

The toolbox centers on the core constructs of time geography:

* space-time path
* space-time cube
* time slice / temporal window
* stop / station / dwell segment
* co-presence and potential interaction
* accessibility and reachability
* space-time prism
* constraints on movement and activity

The system should allow users to reason about where an entity was, when it was there, what was reachable under temporal constraints, where multiple entities could have met, and how movement possibilities change across time.

---

## 2. Core time-geography entities

### 2.1 Space-time path

A space-time path represents the movement of an entity through geographic space over time.

Core feature requirements:

* display one or more entity paths as continuous trajectories across time
* represent time explicitly along the vertical axis in cube mode
* preserve temporal order along the path
* allow inspection of path segments by time interval
* distinguish movement segments from stationary segments

### 2.2 Space-time cube

A space-time cube is the primary analytical representation where x and y are spatial dimensions and z is time.

Core feature requirements:

* render one or more space-time paths in a 3D cube
* support direct inspection of temporal ordering, overlap, separation, and convergence
* allow users to inspect crossings, near-crossings, and vertically separated events
* support visual comparison of multiple entities in the same cube
* support temporal axis scaling and clear labeling of time intervals

### 2.3 Stations / stops / dwell segments

A station or stop is a period during which an entity remains within a limited spatial area for a non-trivial duration.

Core feature requirements:

* identify stationary or low-mobility intervals along a path
* represent dwell periods as analytically distinct segments
* show stop duration and location
* distinguish dwelling from transition movement
* support interpretation of repeated visits to the same location over time

### 2.4 Time slice and temporal window

A time slice is a cross-section of the cube at a specific time or over a bounded time interval.

Core feature requirements:

* define a single instant slice or a bounded time window
* show which entities, paths, stops, and interactions are active in the slice/window
* move sequentially through slices to inspect temporal evolution
* compare how spatial configuration changes across consecutive slices
* support narrow slices and broader windows for different analytical scales

### 2.5 Space-time bundle / repeated path structure

A bundle is a recurring or overlapping use of similar corridors, places, or timing patterns across one or more entities.

Core feature requirements:

* identify recurring path overlap or repeated occupation of similar corridors
* show where paths converge spatially and temporally
* distinguish exact co-presence from merely similar route structure
* support inspection of recurrent movement motifs over time

### 2.6 Co-presence and potential interaction

Potential interaction occurs when two or more entities are sufficiently close in both space and time for an encounter to be plausible.

Core feature requirements:

* identify overlapping space-time intervals between entities
* distinguish exact meeting, near meeting, and temporal miss
* represent candidate interactions as intervals or locations in the cube
* support pairwise and multi-entity inspection
* show interaction duration and relative proximity
* support interpretation of when paths crossed only in space, only in time, or in both

### 2.7 Accessibility and reachability

Accessibility describes where an entity could potentially reach from a given origin under time and movement constraints.

Core feature requirements:

* define an origin, departure time, and time budget
* represent reachable space for a selected entity or event
* distinguish observed movement from potential reachable area
* support direct comparison between actual path and reachable alternatives
* support constrained reachability based on travel assumptions or networks in later phases

### 2.8 Space-time prism

A space-time prism represents the set of possible locations reachable by an entity between anchor events given temporal constraints.

Core feature requirements:

* define anchor points or anchor events in time and space
* define temporal budget and movement constraints
* generate or display the feasible opportunity space between anchors
* represent prism footprint in geographic space
* represent prism volume or shell in cube space when available
* support prism inspection for one entity or multiple entities
* support comparison between actual path and prism envelope

### 2.9 Prism intersection

Prism intersection identifies shared feasible regions between entities, events, or opportunities.

Core feature requirements:

* compare two or more prisms
* identify overlapping feasible regions in space and time
* distinguish realized encounters from merely possible encounters
* support inspection of common reachable opportunity areas
* show how overlap changes under different time budgets or constraints

### 2.10 Constraints and anchors

Time geography depends on constraints that shape movement possibilities.

Core feature requirements:

* represent anchor events such as required departure, arrival, or attendance times
* represent authority, capability, or coupling constraints as parameters or scenario assumptions
* show how constraints alter path feasibility and prism extent
* allow scenario comparison where constraint values change

### 2.11 Space-time life path / daily path structure

A life path is a longer-form sequence of stations, movements, and constraints across a day or other sustained interval.

Core feature requirements:

* represent multi-stop daily or periodic movement structure
* show ordered transitions between stations
* support inspection of routine, deviation, and repeated daily pattern
* allow comparison between observed daily path and feasible alternatives

---

## 3. Core analytical features

### 3.1 Path inspection

Users should be able to examine how movement unfolded through time.

Required analytical behavior:

* inspect segment ordering
* inspect durations of movement and dwelling
* inspect transitions between stations
* identify gaps, bursts, and reversals in trajectory structure

### 3.2 Temporal cross-section analysis

Users should be able to inspect the system at a specific moment or over a bounded period.

Required analytical behavior:

* isolate active entities at time t
* inspect spatial arrangement at time t
* inspect how cross-sections differ over adjacent intervals
* examine which candidate interactions exist only within narrow windows

### 3.3 Encounter analysis

Users should be able to examine possible and realized encounters.

Required analytical behavior:

* identify realized co-presence
* identify near-miss cases where paths are spatially close but temporally offset
* identify near-miss cases where times overlap but spatial separation remains too large
* compare encounter plausibility under different thresholds or constraints

### 3.4 Reachability analysis

Users should be able to evaluate what was possible, not just what was observed.

Required analytical behavior:

* compute or display reachable area under a specified budget
* inspect change in reachable space over departure time changes
* compare observed path to reachable alternatives
* examine accessibility loss or gain under changed constraints

### 3.5 Prism analysis

Users should be able to reason about feasible opportunity space.

Required analytical behavior:

* construct or display prisms between fixed anchors
* compare prisms across entities or scenarios
* identify overlapping feasible spaces
* examine whether observed activities fall inside or outside the feasible prism

### 3.6 Bundle and routine analysis

Users should be able to inspect repeated structures in movement behavior.

Required analytical behavior:

* identify recurring corridors and station sequences
* distinguish routine structure from one-off movement
* show repeated temporal clustering around specific stations or routes

---

## 4. Feature priorities

### Must-have core set

* space-time path representation
* space-time cube representation
* stop / station / dwell representation
* time slice / temporal window analysis
* co-presence and potential interaction analysis
* accessibility / reachability representation
* space-time prism representation

### Important next layer

* prism intersection
* constraint-based scenario comparison
* life path / daily routine structure
* bundle / repeated path analysis

### Later advanced layer

* network-constrained prisms
* uncertainty-aware prisms and interactions
* virtual access-channel or non-physical coupling structures
* exact multi-entity prism overlap optimization

---

## 5. Core user questions the toolbox must answer

* Where was an entity at a specific time?
* How did its path unfold through time?
* Where did it stop, and for how long?
* Which entities were co-present or plausibly able to interact?
* Which apparent crossings are real encounters versus temporal misses?
* What places were reachable from a given anchor event under a time budget?
* What activities were feasible between two anchors?
* Where do two entities share feasible opportunity space even if they did not actually meet?
* How do movement possibilities change when constraints change?

---

## 6. MVP feature definition

The MVP should focus on the minimum time-geography feature set necessary to support genuine analytical use.

### MVP features

* represent and inspect space-time paths
* render a linked space-time cube
* identify and represent stops / stations / dwell segments
* inspect time slices and rolling temporal windows
* identify candidate co-presence and potential interaction
* represent reachable area from anchor events
* load or compute basic space-time prism representations
* compare actual paths against feasible prisms

### Not part of this document

The following are intentionally excluded here because they are not core time-geography features:

* import workflow design
* export workflows
* general settings and account features
* generic dashboard utilities
* non-analytical UI convenience functions
* implementation architecture unless directly needed by a core concept

---

## 7. Acceptance criteria for core features

### Space-time path

A user can inspect an entity’s ordered movement through time and distinguish movement from dwell intervals.

### Space-time cube

A user can view multiple entities in the same cube and visually inspect convergence, separation, crossing, and temporal offset.

### Stops / stations

A user can identify where an entity remained for a meaningful duration and inspect the duration and sequence of those stops.

### Time slice

A user can inspect a specific time slice or bounded time window and see which entities and locations are active during that interval.

### Co-presence / interaction

A user can determine whether two entities were plausibly co-present, truly co-present, or only appeared to cross without temporal overlap.

### Reachability

A user can define an origin and time budget and inspect the reachable space implied by those constraints.

### Prism

A user can inspect the feasible opportunity space between anchor events and compare that feasible region to an observed path.

### Prism intersection

A user can inspect whether multiple entities shared overlapping feasible opportunity space, regardless of whether an actual encounter occurred.

---

## 8. One-sentence feature definition

A time-geography toolbox for analyzing space-time paths, stations, slices, co-presence, accessibility, and prisms in order to understand observed movement and feasible opportunity space.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppSelector } from '@/stores/store';
import DeckGL from '@deck.gl/react';
import { LineLayer, PathLayer, PolygonLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import { Button } from './ui/button';
import { Box, X, Download, Play, Pause, Layers, Cone } from 'lucide-react';
import { resolveMapStyleProp, skyGradientClass } from '@/utils/map-styles';
import 'maplibre-gl/dist/maplibre-gl.css';

// The prism is stretched to fill this band of the maintained full height H,
// leaving 10% margins so anchor A sits at 10% and anchor B at 90%.
const A_FRAC = 0.1;
const B_FRAC = 0.9;

// Available activity time at a location — how long one can dwell there and still
// make the A→B trip (min/mid/max along the edge). Drives both color and tooltip.
type Activity = { min: number | null; mid: number | null; max: number | null };

// One road edge rendered as a continuous path at a single height (one time sheet).
type Path = {
  path: [number, number, number][];
  color: [number, number, number, number];
  activity: Activity;
};

// A reachable road edge with the travel times needed to place it in any slice.
type Edge = {
  coords: [number, number][];
  color: [number, number, number, number];
  da: number | null; // forward_sec — travel time A → edge
  db: number | null; // backward_sec — travel time edge → B
  tp: number;        // _time_progress fallback for edges lacking da/db
  activity: Activity; // available dwell time at this edge
};

type AnchorPt = {
  position: [number, number, number];
  color: [number, number, number, number];
  label: string;
  time: number;
};

interface PrismScene {
  edges: Edge[];
  T: number;        // total_budget_sec (0 if unknown)
  nSlices: number;  // number of time sheets between A and B
  fallbackEdges: number; // edges lacking forward/backward times → single-height fallback
  anchors: AnchorPt[];
  bbox: [number, number, number, number]; // w, s, e, n
  height: number; // H — the 3D trajectory's max height
  tA: number;
  tB: number;
}

/** Is edge `e` inside the prism cross-section at slice `i`? (forward ∩ backward cone) */
function edgeInSlice(e: Edge, i: number, T: number, nSlices: number): boolean {
  const frac = nSlices > 1 ? i / (nSlices - 1) : 1;
  const tau = frac * T;
  return e.da != null && e.db != null && T > 0
    ? e.da <= tau + 1e-6 && e.db <= T - tau + 1e-6
    : Math.round(e.tp * (nSlices - 1)) === i; // no travel times → nearest sheet
}

/**
 * Paths for one time sheet — the prism cross-section at elapsed time τ = frac·T,
 * drawn flat at that sheet's height. A road is in the cross-section when it lies
 * inside BOTH cones: the forward cone from A (d_A ≤ τ — reachable by then) and
 * the backward cone from B (d_B ≤ T − τ — can still arrive on time). Their
 * intersection is the PPA at that instant, so the prism tapers to A at the
 * bottom and to B at the top, widest in the middle. With sliceIdx === 'all'
 * every sheet is stacked (the full prism). Edges lacking travel times fall back
 * to the single sheet nearest their time-window midpoint.
 */
function slicePaths(scene: PrismScene, sliceIdx: number | 'all'): Path[] {
  const { edges, T, nSlices, height: H } = scene;
  const out: Path[] = [];
  const fracOf = (i: number) => (nSlices > 1 ? i / (nSlices - 1) : 1);
  const indices = sliceIdx === 'all'
    ? Array.from({ length: nSlices }, (_, i) => i)
    : [Math.max(0, Math.min(nSlices - 1, sliceIdx))];
  for (const e of edges) {
    const at = (z: number) => out.push({ path: e.coords.map(c => [c[0], c[1], z]), color: e.color, activity: e.activity });
    for (const i of indices) {
      if (edgeInSlice(e, i, T, nSlices)) at(remapZ(fracOf(i), H));
    }
  }
  return out;
}

/** Convex hull of 2D points (Andrew's monotone chain), CCW without repeated last point. */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const u: [number, number][] = [];
  for (const q of p) {
    const l = u[u.length - 1];
    if (!l || l[0] !== q[0] || l[1] !== q[1]) u.push(q);
  }
  if (u.length < 3) return [];
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of u) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = u.length - 1; i >= 0; i--) {
    const q = u[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// One translucent envelope disc — the convex hull of a slice's reachable roads.
type HullDisc = { slice: number; ring: [number, number, number][] };

/** Convex-hull envelope disc for every slice that has ≥3 reachable road points. */
function buildHulls(scene: PrismScene): HullDisc[] {
  const { edges, T, nSlices, height: H } = scene;
  const out: HullDisc[] = [];
  for (let i = 0; i < nSlices; i++) {
    const pts: [number, number][] = [];
    for (const e of edges) if (edgeInSlice(e, i, T, nSlices)) for (const c of e.coords) pts.push(c);
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const frac = nSlices > 1 ? i / (nSlices - 1) : 1;
    const z = remapZ(frac, H);
    out.push({ slice: i, ring: hull.map(p => [p[0], p[1], z]) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Continuous prism body — a lofted surface through the slice cross-sections
// ---------------------------------------------------------------------------

// Vertices per resampled cross-section ring (loft resolution around the body).
const SURFACE_RING_RES = 48;

// One triangle of the lofted prism surface, in [lng, lat, z] coordinates.
type SurfTri = { polygon: [number, number, number][] };

/**
 * Resample a convex ring to exactly `k` vertices by casting rays from its
 * centroid at uniform angles. Convexity guarantees one boundary hit per ray,
 * so every ring gets the same vertex count/ordering and consecutive rings can
 * be lofted vertex-to-vertex without twisting. Longitudes are pre-scaled by
 * cos(lat) so angles are measured in ground-metric proportions.
 */
function resampleConvexRing(
  hull: [number, number][], k: number, cosLat: number,
): [number, number][] | null {
  const pts = hull.map(([lon, lat]) => [lon * cosLat, lat] as [number, number]);
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;

  const out: [number, number][] = [];
  for (let j = 0; j < k; j++) {
    const th = (2 * Math.PI * j) / k;
    const dx = Math.cos(th), dy = Math.sin(th);
    let bestT = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const ex = x2 - x1, ey = y2 - y1;
      const denom = dx * ey - dy * ex;          // ray × edge
      if (Math.abs(denom) < 1e-18) continue;
      const t = ((x1 - cx) * ey - (y1 - cy) * ex) / denom;  // along the ray
      const u = ((x1 - cx) * dy - (y1 - cy) * dx) / denom;  // along the edge
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) bestT = Math.max(bestT, t);
    }
    if (bestT <= 0) return null; // degenerate ring
    out.push([(cx + bestT * dx) / cosLat, cy + bestT * dy]);
  }
  return out;
}

/**
 * The prism body as a closed, lofted triangle mesh: convex-hull cross-sections
 * are computed at a finer time resolution than the road sheets (a multiple of
 * the sheet count, so every sheet ring lies exactly on the surface), resampled
 * to a common vertex count, joined ring-to-ring with triangles, and capped
 * with fans tapering to the A and B apexes — the classic double-cone
 * space-time prism, here shaped by actual network reachability.
 */
function buildPrismSurface(scene: PrismScene): SurfTri[] {
  const { edges, T, nSlices, height: H, anchors, bbox } = scene;
  const nSurf = Math.max(4, 3 * (nSlices - 1) + 1);
  const cosLat = Math.max(0.1, Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180));

  const rings: { z: number; pts: [number, number][] }[] = [];
  for (let i = 0; i < nSurf; i++) {
    const pts: [number, number][] = [];
    for (const e of edges) if (edgeInSlice(e, i, T, nSurf)) for (const c of e.coords) pts.push(c);
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const ring = resampleConvexRing(hull, SURFACE_RING_RES, cosLat);
    if (!ring) continue;
    const frac = nSurf > 1 ? i / (nSurf - 1) : 1;
    rings.push({ z: remapZ(frac, H), pts: ring });
  }
  if (rings.length === 0) return [];

  // Apexes: the prism tapers to anchor A at the bottom and B at the top. When
  // an anchor is missing, fall back to the nearest ring's centroid.
  const centroid = (r: { pts: [number, number][] }): [number, number] => {
    let x = 0, y = 0;
    for (const p of r.pts) { x += p[0]; y += p[1]; }
    return [x / r.pts.length, y / r.pts.length];
  };
  const byZ = [...anchors].sort((a, b) => a.position[2] - b.position[2]);
  const bottom: [number, number, number] = byZ[0] && anchors.length === 2
    ? byZ[0].position
    : [...centroid(rings[0]), remapZ(0, H)] as [number, number, number];
  const top: [number, number, number] = byZ[1] && anchors.length === 2
    ? byZ[1].position
    : [...centroid(rings[rings.length - 1]), remapZ(1, H)] as [number, number, number];

  const tris: SurfTri[] = [];
  const k = SURFACE_RING_RES;
  const at = (r: { z: number; pts: [number, number][] }, j: number): [number, number, number] =>
    [r.pts[j % k][0], r.pts[j % k][1], r.z];

  for (let j = 0; j < k; j++) {
    tris.push({ polygon: [bottom, at(rings[0], j), at(rings[0], j + 1)] });
    const last = rings[rings.length - 1];
    tris.push({ polygon: [top, at(last, j + 1), at(last, j)] });
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let j = 0; j < k; j++) {
      tris.push({ polygon: [at(a, j), at(a, j + 1), at(b, j + 1)] });
      tris.push({ polygon: [at(a, j), at(b, j + 1), at(b, j)] });
    }
  }
  return tris;
}

const remapZ = (tp: number, H: number) => H * (A_FRAC + (B_FRAC - A_FRAC) * tp);

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

/** Max z found in a dataset (from the _height property or geometry Z). */
function maxZ(ds: { data: GeoJSON.FeatureCollection }): number {
  let m = 0;
  for (const f of ds.data.features) {
    const h = num(f.properties?._height);
    if (h != null) m = Math.max(m, h);
    const g = f.geometry;
    if (g?.type === 'LineString') for (const c of g.coordinates) { const z = num(c[2]); if (z != null) m = Math.max(m, z); }
    else if (g?.type === 'Point') { const z = num(g.coordinates[2]); if (z != null) m = Math.max(m, z); }
  }
  return m;
}

type DS = { id: string; label: string; data: GeoJSON.FeatureCollection };

/**
 * Build the focused scene: the start/end anchors and the 3D PPA road network,
 * rescaled so A sits at 10% and B at 90% of the 3D trajectory's max height.
 * Datasets are classified by id/label so trajectory points are never drawn as
 * anchors (they too carry _time_progress).
 */
function buildScene(datasets: Record<string, DS>, desiredSlices: number): PrismScene | null {
  const anchorDs: DS[] = [];
  const ppaDs: DS[] = [];
  const trajDs: DS[] = [];
  for (const ds of Object.values(datasets)) {
    const tag = `${ds.id} ${ds.label}`.toLowerCase();
    if (tag.includes('ground')) continue;            // flat shadow sibling — not shown
    if (tag.includes('anchor')) anchorDs.push(ds);
    else if (tag.includes('ppa') || tag.includes('road-network') || tag.includes('reachable')) ppaDs.push(ds);
    else trajDs.push(ds);                            // GPS trajectory + anything else → height reference only
  }

  // H = max z of the 3D trajectory; fall back to the prism's own heights.
  let H = Math.max(0, ...trajDs.map(maxZ));
  if (H <= 0) H = Math.max(0, ...ppaDs.map(maxZ));
  if (H <= 0) H = 1000;

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const grow = (lon: number, lat: number) => { w = Math.min(w, lon); s = Math.min(s, lat); e = Math.max(e, lon); n = Math.max(n, lat); };

  // Discrete space-time prism: N horizontal sheets between A and B. Each sheet is
  // the prism cross-section at elapsed time τ = frac·T — the intersection of the
  // forward cone from A and the backward cone from B (see slicePaths). Edges that
  // cannot lie on any A→B path within the budget (forward_sec + backward_sec > T)
  // are unreachable area and dropped here (the two-anchor constraint). The
  // slider/animation in the focused view isolates one sheet so the PPA at a
  // single time is legible.
  // Draw EVERY reachable edge — never subsample, or the network tears into a
  // sparse scatter (each backend edge is a single straight segment, so a dropped
  // edge is a visible gap). To bound the total work (edges × slices) we instead
  // reduce the number of slices for very large networks; the full edge set is
  // always present, so each sheet stays connected.
  const edgeFeats: GeoJSON.Feature[] = [];
  for (const ds of ppaDs) for (const f of ds.data.features) if (f.geometry?.type === 'LineString') edgeFeats.push(f);

  const edges: Edge[] = [];
  let T = 0;
  let fallbackEdges = 0;
  for (const f of edgeFeats) {
    const props = f.properties ?? {};
    const coords = (f.geometry as GeoJSON.LineString).coordinates;
    const rgba = props.color_rgba as number[] | undefined;
    const color: [number, number, number, number] = rgba && rgba.length >= 3
      ? [rgba[0], rgba[1], rgba[2], rgba[3] ?? 230]
      : [220, 90, 60, 230];
    for (const c of coords) grow(c[0], c[1]);

    const da = num(props.forward_sec);
    const db = num(props.backward_sec);
    const t = num(props.total_budget_sec);
    if (t != null && t > 0) T = t;
    // Two-anchor feasibility: skip edges that cannot lie on any A→B path within
    // the budget (unreachable area). Everything that remains is the prism corridor.
    if (da != null && db != null && t != null && t > 0 && da + db > t + 1e-6) continue;
    if (da == null || db == null || t == null || t <= 0) fallbackEdges++;
    edges.push({
      coords: coords.map(c => [c[0], c[1]]),
      color, da, db,
      tp: num(props._time_progress) ?? 0.5,
      activity: {
        min: num(props.activity_sec_min) ?? num(props.dwell_sec_min),
        mid: num(props.activity_sec_mid) ?? num(props.dwell_sec_mid),
        max: num(props.activity_sec_max) ?? num(props.dwell_sec_max),
      },
    });
  }

  // Honor the requested slice count. The two-cone filter keeps most edges out
  // of most slices, so bound by the ACTUAL rendered sheet count rather than the
  // edges × nSlices worst case — the old bound pinned this view at ≤10 slices
  // no matter what the user asked for.
  const MAX_RENDERED_PATHS = 300000;
  const inSheetCount = (n: number): number => {
    let count = 0;
    for (const e of edges) for (let i = 0; i < n; i++) if (edgeInSlice(e, i, T, n)) count++;
    return count;
  };
  let N_SLICES = Math.max(2, desiredSlices);
  while (N_SLICES > 2) {
    const c = inSheetCount(N_SLICES);
    if (c <= MAX_RENDERED_PATHS) break;
    const fit = Math.floor(N_SLICES * (MAX_RENDERED_PATHS / c));
    N_SLICES = Math.max(2, Math.min(N_SLICES - 1, fit));
  }
  if (N_SLICES < desiredSlices) {
    console.warn(
      `buildScene: clamped ${desiredSlices} → ${N_SLICES} prism slices to stay under ` +
      `${MAX_RENDERED_PATHS.toLocaleString()} rendered sheet paths (${edges.length.toLocaleString()} reachable edges).`,
    );
  }

  // Exactly the start (A, 10%) and end (B, 90%) anchors.
  let startA: AnchorPt | null = null;
  let endB: AnchorPt | null = null;
  for (const ds of anchorDs) {
    for (const f of ds.data.features) {
      if (f.geometry?.type !== 'Point') continue;
      const role = f.properties?.anchor_role as string | undefined;
      const tp = num(f.properties?._time_progress);
      const [lng, lat] = f.geometry.coordinates;
      const time = num(f.properties?._timestamp) ?? 0;
      const label = f.properties?.anchor_label as string | undefined;
      if (role === 'start_anchor' || tp === 0) {
        startA = { position: [lng, lat, remapZ(0, H)], color: [220, 50, 50, 255], label: label || 'A', time };
      } else if (role === 'end_anchor' || tp === 1) {
        endB = { position: [lng, lat, remapZ(1, H)], color: [50, 100, 220, 255], label: label || 'B', time };
      }
    }
  }
  const anchors = [startA, endB].filter(Boolean) as AnchorPt[];
  anchors.forEach(a => grow(a.position[0], a.position[1]));

  if (edges.length === 0 && anchors.length === 0) return null;
  if (!isFinite(w)) return null;

  return { edges, T, nSlices: N_SLICES, fallbackEdges, anchors, bbox: [w, s, e, n], height: H, tA: startA?.time || 0, tB: endB?.time || 0 };
}

function fmtTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Format a duration in seconds as "Hh Mm", "Mm", or "Ss". */
function fmtDur(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const PrismIllustration: React.FC = () => {
  const datasets = useAppSelector(s => s.map.datasets);
  const mapStyle = useAppSelector(s => s.map.mapStyle);
  const params = useAppSelector(s => s.prismExplorer.params);
  const desiredSlices = params.timeSlices;
  const explorerMode = useAppSelector(s => s.prismExplorer.mode);
  const [open, setOpen] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Time-slice control: `showAll` stacks every sheet (the full prism); otherwise
  // only `slice` is drawn. `playing` animates `slice` forward on a timer.
  // `showEnvelope` overlays the solid translucent prism body (a surface lofted
  // through the slice cross-sections, tapering to the anchors) plus contour
  // rings, so the classic double-cone shape reads at a glance.
  const [showAll, setShowAll] = useState(true);
  const [slice, setSlice] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showEnvelope, setShowEnvelope] = useState(true);

  const scene = useMemo(() => buildScene(datasets as any, desiredSlices), [datasets, desiredSlices]);
  const hulls = useMemo(() => (scene ? buildHulls(scene) : []), [scene]);
  const surface = useMemo(() => (scene ? buildPrismSurface(scene) : []), [scene]);
  const nSlices = scene?.nSlices ?? 1;
  const activeSlice = Math.min(slice, nSlices - 1);

  // Close the focused view when the prism is re-run. The open dialog renders a
  // scene snapshot; on recompute the old layers are torn down and rebuilt, so
  // leaving it open would show stale geometry mid-rebuild.
  useEffect(() => {
    if (explorerMode === 'computing') setOpen(false);
  }, [explorerMode]);

  // Measure the overlay canvas. We only render DeckGL once we have real
  // dimensions, so a re-open never initialises the WebGL canvas at 0×0 (which
  // left it blank). Re-runs on each open via mountKey.
  useEffect(() => {
    if (!open) { setSize({ width: 0, height: 0 }); return; }
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [open, mountKey]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Advance the active slice while playing, looping A→B→A.
  useEffect(() => {
    if (!playing || !open) return;
    const id = setInterval(() => setSlice(s => (s + 1) % nSlices), 650);
    return () => clearInterval(id);
  }, [playing, open, nSlices]);

  const openView = () => {
    setMountKey(k => k + 1);
    setShowAll(true);
    setPlaying(false);
    setSlice(0);
    setOpen(true);
  };

  // Slider / play controls all imply single-slice mode.
  const gotoSlice = (i: number) => { setShowAll(false); setSlice(i); };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    setShowAll(false);
    if (activeSlice >= nSlices - 1) setSlice(0); // restart from A if parked at B
    setPlaying(true);
  };

  const handleExport = () => {
    if (!scene) return;

    // The space-time prism setting shared by every exported PPA — the
    // parameters that define this prism plus the derived time budget. Repeated
    // on each feature so a single polygon is self-describing in a GIS attribute
    // table (top-level GeoJSON members get dropped by most readers). Omit the
    // speed knobs that only apply to a mode the user isn't in.
    const T = scene.T; // total_budget_sec (0 if unknown)
    const setting: Record<string, unknown> = {
      prism_mode: params.prismMode,
      speed_mode: params.speedMode,
      ...(params.speedMode === 'custom' ? { custom_speed_kmh: params.customSpeed } : {}),
      speed_adjustment: params.speedAdjustment,
      ...(params.speedAdjustment === 'manual' ? { speed_factor: params.speedFactor } : {}),
      min_activity_min: params.minActivityMinutes,
      slice_count: nSlices,
      ...(T > 0 ? { total_budget_sec: T, total_budget_min: Math.round(T / 60) } : {}),
      ...(scene.tA ? { anchor_a_time_iso: new Date(scene.tA).toISOString() } : {}),
      ...(scene.tB ? { anchor_b_time_iso: new Date(scene.tB).toISOString() } : {}),
    };

    // Convex hull of the PPA per time slice — the reachable-road envelope at
    // each cross-section. Always export every slice (one polygon per slice),
    // independent of which slice the view is currently isolating, so the file
    // covers the whole prism. Geometry is flat 2D WGS84 (the render-only height
    // is dropped); the slice's time lives in the attributes instead.
    const features: GeoJSON.Feature[] = hulls.map(({ slice, ring }) => {
      const frac = nSlices > 1 ? slice / (nSlices - 1) : 1;
      const ring2d = ring.map(([lng, lat]) => [lng, lat] as [number, number]);
      const clockMs = scene.tA && scene.tB ? scene.tA + frac * (scene.tB - scene.tA) : 0;
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...ring2d, ring2d[0]]] },
        properties: {
          kind: 'ppa-convex-hull',
          // The time slice this PPA belongs to.
          slice_index: slice,        // 0-based
          slice_number: slice + 1,   // 1-based, for humans
          time_fraction: Number(frac.toFixed(4)),
          ...(T > 0 ? { elapsed_sec: Math.round(frac * T), elapsed_min: Math.round((frac * T) / 60) } : {}),
          ...(clockMs ? { slice_time_iso: new Date(clockMs).toISOString() } : {}),
          ...setting,
        },
      };
    });

    const fc = {
      type: 'FeatureCollection',
      name: 'focused-prism-ppa',
      tool: 'space-time-prism',
      exported_at: new Date().toISOString(),
      features,
    };
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `focused-prism-ppa-${date}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const initialViewState = useMemo(() => {
    // maxPitch 85 lifts deck.gl's 60° default; 85 is MapLibre's hard ceiling.
    if (!scene) return { longitude: 0, latitude: 0, zoom: 11, pitch: 55, bearing: -20, maxPitch: 85 };
    const [w, s, e, n] = scene.bbox;
    const maxSpan = Math.max(e - w, n - s, 0.001);
    const zoom = Math.min(16, Math.max(9, Math.floor(Math.log2(360 / maxSpan)) - 1));
    return { longitude: (w + e) / 2, latitude: (s + n) / 2, zoom, pitch: 55, bearing: -20, maxPitch: 85 };
  }, [scene]);

  const layers = useMemo(() => {
    if (!scene) return [];
    const { anchors, bbox, height: H, tA, tB } = scene;
    const paths = slicePaths(scene, showAll ? 'all' : activeSlice);
    const out: any[] = [];

    // Prism body: a continuous lofted surface through the slice cross-sections,
    // tapering to the anchors — the solid double-cone shape of the space-time
    // prism, shaped by actual network reachability. Drawn translucent beneath
    // the roads so the network inside stays fully visible; depth writes are off
    // so its own triangles never occlude each other. Dimmer in single-slice
    // mode, where the emphasised cross-section disc carries the focus.
    if (showEnvelope && surface.length > 0) {
      out.push(new SolidPolygonLayer({
        id: 'illus-prism-body',
        data: surface,
        getPolygon: (d: SurfTri) => d.polygon,
        getFillColor: showAll ? [70, 130, 220, 40] : [70, 130, 220, 18],
        filled: true, extruded: false, _full3d: true, pickable: false,
        parameters: { depthWriteEnabled: false },
        updateTriggers: { getFillColor: [showAll] },
      }));
    }

    // Slice cross-sections: contour rings on the prism body (every sheet), and
    // in single-slice mode a filled disc emphasising the active cross-section.
    if (showEnvelope && hulls.length > 0) {
      if (!showAll) {
        out.push(new PolygonLayer({
          id: 'illus-envelope-fill',
          data: hulls.filter(h => h.slice === activeSlice),
          getPolygon: (d: HullDisc) => d.ring,
          filled: true, getFillColor: [70, 130, 220, 45],
          stroked: false, extruded: false, pickable: false,
          parameters: { depthWriteEnabled: false },
        }));
      }
      out.push(new PathLayer({
        id: 'illus-envelope-rings',
        data: hulls,
        getPath: (d: HullDisc) => [...d.ring, d.ring[0]],
        getColor: (d: HullDisc) => !showAll && d.slice === activeSlice
          ? [40, 90, 200, 220]
          : [70, 130, 220, 110],
        getWidth: (d: HullDisc) => (!showAll && d.slice === activeSlice ? 2.5 : 1.2),
        widthUnits: 'pixels', pickable: false,
        updateTriggers: { getColor: [showAll, activeSlice], getWidth: [showAll, activeSlice] },
      }));
    }

    // The height-stretched 3D road network (start anchor → end anchor). PathLayer
    // keeps each edge a single connected polyline at its sheet height, so adjacent
    // edges read as one continuous network rather than detached segments.
    out.push(new PathLayer({
      id: 'illus-prism', data: paths,
      getPath: (d: Path) => d.path,
      getColor: (d: Path) => d.color, getWidth: 2.5, widthUnits: 'pixels',
      capRounded: true, jointRounded: true,
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 120],
    }));

    // Anchor stems + heads + labels.
    out.push(new LineLayer({
      id: 'illus-anchor-stems', data: anchors,
      getSourcePosition: (d: AnchorPt) => [d.position[0], d.position[1], 0],
      getTargetPosition: (d: AnchorPt) => d.position,
      getColor: (d: AnchorPt) => [d.color[0], d.color[1], d.color[2], 150],
      getWidth: 2, widthUnits: 'pixels', pickable: false, parameters: { depthTest: false },
    }));
    out.push(new ScatterplotLayer({
      id: 'illus-anchor-heads', data: anchors,
      getPosition: (d: AnchorPt) => d.position, getFillColor: (d: AnchorPt) => d.color,
      getLineColor: [255, 255, 255, 255], stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2,
      getRadius: 10, radiusUnits: 'pixels', pickable: false, parameters: { depthTest: false },
    }));
    out.push(new TextLayer({
      id: 'illus-anchor-labels', data: anchors,
      getPosition: (d: AnchorPt) => d.position,
      getText: (d: AnchorPt) => `${d.label}${d.time ? `  ${fmtTime(d.time)}` : ''}`,
      getSize: 14, getColor: (d: AnchorPt) => d.color, getPixelOffset: [12, -12],
      getTextAnchor: 'start', getAlignmentBaseline: 'center', billboard: true,
      fontWeight: 700, parameters: { depthTest: false },
    }));

    // Vertical time axis at the SW corner: full height with ticks at the prism
    // band (10%→A, 90%→B) and interpolated clock times in between.
    const [w, s] = bbox;
    const axis = [{ source: [w, s, 0] as [number, number, number], target: [w, s, H] as [number, number, number], color: [120, 120, 120, 160] as [number, number, number, number] }];
    out.push(new LineLayer({
      id: 'illus-axis', data: axis,
      getSourcePosition: (d: any) => d.source, getTargetPosition: (d: any) => d.target,
      getColor: (d: any) => d.color, getWidth: 1.5, widthUnits: 'pixels', pickable: false,
    }));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(frac => ({
      position: [w, s, remapZ(frac, H)] as [number, number, number],
      text: tA && tB ? fmtTime(tA + frac * (tB - tA)) : `${Math.round(frac * 100)}%`,
    }));
    out.push(new TextLayer({
      id: 'illus-axis-ticks', data: ticks,
      getPosition: (d: any) => d.position, getText: (d: any) => d.text,
      getSize: 11, getColor: [80, 80, 80], getPixelOffset: [-10, 0],
      getTextAnchor: 'end', getAlignmentBaseline: 'center', billboard: true,
      parameters: { depthTest: false },
    }));

    return out;
  }, [scene, hulls, surface, showAll, activeSlice, showEnvelope]);

  if (!scene) return null; // no prism on the map → nothing to illustrate

  const ready = open && size.width > 0 && size.height > 0;

  const frac = nSlices > 1 ? activeSlice / (nSlices - 1) : 1;
  const sliceClock = scene.tA && scene.tB
    ? fmtTime(scene.tA + frac * (scene.tB - scene.tA))
    : `${Math.round(frac * 100)}%`;
  const elapsedMin = scene.T > 0 ? Math.round((frac * scene.T) / 60) : null;

  // Hover a road to read the activity (dwell) time available at that location.
  const getTooltip = ({ object }: { object?: Path | null }) => {
    const a = object?.activity;
    const primary = a?.mid ?? a?.max ?? a?.min;
    if (primary == null) return null;
    const range = a?.min != null && a?.max != null && a.max - a.min > 1
      ? ` (${fmtDur(a.min)}–${fmtDur(a.max)})`
      : '';
    return {
      html: `<div style="font-weight:600;margin-bottom:2px">Activity time</div><div>${fmtDur(primary)}${range}</div>`,
      style: {
        backgroundColor: 'rgba(17,24,39,0.92)', color: '#fff',
        fontSize: '12px', padding: '6px 8px', borderRadius: '6px',
      },
    };
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="absolute bottom-20 left-4 z-10 bg-white/95 shadow-lg gap-2"
        onClick={openView}
        title="Open a height-rescaled 3D view of the prism"
      >
        <Box className="w-4 h-4" />
        Focused 3D View
      </Button>

      {open && (
        <div className="absolute inset-0 z-30 flex flex-col bg-gray-900">
          <div className="px-5 py-3 border-b bg-white flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Focused 3D Prism View</h2>
              <p className="text-xs text-gray-500 max-w-3xl">
                The prism shows everywhere you could be between anchor A (bottom) and B (top). Height is
                time: each slice is where you could reach at that moment and still make it to B. Use the
                timeline below to step through the slices or press play to animate.
              </p>
              {scene.fallbackEdges > 0 && (
                <p className="text-xs font-medium text-amber-600 max-w-3xl mt-1">
                  ⚠ {scene.fallbackEdges} of {scene.edges.length} roads are missing forward/backward
                  travel times, so they are drawn at a single height instead of true cone slices —
                  this makes the prism look like a forward cone only. Re-run the Space-Time Prism
                  tool (with the current backend) to regenerate them.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
                <Download className="w-4 h-4" />
                Export GeoJSON
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(false)}>
                <X className="w-4 h-4" />
                Close
              </Button>
            </div>
          </div>
          {/* Sky backdrop — shows through the transparent above-horizon region
              at high pitch (the basemap paints no sky). Follows the map style. */}
          <div ref={containerRef} className={`relative flex-1 ${skyGradientClass(mapStyle)}`}>
            {ready && (
              <DeckGL
                key={mountKey}
                width={size.width}
                height={size.height}
                initialViewState={initialViewState}
                controller={{ dragRotate: true }}
                layers={layers}
                getTooltip={getTooltip}
              >
                <Map mapStyle={resolveMapStyleProp(mapStyle)} style={{ width: size.width, height: size.height }} maxPitch={85} />
              </DeckGL>
            )}

            {ready && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-lg bg-white/95 px-4 py-2 shadow-lg">
                <Button variant="outline" size="sm" className="gap-1.5 w-[5.5rem]" onClick={togglePlay}>
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {playing ? 'Pause' : 'Play'}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, nSlices - 1)}
                  step={1}
                  value={activeSlice}
                  onChange={e => gotoSlice(Number(e.target.value))}
                  className="w-56 accent-blue-600 cursor-pointer"
                  aria-label="Time slice"
                />
                <div className="text-xs text-gray-700 tabular-nums whitespace-nowrap min-w-[9rem]">
                  {showAll
                    ? `All ${nSlices} slices`
                    : `Slice ${activeSlice + 1}/${nSlices} · ${sliceClock}${elapsedMin != null ? ` · +${elapsedMin}m` : ''}`}
                </div>
                <Button
                  variant={showAll ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { setPlaying(false); setShowAll(true); }}
                  title="Stack every slice (the full prism)"
                >
                  <Layers className="w-4 h-4" />
                  All
                </Button>
                <Button
                  variant={showEnvelope ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowEnvelope(v => !v)}
                  title="Translucent solid prism body (lofted through the slice cross-sections)"
                >
                  <Cone className="w-4 h-4" />
                  Shape
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default PrismIllustration;

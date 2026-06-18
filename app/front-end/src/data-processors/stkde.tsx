import { PROCESSED_HEIGHT_FIELD, PROCESSED_TIME_FIELD } from '@/utils/constants';
import { ToolUtils } from '@/tools/tool-utils';
import * as tf from '@tensorflow/tfjs';
import * as turf from '@turf/turf';

export const STKDE_Z_AXIS_FIELD = 'z_axis';

// Auto-detected grids cap at 50x50 cells; an explicit user cell size is
// honored up to a larger safety cap. The kernel loop batches points so the
// broadcasted [batch, rows, cols] tensors never exceed MAX_BROADCAST_ELEMENTS
// elements, keeping memory bounded for fine grids.
const MAX_GRID_CELLS = 2500;
const MAX_USER_GRID_CELLS = 62500; // 250x250
const MAX_BROADCAST_ELEMENTS = 4_194_304; // ~16 MB float32 per tensor

// Metres per degree of latitude — used to convert the user-facing cell size
// (metres) to the grid's internal lon/lat degrees and back.
export const METERS_PER_DEGREE_LAT = 111320;

export interface STKDEResult {
  density: number[][][] | number[][];  // 3D if multiple time slices; 2D if single
  x_centers: number[];
  y_centers: number[];
  time_values: Date[];
  cell_size: number;
  // True when per-user time alignment was applied (time measured as elapsed from
  // each user's own start). When true, time_values represent elapsed time.
  align: boolean;
}

/**
 * Compute space–time kernel density estimation (STKDE) using TensorFlow.js tensors
 * for all internal array computations.
 *
 * @param gdf - GeoJSON FeatureCollection of Points.
 * @param timeCol - Name of the timestamp property.
 * @param spatial_bandwidth - Spatial bandwidth (if undefined, estimated from data).
 * @param temporal_bandwidth - Temporal bandwidth in seconds (if undefined, estimated from data).
 * @param cell_size - Grid cell size (if undefined, a default is computed).
 * @param n_time_slices - Number of time slices for density estimation.
 *
 * @returns A Promise resolving to an object with the density grid, grid centers, time slice centers, and cell size.
 */
export async function tf_stkde(
  gdf: GeoJSON.FeatureCollection<GeoJSON.Point, any>,
  timeCol: string = 'timestamp',
  spatial_bandwidth?: number,
  temporal_bandwidth?: number,
  cell_size?: number,
  n_time_slices: number = 10,
  opts?: { userField?: string; align?: boolean }
): Promise<STKDEResult> {

  // --- Data Extraction ---
  const features = gdf.features;
  const n = features.length;
  if (n === 0) {
    throw new Error("GeoDataFrame is empty.");
  }
  features.forEach(feature => {
    if (feature.geometry.type !== "Point") {
      throw new Error("Geometry must consist of Points only.");
    }
  });

  // Extract coordinates and timestamps into plain arrays.
  const x_vals: number[] = [];
  const y_vals: number[] = [];
  const rawTimes: number[] = []; // timestamps in milliseconds
  for (const feat of features) {
    const coords = feat.geometry.coordinates as number[];
    x_vals.push(coords[0]);
    y_vals.push(coords[1]);
    rawTimes.push(new Date(feat.properties[timeCol]).getTime());
  }
  // Determine the minimum timestamp.
  const t_min_val = Math.min(...rawTimes);

  // Optional per-user time alignment ("normalize time"): measure each event as
  // elapsed time from its own user's first observation so users tracked over
  // different date ranges overlap on a shared elapsed timeline. Only active when
  // a user field is provided and more than one distinct user is present.
  const userField = opts?.userField;
  const userStart = new Map<string, number>();
  const users: string[] = [];
  let align = false;
  if (opts?.align && userField) {
    for (const feat of features) {
      users.push(String(feat.properties?.[userField] ?? 'unknown'));
    }
    for (let i = 0; i < n; i++) {
      const u = users[i];
      const cur = userStart.get(u);
      if (cur === undefined || rawTimes[i] < cur) userStart.set(u, rawTimes[i]);
    }
    align = userStart.size > 1;
  }

  // Convert raw times into seconds offset: from each user's own start when
  // aligning, otherwise from the global minimum time.
  const time_vals: number[] = align
    ? rawTimes.map((t, i) => (t - (userStart.get(users[i]) as number)) / 1000)
    : rawTimes.map(t => (t - t_min_val) / 1000);

  // --- Convert Data to Tensors ---
  const tfX = tf.tensor1d(x_vals);
  const tfY = tf.tensor1d(y_vals);
  const tfT = tf.tensor1d(time_vals);

  // --- Bandwidth Estimation Using TensorFlow.js Operations ---
  if (spatial_bandwidth === undefined) {
    const mean_x = tf.mean(tfX);
    const mean_y = tf.mean(tfY);
    const dx = tf.sub(tfX, mean_x);
    const dy = tf.sub(tfY, mean_y);
    const distances = tf.sqrt(tf.add(tf.square(dx), tf.square(dy))) as tf.Tensor1D;
    const SD = tf.sqrt(tf.mean(tf.add(tf.square(dx), tf.square(dy))));
    const Dm = await medianTensor(distances);
    const SD_val = SD.arraySync() as number;
    const Dm_val = Dm.arraySync() as number;
    const robust_sigma = (Dm_val > 0 ? Dm_val / 0.6745 : SD_val);
    const h_xy = (SD_val === 0 && Dm_val === 0) ? 0 : 0.9 * Math.min(SD_val, robust_sigma) * Math.pow(n, -1 / 6);
    spatial_bandwidth = h_xy;

    mean_x.dispose(); mean_y.dispose();
    dx.dispose(); dy.dispose(); distances.dispose(); SD.dispose(); Dm.dispose();
  }
  if (temporal_bandwidth === undefined) {
    const sigma_t = stdTensor(tfT);
    const q25 = await percentileTensor(tfT, 25);
    const q75 = await percentileTensor(tfT, 75);
    const iqr_t = q75.sub(q25);
    const sigma_t_val = sigma_t.arraySync() as number;
    const iqr_t_val = iqr_t.arraySync() as number;
    const robust_t = (iqr_t_val > 0 ? iqr_t_val / 1.34 : sigma_t_val);
    const H = (sigma_t_val === 0 && iqr_t_val === 0) ? 0 : 0.9 * Math.min(sigma_t_val, robust_t) * Math.pow(n, -1 / 5);
    temporal_bandwidth = H;

    sigma_t.dispose(); q25.dispose(); q75.dispose(); iqr_t.dispose();
  }
  if (spatial_bandwidth <= 0) spatial_bandwidth = 1e-9;
  if (temporal_bandwidth <= 0) temporal_bandwidth = 1e-9;

  // --- Grid Definition (Spatial) ---
  // Use Turf.js to compute the bounding box.
  const bbox = turf.bbox(gdf); // [minX, minY, maxX, maxY]
  let x_min = bbox[0] - spatial_bandwidth;
  let y_min = bbox[1] - spatial_bandwidth;
  let x_max = bbox[2] + spatial_bandwidth;
  let y_max = bbox[3] + spatial_bandwidth;
  const userCellSize = cell_size !== undefined;
  if (cell_size === undefined) {
    const dx_extent = x_max - x_min;
    const dy_extent = y_max - y_min;
    // 50 is the number of cells in the grid
    cell_size = Math.min(dx_extent, dy_extent) / 50;
    if (cell_size <= 0) cell_size = 1.0;
  }

  // Cells must be square on the ground (equal metres N-S and E-W), not equal
  // degrees: one degree of longitude is cos(latitude) times shorter than one
  // degree of latitude, so equal-degree cells render as rectangles away from
  // the equator. Widen the longitude step by 1/cos(lat) to compensate.
  const cosLat = Math.max(Math.cos(((y_min + y_max) / 2) * Math.PI / 180), 0.01);
  let cell_size_y = cell_size;
  let cell_size_x = cell_size / cosLat;

  let n_cols = Math.ceil((x_max - x_min) / cell_size_x);
  let n_rows = Math.ceil((y_max - y_min) / cell_size_y);

  // Limit grid size: auto-detected grids stay at the conservative 50x50
  // default, while an explicit user cell size is honored up to a larger
  // safety cap (the kernel loop batches points, so memory stays bounded
  // either way). A uniform downscale preserves n_cols/n_rows, so recomputing
  // each step from the bounds keeps the square-in-metres aspect ratio.
  const maxCells = userCellSize ? MAX_USER_GRID_CELLS : MAX_GRID_CELLS;
  const totalCells = n_cols * n_rows;
  if (totalCells > maxCells) {
    console.warn(`Grid size ${n_cols}x${n_rows} (${totalCells} cells) exceeds the ${maxCells}-cell limit. Coarsening the grid.`);
    const scaleFactor = Math.sqrt(maxCells / totalCells);
    n_cols = Math.floor(n_cols * scaleFactor);
    n_rows = Math.floor(n_rows * scaleFactor);
    cell_size_x = (x_max - x_min) / n_cols;
    cell_size_y = (y_max - y_min) / n_rows;
  }

  x_max = x_min + n_cols * cell_size_x;
  y_max = y_min + n_rows * cell_size_y;
  // Returned/base cell size tracks the latitude (N-S) extent.
  cell_size = cell_size_y;

  // Compute grid cell center coordinates using TensorFlow.js (replace for-loop with tensor operations).
  const colIndices = tf.range(0, n_cols, 1, 'float32');
  const x_min_scalar = tf.scalar(x_min + 0.5 * cell_size_x);
  const x_centers_tensor = tf.add(x_min_scalar, tf.mul(colIndices, cell_size_x));
  const x_centers = x_centers_tensor.arraySync() as number[];
  colIndices.dispose();
  x_min_scalar.dispose();
  x_centers_tensor.dispose();

  const rowIndices = tf.range(0, n_rows, 1, 'float32');
  const y_min_scalar = tf.scalar(y_min + 0.5 * cell_size_y);
  const y_centers_tensor = tf.add(y_min_scalar, tf.mul(rowIndices, cell_size_y));
  const y_centers = y_centers_tensor.arraySync() as number[];
  rowIndices.dispose();
  y_min_scalar.dispose();
  y_centers_tensor.dispose();

  // --- Time Slices Definition ---
  let time_centers: number[];
  if (n_time_slices <= 1) {
    const mean_t = tf.mean(tfT).arraySync() as number;
    time_centers = [mean_t];
    n_time_slices = 1;
  } else {
    const t_min_val_tensor = tf.min(tfT).arraySync() as number;
    const t_max_val_tensor = tf.max(tfT).arraySync() as number;
    time_centers = tf.linspace(t_min_val_tensor, t_max_val_tensor, n_time_slices).arraySync() as number[];
  }

  // --- Kernel Density Computation Using Vectorized TF Operations ---
  const const_spatial = 3.0 / (Math.PI * spatial_bandwidth * spatial_bandwidth);
  const const_time = 15.0 / (16.0 * temporal_bandwidth);

  // Build grid meshes from x_centers and y_centers.
  const tfXCenters = tf.tensor1d(x_centers);
  const tfYCenters = tf.tensor1d(y_centers);
  const Xgrid = tf.tile(tfXCenters.reshape([1, n_cols]), [n_rows, 1]);
  const Ygrid = tf.tile(tfYCenters.reshape([n_rows, 1]), [1, n_cols]);

  // Points are processed in fixed-size batches: the broadcasted tensors below
  // have shape [batch, n_rows, n_cols], so batching keeps peak memory bounded
  // instead of scaling with n_points * n_cells (which fine user-specified
  // grids would otherwise blow past).
  const pointBatch = Math.max(1, Math.floor(MAX_BROADCAST_ELEMENTS / (n_rows * n_cols)));
  const Xgrid_exp = Xgrid.reshape([1, n_rows, n_cols]); // [1, n_rows, n_cols]
  const Ygrid_exp = Ygrid.reshape([1, n_rows, n_cols]); // [1, n_rows, n_cols]
  const one = tf.scalar(1.0);

  const densityTimeSlices: number[][][] = [];
  for (let t_idx = 0; t_idx < time_centers.length; t_idx++) {
    const t_center = time_centers[t_idx];
    // Temporal kernel: compute absolute differences and scale.
    const dt = tf.abs(tf.sub(tfT, t_center));
    const t_u = tf.div(dt, temporal_bandwidth);
    const mask = tf.lessEqual(dt, temporal_bandwidth);
    const t_weight_all = tf.mul(const_time, tf.pow(tf.sub(one, tf.pow(t_u, 2)), 2));
    const t_weight = tf.where(mask, t_weight_all, tf.zerosLike(t_weight_all));

    let densityAcc = tf.zeros([n_rows, n_cols]);
    for (let start = 0; start < n; start += pointBatch) {
      const len = Math.min(pointBatch, n - start);
      const xBatch = tfX.slice(start, len).reshape([len, 1, 1]);   // [len, 1, 1]
      const yBatch = tfY.slice(start, len).reshape([len, 1, 1]);   // [len, 1, 1]
      const wBatch = t_weight.slice(start, len).reshape([len, 1, 1]);

      // Spatial kernel: differences between the batch points and every grid cell.
      const diffX = tf.sub(Xgrid_exp, xBatch);
      const diffY = tf.sub(Ygrid_exp, yBatch);
      const dist2 = tf.add(tf.square(diffX), tf.square(diffY));
      const spatial_mask = tf.lessEqual(dist2, spatial_bandwidth * spatial_bandwidth);
      const spatial_u = tf.div(dist2, spatial_bandwidth * spatial_bandwidth);
      const spatial_kernel_all = tf.mul(const_spatial, tf.pow(tf.sub(one, spatial_u), 2));
      const spatial_kernel = tf.where(spatial_mask, spatial_kernel_all, tf.zerosLike(spatial_kernel_all));

      // Multiply each point's spatial kernel by its temporal weight and sum over points.
      const contribution = tf.mul(wBatch, spatial_kernel);
      const partial = contribution.sum(0); // [n_rows, n_cols]
      const nextAcc = tf.add(densityAcc, partial);

      // Dispose temporary tensors for this batch.
      xBatch.dispose();
      yBatch.dispose();
      wBatch.dispose();
      diffX.dispose();
      diffY.dispose();
      dist2.dispose();
      spatial_mask.dispose();
      spatial_u.dispose();
      spatial_kernel_all.dispose();
      spatial_kernel.dispose();
      contribution.dispose();
      partial.dispose();
      densityAcc.dispose();
      densityAcc = nextAcc;
    }

    const density_slice_array = await densityAcc.array() as number[][];
    densityTimeSlices.push(density_slice_array);

    // Dispose temporary tensors for this time slice.
    dt.dispose();
    t_u.dispose();
    mask.dispose();
    t_weight_all.dispose();
    t_weight.dispose();
    densityAcc.dispose();
  }
  one.dispose();
  Xgrid_exp.dispose();
  Ygrid_exp.dispose();

  // Dispose remaining tensors.
  tfX.dispose();
  tfY.dispose();
  tfT.dispose();
  tfXCenters.dispose();
  tfYCenters.dispose();
  Xgrid.dispose();
  Ygrid.dispose();

  // Force garbage collection of WebGL resources
  if (typeof window !== 'undefined' && (window as any).gc) {
    (window as any).gc();
  }

  const density: number[][][] | number[][] = (n_time_slices > 1)
    ? densityTimeSlices
    : densityTimeSlices[0];
  // Convert time slice centers back to Date objects. When aligning, the centers
  // are elapsed seconds, so the resulting Date.getTime() equals elapsed ms.
  const time_values: Date[] = align
    ? time_centers.map(tc => new Date(tc * 1000))
    : time_centers.map(tc => new Date(t_min_val + tc * 1000));

  return { density, x_centers, y_centers, time_values, cell_size, align };
}

/**
 * Estimate the grid cell size (in metres) that tf_stkde's auto-detection would
 * pick for a dataset, without running the density computation. Mirrors the
 * bandwidth estimation and grid definition in tf_stkde (bandwidth padding,
 * min-extent/50 default, square-in-metres widening, MAX_GRID_CELLS clamp) —
 * keep the two in sync. Returns null when no estimate can be made.
 */
export function estimateAutoCellSizeMeters(gdf: GeoJSON.FeatureCollection): number | null {
  const points = gdf.features.filter(f => f.geometry?.type === 'Point');
  const n = points.length;
  if (n === 0) return null;

  const x_vals = points.map(f => (f.geometry as GeoJSON.Point).coordinates[0]);
  const y_vals = points.map(f => (f.geometry as GeoJSON.Point).coordinates[1]);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) {
    const x = x_vals[i], y = y_vals[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    sumX += x;
    sumY += y;
  }

  // Robust spatial bandwidth — same estimator as tf_stkde.
  const meanX = sumX / n, meanY = sumY / n;
  let sumSq = 0;
  const distances = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const dx = x_vals[i] - meanX, dy = y_vals[i] - meanY;
    const d2 = dx * dx + dy * dy;
    sumSq += d2;
    distances[i] = Math.sqrt(d2);
  }
  const sd = Math.sqrt(sumSq / n);
  distances.sort((a, b) => a - b);
  const dm = n % 2 === 0 ? (distances[n / 2 - 1] + distances[n / 2]) / 2 : distances[Math.floor(n / 2)];
  const robustSigma = dm > 0 ? dm / 0.6745 : sd;
  let bandwidth = (sd === 0 && dm === 0) ? 0 : 0.9 * Math.min(sd, robustSigma) * Math.pow(n, -1 / 6);
  if (bandwidth <= 0) bandwidth = 1e-9;

  // Grid definition — bbox padded by the bandwidth, default cell = min extent / 50.
  const x_min = minX - bandwidth;
  const y_min = minY - bandwidth;
  const x_max = maxX + bandwidth;
  const y_max = maxY + bandwidth;
  let cell_size = Math.min(x_max - x_min, y_max - y_min) / 50;
  if (cell_size <= 0) cell_size = 1.0;

  const cosLat = Math.max(Math.cos(((y_min + y_max) / 2) * Math.PI / 180), 0.01);
  let cell_size_y = cell_size;
  const cell_size_x = cell_size / cosLat;

  let n_cols = Math.ceil((x_max - x_min) / cell_size_x);
  let n_rows = Math.ceil((y_max - y_min) / cell_size_y);
  const totalCells = n_cols * n_rows;
  if (totalCells > MAX_GRID_CELLS) {
    const scaleFactor = Math.sqrt(MAX_GRID_CELLS / totalCells);
    n_cols = Math.floor(n_cols * scaleFactor);
    n_rows = Math.floor(n_rows * scaleFactor);
    if (n_cols < 1 || n_rows < 1) return null;
    cell_size_y = (y_max - y_min) / n_rows;
  }

  const meters = cell_size_y * METERS_PER_DEGREE_LAT;
  return Number.isFinite(meters) && meters > 0 ? meters : null;
}

/* --- TensorFlow.js Helper Functions --- */

/**
 * Computes the median of a 1D tensor.
 * Returns a scalar tensor.
 */
async function medianTensor(t: tf.Tensor1D): Promise<tf.Tensor> {
  const values = await t.array() as number[];
  const sortedValues = values.sort((a, b) => a - b);
  const sorted = tf.tensor1d(sortedValues);
  const len = t.shape[0];
  if (len % 2 === 0) {
    const mid1 = sorted.gather(len / 2 - 1);
    const mid2 = sorted.gather(len / 2);
    const med = tf.add(mid1, mid2).div(2);
    mid1.dispose();
    mid2.dispose();
    sorted.dispose();
    return med;
  } else {
    const med = sorted.gather(Math.floor(len / 2));
    sorted.dispose();
    return med;
  }
}


/**
 * Computes the specified percentile of a 1D tensor.
 * Returns a scalar tensor.
 */
async function percentileTensor(t: tf.Tensor1D, p: number): Promise<tf.Tensor> {
  const values = await t.array() as number[];
  const sortedValues = values.sort((a, b) => a - b);
  const sorted = tf.tensor1d(sortedValues);
  const len = t.shape[0];
  const rank = (p / 100) * (len - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) {
    const perc = sorted.gather(lowerIndex);
    sorted.dispose();
    return perc;
  } else {
    const lowerValue = sorted.gather(lowerIndex);
    const upperValue = sorted.gather(upperIndex);
    const frac = rank - lowerIndex;
    const perc = tf.add(lowerValue, tf.mul(tf.sub(upperValue, lowerValue), frac));
    lowerValue.dispose();
    upperValue.dispose();
    sorted.dispose();
    return perc;
  }
}


/**
 * Classify grid cells in a 2D density tensor based on quantile thresholds.
 *
 * This function first extracts nonzero density values, computes the quantile thresholds
 * for each provided level, and then assigns integer categories:
 *  • 0: below the 0.9 threshold,
 *  • 1: between the 0.9 and 0.975 thresholds,
 *  • 2: between the 0.975 and 0.99 thresholds,
 *  • 3: above the 0.99 threshold.
 *
 * @param densitySlice 2D tensor of density values.
 * @param levels Array of quantile levels (default: [0.9, 0.975, 0.99]).
 * @returns A Promise resolving to an object with:
 *   - classification: a tf.Tensor2D (dtype int32) with category labels.
 *   - thresholds: an object mapping each quantile level to its computed density threshold.
 */
export async function classifyByQuantile(
  densitySlice: tf.Tensor2D,
  levels: number[] = [0.9, 0.975, 0.99]
): Promise<{ classification: tf.Tensor2D; thresholds: { [key: number]: number } }> {
  // Mask out zeros and get a 1D tensor of nonzero density values.
  const nonzeroMask = densitySlice.greater(tf.scalar(0));
  const nonzeroValues = (await tf.booleanMaskAsync(densitySlice, nonzeroMask)) as tf.Tensor1D;

  const thresholds: { [key: number]: number } = {};
  for (const lvl of levels) {
    const threshTensor = await percentileTensor(nonzeroValues, lvl * 100); // 0.9 -> 90th percentile
    const thresh = (await threshTensor.array()) as number;
    thresholds[lvl] = thresh;
    threshTensor.dispose();
  }
  // Begin with a tensor of zeros (category 0).
  let classification = tf.zerosLike(densitySlice);

  const q90 = tf.scalar(thresholds[0.9]);
  const q975 = tf.scalar(thresholds[0.975]);
  const q99 = tf.scalar(thresholds[0.99]);

  // Category 1: density > q90 and density < q975 → assign label 1.
  const mask1 = densitySlice.greater(q90).logicalAnd(densitySlice.less(q975));
  classification = tf.where(mask1, tf.fill(densitySlice.shape, 1, 'int32'), classification);
  // Category 2: density > q975 and density < q99 → assign label 2.
  const mask2 = densitySlice.greater(q975).logicalAnd(densitySlice.less(q99));
  classification = tf.where(mask2, tf.fill(densitySlice.shape, 2, 'int32'), classification);
  // Category 3: density > q99 → assign label 3.
  const mask3 = densitySlice.greater(q99);
  classification = tf.where(mask3, tf.fill(densitySlice.shape, 3, 'int32'), classification);

  // Clean up intermediate tensors.
  q90.dispose();
  q975.dispose();
  q99.dispose();
  nonzeroMask.dispose();
  nonzeroValues.dispose();
  mask1.dispose();
  mask2.dispose();
  mask3.dispose();

  return { classification, thresholds };
}

/**
 * Helper function to create a meshgrid from x and y arrays.
 * Returns an object with X and Y as 2D arrays.
 */
export function meshgrid(x: number[], y: number[]): { X: number[][]; Y: number[][] } {
  const X: number[][] = [];
  const Y: number[][] = [];
  for (let j = 0; j < y.length; j++) {
    const rowX: number[] = [];
    const rowY: number[] = [];
    for (let i = 0; i < x.length; i++) {
      rowX.push(x[i]);
      rowY.push(y[j]);
    }
    X.push(rowX);
    Y.push(rowY);
  }
  return { X, Y };
}

export interface ClassificationResults {
  X: number[][];
  Y: number[][];
  time_nums: number[];
  classificationSlicesArrays: number[][][];
  thresholdsAll: { [key: number]: number }[];
}

function computeSideLengthAndHeight(
  X: number[][],
  Y: number[][]
): { sideLength: number; cellHeight: number; totalHeight: number } {

  const flatX = X.flat();
  const flatY = Y.flat();

  if (!flatX.length || !flatY.length) {
    return { sideLength: 1, cellHeight: 100, totalHeight: 1000 };
  }

  const spatialExtent = Math.max(
    (Math.max(...flatX) - Math.min(...flatX)),
    (Math.max(...flatY) - Math.min(...flatY)),
    Number.EPSILON
  );

  // Calculate unified peak altitude shared across all 3D modules
  const minLng = Math.min(...flatX);
  const maxLng = Math.max(...flatX);
  const minLat = Math.min(...flatY);
  const maxLat = Math.max(...flatY);

  const TOTAL_HEIGHT_METERS = ToolUtils.calculateOptimalZAxisHeight(minLng, maxLng, minLat, maxLat);

  const effectiveSlices = 10; // Default STKDE slices
  const cellHeight = TOTAL_HEIGHT_METERS / effectiveSlices;
  const sideLength = spatialExtent;

  return { sideLength, cellHeight, totalHeight: TOTAL_HEIGHT_METERS };
}

/**
 * Example usage of the classification function.
 *
 * Assume you have the following variables from your STKDE analysis:
 *   • density: a tf.Tensor3D of shape [n_time_slices, n_rows, n_cols]
 *   • x_centers: number[] of grid cell center x coordinates
 *   • y_centers: number[] of grid cell center y coordinates
 *   • time_values: Date[] representing time slice centers
 *
 * This function converts time values to numeric (if needed), creates a meshgrid,
 * ensures the density tensor is 3D, and then classifies each time slice.
 */
export async function classifyKDE(
  density: tf.Tensor | tf.Tensor3D,
  x_centers: number[],
  y_centers: number[],
  time_values: Date[]
): Promise<ClassificationResults> {
  // Convert time_values to numeric (milliseconds since epoch)
  const time_nums = time_values.map((d) => d.getTime());

  // Create a meshgrid for spatial coordinates.
  const { X, Y } = meshgrid(x_centers, y_centers);

  // Ensure the density tensor is 3D.
  let density3D: tf.Tensor3D;
  if (density.rank === 2) {
    density3D = density.expandDims(0) as tf.Tensor3D;
  } else {
    density3D = density as tf.Tensor3D;
  }
  const n_time_slices = density3D.shape[0];

  const classificationSlices: tf.Tensor2D[] = [];
  const thresholdsAll: { [key: number]: number }[] = [];

  // Classify each time slice.
  for (let t = 0; t < n_time_slices; t++) {
    // Extract the density slice at time index t.
    const densitySlice = density3D.slice([t, 0, 0], [1, -1, -1]).squeeze([0]) as tf.Tensor2D;
    const { classification, thresholds } = await classifyByQuantile(densitySlice, [0.9, 0.975, 0.99]);
    classificationSlices.push(classification);
    thresholdsAll.push(thresholds);
    densitySlice.dispose();
  }

  // Optionally, convert the classification slices to JavaScript arrays for further use or plotting.
  const classificationSlicesArrays = await Promise.all(classificationSlices.map((cs) => cs.array()));

  // Dispose of the classification slice tensors if no longer needed.
  classificationSlices.forEach((cs) => cs.dispose());

  // Clean up density tensor if it was created here
  if (density.rank === 2 && density3D !== density) {
    density3D.dispose();
  }

  return {
    X,
    Y,
    time_nums,
    classificationSlicesArrays,
    thresholdsAll,
  };
}

import { FeatureCollection, Feature, Polygon } from 'geojson';

/**
 * Creates a GeoJSON FeatureCollection of square polygons representing
 * the classified density grid. Only features with a classification > 0 are kept.
 *
 * @param meshgridData - An object with X and Y as 2D arrays (e.g. from a meshgrid function)
 * @param classificationSlices - A 3D array of classification values [n_time_slices][n_rows][n_cols]
 * @param timeValues - An array of Date objects representing the center time of each slice
 * @param cell_size - The buffer distance (in map units) used to create the square polygon.
 * @param cell_size_meters - A scaling factor (e.g. the cell size in meters used for vertical dimension).
 *
 * @returns A GeoJSON FeatureCollection where each feature is a square polygon with a Z value.
 */
export function createClassificationGeoJSON(
  X: number[][],
  Y: number[][],
  classificationSlices: number[][][],
  cellSize: number,
  timeNums: number[],
  align: boolean = false
): FeatureCollection[] {
  const timeSliceCount = classificationSlices.length;
  const { sideLength, cellHeight } = computeSideLengthAndHeight(X, Y);

  const rowCount = X.length;
  const columnCount = rowCount > 0 ? X[0].length : 0;

  // Per-axis half-extent from the actual grid spacing. The grid is square in
  // metres (longitude step wider than latitude), so deriving the extents from
  // the meshgrid keeps cells tiling correctly instead of forcing equal degrees.
  const halfX = columnCount > 1 ? Math.abs(X[0][1] - X[0][0]) / 2 : cellSize / 2;
  const halfY = rowCount > 1 ? Math.abs(Y[1][0] - Y[0][0]) / 2 : cellSize / 2;

  const featuresByClassification: Feature<Polygon>[][] = [[], [], [], []];

  for (let t = 0; t < timeSliceCount; t++) {
    const zBase = t * cellHeight;
    const timeValueMs = timeNums[t] ?? timeNums[timeNums.length - 1] ?? 0;
    const timeValueIso = new Date(timeValueMs).toISOString();

    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < columnCount; col++) {
        const classification = classificationSlices[t]?.[row]?.[col] ?? 0;
        if (classification <= 0 || classification >= featuresByClassification.length) {
          continue;
        }

        const x = X[row][col];
        const y = Y[row][col];

        const squareCoords = [
          [x - halfX, y - halfY, zBase],
          [x + halfX, y - halfY, zBase],
          [x + halfX, y + halfY, zBase],
          [x - halfX, y + halfY, zBase],
          [x - halfX, y - halfY, zBase]
        ];

        const feature: Feature<Polygon> = {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [squareCoords]
          },
          properties: {
            classification,
            z: zBase,
            [STKDE_Z_AXIS_FIELD]: zBase,
            time_slice_index: t,
            time_value: timeValueIso,
            [PROCESSED_HEIGHT_FIELD]: cellHeight,
            [PROCESSED_TIME_FIELD]: timeSliceCount > 1 ? t / (timeSliceCount - 1) : 0,
            _timestamp: timeValueMs,
            ...(align ? { _elapsed_ms: timeValueMs } : {}),
            side_length: sideLength
          }
        };

        featuresByClassification[classification].push(feature);
      }
    }
  }

  const featureCollections: FeatureCollection[] = [];
  for (let classification = 1; classification < featuresByClassification.length; classification++) {
    featureCollections.push({
      type: 'FeatureCollection',
      features: featuresByClassification[classification]
    });
  }

  return featureCollections;
}



/**
 * createSTKDE
 *  - Computes the STKDE result from a GeoJSON FeatureCollection using stkde_tf.
 *  - Converts the density output to a tf.Tensor (ensuring a 3D tensor).
 *  - Runs the exampleClassification function on the density tensor.
 *
 * Returns an object containing both the STKDE result and the classification results.
 */
export async function createSTKDE(
  gdf: GeoJSON.FeatureCollection<GeoJSON.Point, any>,
  timeCol: string = 'timestamp',
  spatial_bandwidth?: number,
  temporal_bandwidth?: number,
  cell_size?: number,
  n_time_slices: number = 24,
  opts?: { userField?: string; align?: boolean }
): Promise<{ features: GeoJSON.FeatureCollection[]; timeNums: number[] }> {
  try {
    // 1. Compute the STKDE result.
    const stkdeResult = await tf_stkde(gdf, timeCol, spatial_bandwidth, temporal_bandwidth, cell_size, n_time_slices, opts);

    // 2. Convert the density output to a tf.Tensor3D.
    let densityTensor: tf.Tensor3D;
    if (Array.isArray(stkdeResult.density)) {
      // Check if density is 2D or 3D.
      if (!Array.isArray((stkdeResult.density as any)[0][0])) {
        // It is a 2D array: expand dims.
        densityTensor = tf.tensor2d(stkdeResult.density as number[][]).expandDims(0) as tf.Tensor3D;
      } else {
        densityTensor = tf.tensor3d(stkdeResult.density as number[][][]);
      }
    } else {
      throw new Error("Invalid density format");
    }

    // 3. Classify the density slices.
    const classificationResults = await classifyKDE(
      densityTensor,
      stkdeResult.x_centers,
      stkdeResult.y_centers,
      stkdeResult.time_values
    );

    // 4. Create the GeoJSON FeatureCollection.
    const densityFeatures = createClassificationGeoJSON(
      classificationResults.X,
      classificationResults.Y,
      classificationResults.classificationSlicesArrays,
      stkdeResult.cell_size,
      classificationResults.time_nums,
      stkdeResult.align
    );

    // Clean up the density tensor
    densityTensor.dispose();

    return {
      features: densityFeatures,
      timeNums: classificationResults.time_nums
    };
  } catch (error) {
    console.error('Error in stkde_analysis:', error);
    throw error;
  }
}
/**
 * Computes the standard deviation of a 1D tensor.
 * Returns a scalar tensor.
 */
function stdTensor(t: tf.Tensor1D): tf.Tensor {
  const moments = tf.moments(t);
  return tf.sqrt(moments.variance);
}

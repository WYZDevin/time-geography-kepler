import { PROCESSED_HEIGHT_FIELD } from '@/utils/constants';
import { ToolUtils } from '@/tools/tool-utils';
import * as tf from '@tensorflow/tfjs';
import * as turf from '@turf/turf';

export const STKDE_Z_AXIS_FIELD = 'z_axis';

export interface STKDEResult {
  density: number[][][] | number[][];  // 3D if multiple time slices; 2D if single
  x_centers: number[];
  y_centers: number[];
  time_values: Date[];
  cell_size: number;
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
  n_time_slices: number = 10
): Promise<STKDEResult> {

  // Limit grid size to prevent WebGL issues
  const MAX_GRID_CELLS = 2500; // 50x50 max grid
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
  // Convert raw times into seconds offset from the minimum time.
  const time_vals: number[] = rawTimes.map(t => (t - t_min_val) / 1000);

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
  if (cell_size === undefined) {
    const dx_extent = x_max - x_min;
    const dy_extent = y_max - y_min;
    // 50 is the number of cells in the grid
    cell_size = Math.min(dx_extent, dy_extent) / 50;
    if (cell_size <= 0) cell_size = 1.0;
  }
  let n_cols = Math.ceil((x_max - x_min) / cell_size);
  let n_rows = Math.ceil((y_max - y_min) / cell_size);

  // Limit grid size to prevent WebGL framebuffer errors
  const totalCells = n_cols * n_rows;
  if (totalCells > MAX_GRID_CELLS) {
    console.warn(`Grid size ${n_cols}x${n_rows} (${totalCells} cells) exceeds limit. Reducing to prevent WebGL errors.`);
    const scaleFactor = Math.sqrt(MAX_GRID_CELLS / totalCells);
    n_cols = Math.floor(n_cols * scaleFactor);
    n_rows = Math.floor(n_rows * scaleFactor);
    // Recalculate cell_size based on new grid dimensions
    cell_size = Math.max((x_max - x_min) / n_cols, (y_max - y_min) / n_rows);
  }

  x_max = x_min + n_cols * cell_size;
  y_max = y_min + n_rows * cell_size;

  // Compute grid cell center coordinates using TensorFlow.js (replace for-loop with tensor operations).
  const colIndices = tf.range(0, n_cols, 1, 'float32');
  const x_min_scalar = tf.scalar(x_min + 0.5 * cell_size);
  const x_centers_tensor = tf.add(x_min_scalar, tf.mul(colIndices, cell_size));
  const x_centers = x_centers_tensor.arraySync() as number[];
  colIndices.dispose();
  x_min_scalar.dispose();
  x_centers_tensor.dispose();

  const rowIndices = tf.range(0, n_rows, 1, 'float32');
  const y_min_scalar = tf.scalar(y_min + 0.5 * cell_size);
  const y_centers_tensor = tf.add(y_min_scalar, tf.mul(rowIndices, cell_size));
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

  const densityTimeSlices: number[][][] = [];
  for (let t_idx = 0; t_idx < time_centers.length; t_idx++) {
    const t_center = time_centers[t_idx];
    // Temporal kernel: compute absolute differences and scale.
    const dt = tf.abs(tf.sub(tfT, t_center));
    const t_u = tf.div(dt, temporal_bandwidth);
    const mask = tf.lessEqual(dt, temporal_bandwidth);
    const one = tf.scalar(1.0);
    const t_weight_all = tf.mul(const_time, tf.pow(tf.sub(one, tf.pow(t_u, 2)), 2));
    const t_weight = tf.where(mask, t_weight_all, tf.zerosLike(t_weight_all));

    // Spatial kernel: compute differences between every point and every grid cell.
    const tfX_exp = tfX.reshape([n, 1, 1]);             // [n, 1, 1]
    const tfY_exp = tfY.reshape([n, 1, 1]);             // [n, 1, 1]
    const Xgrid_exp = Xgrid.reshape([1, n_rows, n_cols]); // [1, n_rows, n_cols]
    const Ygrid_exp = Ygrid.reshape([1, n_rows, n_cols]); // [1, n_rows, n_cols]
    const diffX = tf.sub(Xgrid_exp, tfX_exp);
    const diffY = tf.sub(Ygrid_exp, tfY_exp);
    const dist2 = tf.add(tf.square(diffX), tf.square(diffY));
    const spatial_mask = tf.lessEqual(dist2, spatial_bandwidth * spatial_bandwidth);
    const spatial_u = tf.div(dist2, spatial_bandwidth * spatial_bandwidth);
    const spatial_kernel_all = tf.mul(const_spatial, tf.pow(tf.sub(one, spatial_u), 2));
    const spatial_kernel = tf.where(spatial_mask, spatial_kernel_all, tf.zerosLike(spatial_kernel_all));

    // Multiply each point's spatial kernel by its temporal weight and sum over points.
    const t_weight_exp = t_weight.reshape([n, 1, 1]);
    const contribution = tf.mul(t_weight_exp, spatial_kernel);
    const density_slice = contribution.sum(0); // [n_rows, n_cols]
    const density_slice_array = await density_slice.array() as number[][];
    densityTimeSlices.push(density_slice_array);

    // Dispose temporary tensors for this iteration.
    dt.dispose();
    t_u.dispose();
    mask.dispose();
    t_weight_all.dispose();
    t_weight.dispose();
    tfX_exp.dispose();
    tfY_exp.dispose();
    Xgrid_exp.dispose();
    Ygrid_exp.dispose();
    diffX.dispose();
    diffY.dispose();
    dist2.dispose();
    spatial_mask.dispose();
    spatial_u.dispose();
    spatial_kernel_all.dispose();
    spatial_kernel.dispose();
    t_weight_exp.dispose();
    contribution.dispose();
    density_slice.dispose();
    one.dispose();
  }

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
  // Convert time slice centers back to Date objects.
  const time_values: Date[] = time_centers.map(tc => new Date(t_min_val + tc * 1000));

  return { density, x_centers, y_centers, time_values, cell_size };
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
  timeNums: number[]
): FeatureCollection[] {
  const timeSliceCount = classificationSlices.length;
  const { sideLength, cellHeight } = computeSideLengthAndHeight(X, Y);

  const rowCount = X.length;
  const columnCount = rowCount > 0 ? X[0].length : 0;

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
          [x - cellSize / 2, y - cellSize / 2, zBase],
          [x + cellSize / 2, y - cellSize / 2, zBase],
          [x + cellSize / 2, y + cellSize / 2, zBase],
          [x - cellSize / 2, y + cellSize / 2, zBase],
          [x - cellSize / 2, y - cellSize / 2, zBase]
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
  n_time_slices: number = 24
): Promise<{ features: GeoJSON.FeatureCollection[]; timeNums: number[] }> {
  try {
    // 1. Compute the STKDE result.
    const stkdeResult = await tf_stkde(gdf, timeCol, spatial_bandwidth, temporal_bandwidth, cell_size, n_time_slices);

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
      classificationResults.time_nums
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

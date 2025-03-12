"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Nakaya's Space-Time Kernel Density Estimation.
 *
 * In this implementation, for each evaluation time step we only include events
 * that occurred in the past (i.e. point.time <= currentTime). The density at
 * each grid point is computed by summing the Gaussian kernel contributions in
 * space and time. The kernels are defined as:
 *
 *   K(u) = exp(-0.5 * u^2)
 *
 * where the spatial distances are scaled by h_space and the time difference is
 * scaled by h_time. The density estimate at a grid point (x,y) and time t is:
 *
 *   f(x,y,t) = (1 / (n * h_space^2 * h_time)) *
 *              Σ_{i: t_i <= t} [ exp(-0.5*((x - x_i)/h_space)^2)
 *                                  * exp(-0.5*((y - y_i)/h_space)^2)
 *                                  * exp(-0.5*((t - t_i)/h_time)^2) ]
 *
 * @param {FeatureCollection<Point>} points - GeoJSON FeatureCollection where each feature has a "datetime" property (ISO string).
 * @param {FeatureCollection<Point>} spatialGrid - GeoJSON FeatureCollection of grid points where the density is evaluated.
 * @param {number[]} timeSteps - Array of evaluation times (in ms) at which to compute the density.
 * @param {number} h_space - Spatial bandwidth (in the same units as your point coordinates).
 * @param {number} h_time - Temporal bandwidth (in milliseconds, or in the unit corresponding to your timeSteps).
 * @returns {Array} densityGrid - A 2D array where densityGrid[tIndex][gridIndex] is the density estimate at that time step and grid point.
 */
function nakayaKernelDensity3D(points, spatialGrid, timeSteps, h_space, h_time) {
    // Preprocess points: extract coordinates and convert datetime to timestamp.
    var pointData = points.features.map(function (feature) {
        var coords = feature.geometry.coordinates; // [x, y]
        var timeVal = new Date(feature.properties.datetime).getTime();
        return { coords: coords, time: timeVal };
    });
    var n = pointData.length;
    var densityGrid = []; // Array of density arrays for each time step.
    // Define the Gaussian kernel function.
    function gaussian(u) {
        return Math.exp(-0.5 * u * u);
    }
    // Loop over each evaluation time step.
    timeSteps.forEach(function (currentTime, tIndex) {
        // Compute density for each spatial grid point at the current time.
        var densityAtTime = spatialGrid.features.map(function (gridPoint) {
            var gridCoords = gridPoint.geometry.coordinates; // [x, y]
            var density = 0;
            // Sum contributions only from events that occurred in the past.
            pointData.forEach(function (point) {
                if (point.time <= currentTime) {
                    var dx = (gridCoords[0] - point.coords[0]) / h_space;
                    var dy = (gridCoords[1] - point.coords[1]) / h_space;
                    // Time difference: current time minus event time (always positive).
                    var dt = (currentTime - point.time) / h_time;
                    // Multiply spatial and temporal contributions.
                    density += gaussian(dx) * gaussian(dy) * gaussian(dt);
                }
            });
            // Normalize the density. (Normalization factor may be adjusted
            // depending on your application; here we use n * h_space^2 * h_time.)
            return density / (n * h_space * h_space * h_time);
        });
        densityGrid.push(densityAtTime);
    });
    return densityGrid;
}
/* ============================
   Example usage:

   // 1. Define a GeoJSON FeatureCollection of points (with "datetime" property)
   const points = {
     "type": "FeatureCollection",
     "features": [
       { "type": "Feature",
         "geometry": { "type": "Point", "coordinates": [-75.343, 39.984] },
         "properties": { "datetime": "2025-03-10T12:00:00Z" }
       },
       // Add additional point features...
     ]
   };

   // 2. Create a spatial grid using Turf.js (for example, using turf.pointGrid)
   const bbox = [-76, 39, -74, 40]; // [minX, minY, maxX, maxY]
   const cellSize = 5; // cell size in kilometers (or your chosen unit)
   const spatialGrid = turf.pointGrid(bbox, cellSize, { units: 'kilometers' });

   // 3. Define an array of time steps (in milliseconds). For instance, every hour:
   const startTime = new Date("2025-03-10T00:00:00Z").getTime();
   const endTime = new Date("2025-03-11T00:00:00Z").getTime();
   const timeSteps = [];
   const oneHour = 3600 * 1000;
   for (let t = startTime; t <= endTime; t += oneHour) {
     timeSteps.push(t);
   }

   // 4. Set bandwidths. Adjust these based on the scale of your data.
   const h_space = 0.1; // Adjust as needed (e.g., in degrees or km)
   const h_time = oneHour; // Temporal bandwidth in milliseconds

   // 5. Compute the spatiotemporal density using Nakaya's approach.
   const density3D = nakayaKernelDensity3D(points, spatialGrid, timeSteps, h_space, h_time);

   console.log(density3D);
   ============================ */
var sample_1 = require("./sample");
console.log(sample_1.default);

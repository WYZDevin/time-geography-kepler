import { FeatureCollection, GeoJSONFeature } from "@/interfaces/data-interfaces";
import { PROCESSED_TIME_FIELD, SCALE_FACTOR } from "@/utils/constants";
import { Field, ProcessorResult } from "@kepler.gl/types";
import { processGeojson } from "@kepler.gl/processors";
import { selectHeightScale } from "@/stores/metadata-slice";
import store from "@/stores/store";

/**
 * Determines if three points make a left turn (counter-clockwise)
 * @param p1 - First point [x, y]
 * @param p2 - Second point [x, y]
 * @param p3 - Third point [x, y]
 * @returns True if the points make a left turn, false otherwise
 */
const isLeftTurn = (p1: number[], p2: number[], p3: number[]): boolean => {
    // Calculate the cross product
    const crossProduct = (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);

    // If cross product is positive, it's a left turn
    return crossProduct > 0;
};

/**
 * Computes the convex hull of a set of 2D points using the Graham scan algorithm.
 * @param points - Array of [x, y] coordinates
 * @param maxHeight - Maximum height value to use for the 3D hull
 * @returns A GeoJSON FeatureCollection containing a single Polygon feature representing the convex hull
 */
const getConvexHull = (points: number[][], maxHeight: number, initialHeight: number = 0): FeatureCollection => {
    const absoluteHeight = maxHeight - initialHeight;
    const heightScale = selectHeightScale(store.getState());
    initialHeight = initialHeight * heightScale;

    if (points.length <= 2) {
        // Not enough points to form a hull
        return {
            type: "FeatureCollection",
            features: []
        };
    }

    // Find the point with the lowest y-coordinate (and leftmost if tied)
    let startIndex = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i][1] < points[startIndex][1] ||
            (points[i][1] === points[startIndex][1] && points[i][0] < points[startIndex][0])) {
            startIndex = i;
        }
    }

    // Swap the start point to the first position
    [points[0], points[startIndex]] = [points[startIndex], points[0]];
    const startPoint = points[0];

    // Sort points by polar angle with respect to the start point
    const sortedPoints = points.slice(1).sort((a, b) => {
        const angleA = Math.atan2(a[1] - startPoint[1], a[0] - startPoint[0]);
        const angleB = Math.atan2(b[1] - startPoint[1], b[0] - startPoint[0]);

        if (angleA === angleB) {
            // If angles are the same, sort by distance from start point
            const distA = Math.sqrt(Math.pow(a[0] - startPoint[0], 2) + Math.pow(a[1] - startPoint[1], 2));
            const distB = Math.sqrt(Math.pow(b[0] - startPoint[0], 2) + Math.pow(b[1] - startPoint[1], 2));
            return distA - distB;
        }

        return angleA - angleB;
    });

    // Add the start point back to the beginning
    sortedPoints.unshift(startPoint);

    // Graham scan algorithm
    let hull = [[...sortedPoints[0], initialHeight], [...sortedPoints[1], initialHeight]];

    for (let i = 2; i < sortedPoints.length; i++) {
        while (hull.length >= 2 && !isLeftTurn(hull[hull.length - 2], hull[hull.length - 1], sortedPoints[i])) {
            hull.pop();
        }
        hull.push([...sortedPoints[i], initialHeight]);

    }

    // Close the hull by adding the first point again

    hull.push([...hull[0]]);


    // Create a GeoJSON feature for the convex hull
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {
                    [PROCESSED_TIME_FIELD]: absoluteHeight,
                    ['initialHeight']: initialHeight
                },
                geometry: {
                    type: "Polygon",
                    coordinates: [hull]
                }
            }
        ]
    };
};

/**
 * Creates a raw convex hull GeoJSON object from a ProcessorResult
 * @param data - The ProcessorResult object containing the data
 * @param addInitialHeight - Whether to add the initial height to the convex hull (by )
 * @returns A GeoJSON FeatureCollection containing a single Polygon feature representing the convex hull
 */
const createRawConvexHullGeojson = (data: FeatureCollection, initialHeight: number = 0, inputMaxHeight: number = -1) => {

    let maxHeight = -1
    // if the max height is not provided, get the height field
    if (inputMaxHeight === -1) {
        const heights: number[] = data.features.map((f: GeoJSONFeature) => f.properties[PROCESSED_TIME_FIELD]);
        maxHeight = Math.max(...heights);
    } else {
        maxHeight = inputMaxHeight;
    }

    // Extract points from features
    const points = data.features.map((f: GeoJSONFeature) => [
        f.geometry.coordinates[0],
        f.geometry.coordinates[1]
    ]);

    console.log(initialHeight, maxHeight);
    // Calculate convex hull
    const hullPoints = getConvexHull(points, maxHeight, initialHeight)
    return hullPoints;
}

export { createRawConvexHullGeojson };
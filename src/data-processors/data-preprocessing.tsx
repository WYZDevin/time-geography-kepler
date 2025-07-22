import { ColumnMapping, FeatureCollection } from "@/interfaces/data-interfaces";
import { findCoordinateAndTimeColumns } from "@/data-processors/data-handler";
import * as turf from '@turf/turf';
import { point, distance } from '@turf/turf';
import { PROCESSED_TIME_FIELD, PROCESSED_NEIGHBORS_FIELD } from "@/utils/constants";
import { setHeightScale, setSideLength, setDataLength } from "@/stores/metadata-slice";
import store from "@/stores/store";


/**
 * Sorts the features in the GeoJSON FeatureCollection by the time column specified inSS mapping,
 * and adds an "order" property (starting at 0) to each feature’s properties corresponding to its
 * position in the sorted order.
 *
 * @param data - The input GeoJSON FeatureCollection.
 * @param mapping - An object containing the name of the time column (and optionally other columns).
 * @returns A new FeatureCollection with each feature updated with an "order" property.
 */
function addOrderByTime(data: FeatureCollection, mapping: ColumnMapping): FeatureCollection {
  // Create a shallow copy of the features array for sorting.
  const sortedFeatures = [...data.features].sort((a, b) => {
    const timeA = new Date(a.properties[mapping.time!]).getTime();
    const timeB = new Date(b.properties[mapping.time!]).getTime();
    return timeA - timeB;
  });

  // Create new features with updated properties and geometry
  const processedFeatures = sortedFeatures.map((feature, index) => {
    // Create new properties object with additional fields
    const newProperties = {
      ...feature.properties,
      [PROCESSED_TIME_FIELD]: index,
      [PROCESSED_NEIGHBORS_FIELD]: [index - 1, index + 1]
    };

    // Create new geometry with altitude (z-coordinate)
    const newGeometry = {
      ...feature.geometry,
      coordinates: [
        ...feature.geometry.coordinates.slice(0, 2), // x, y
        index // z (altitude)
      ]
    };

    // Return new feature object
    return {
      ...feature,
      properties: newProperties,
      geometry: newGeometry
    };
  });

  // Return a new FeatureCollection with the processed features.
  return {
    ...data,
    features: processedFeatures,
  };
}

function getBBoxSideLengths(bbox: number[]) {
  const [minX, minY, maxX, maxY] = bbox;

  // Define corners
  const bottomLeft = point([minX, minY]);
  const bottomRight = point([maxX, minY]);
  const topLeft = point([minX, maxY]);
  // const topRight = point([maxX, maxY]);

  // Compute distances in kilometers
  const widthBottom = distance(bottomLeft, bottomRight, { units: 'meters' });
  const widthTop = distance(topLeft, point([maxX, maxY]), { units: 'meters' });
  const heightLeft = distance(bottomLeft, topLeft, { units: 'meters' });
  const heightRight = distance(bottomRight, point([maxX, maxY]), { units: 'meters' });

  return {
    bottom: widthBottom,
    top: widthTop,
    left: heightLeft,
    right: heightRight
  };
}


const preprocessGeojsonData = (data: FeatureCollection): FeatureCollection => {

  // Get the feature names from the first feature
  const featureNames = data.features.map(feature => Object.keys(feature.properties))[0];

  // Find the coordinate and time columns
  const columnMapping: ColumnMapping = findCoordinateAndTimeColumns(featureNames);

  // Add the order by time column
  const processedData = addOrderByTime(data, columnMapping);

  // Get the length of the data
  const length = processedData.features.length;
  store.dispatch(setDataLength(length));
  
  // Get bbox of the data
  const bbox = turf.bbox(processedData);

  const sideLengths = getBBoxSideLengths(bbox);
  const sideLengthMeters = Math.max(sideLengths.left, sideLengths.right, sideLengths.top, sideLengths.bottom);
  
  // Max compacity should be 50000
  // const sideLengthMeters = Math.min(sideLength, 7200);
  // const sideLengthMeters = sideLength;
  // console.log("sideLengthMeters", sideLengthMeters);
  store.dispatch(setSideLength(sideLengthMeters));

  // Get the scale of the data
  const heightScale = sideLengthMeters / length;
  store.dispatch(setHeightScale(heightScale));
  // store.dispatch(setHeightScale(1));

  console.log("heightScale", heightScale, 'Side Length', sideLengthMeters, 'Data Length', length);

  return processedData
}

/**
 * Get the unique values from a GeoJSON feature collection for a given property name.
 * 
 * @param geojson - The input GeoJSON feature collection.
 * @param featureName - The name of the property to get unique values from.
 * @returns An array of unique values.
 */
function getUniqueValuesFromGeoJSON(geojson: FeatureCollection, featureName: string) {
  const uniqueValuesSet = new Set();
  turf.featureEach(geojson, (feature) => {
    if (feature.properties && feature.properties[featureName] !== undefined) {
      uniqueValuesSet.add(feature.properties[featureName]);
    }
  });
  return [...uniqueValuesSet];
}



export { preprocessGeojsonData, getUniqueValuesFromGeoJSON };

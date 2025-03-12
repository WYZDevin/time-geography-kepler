import { ColumnMapping, FeatureCollection, GeoJSONFeature } from "@/interfaces/data-interfaces";
import { findCoordinateAndTimeColumns } from "@/data-processors/data-handler";
import * as turf from '@turf/turf';
import { PROCESSED_ALTITUDE_FIELD, PROCESSED_NEIGHBORS_FIELD } from "@/utils/constants";


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

  // Use turf.featureEach to iterate over the sorted features and assign the "order" property.
  turf.featureEach({ type: "FeatureCollection", features: sortedFeatures }, (feature: GeoJSONFeature, index: number) => {
    // add the time order and neighbors to the feature for visualization
    feature.properties[PROCESSED_ALTITUDE_FIELD] = index;
    feature.properties[PROCESSED_NEIGHBORS_FIELD] = [index - 1, index + 1];

    // add altitude to the geometry
    feature.geometry.coordinates[2] = index;
  });

  // Return a new FeatureCollection with the sorted (and updated) features.
  return {
    ...data,
    features: sortedFeatures,
  };
}

const preprocessGeojsonData = (data: FeatureCollection): FeatureCollection => {

  // Get the feature names from the first feature
  const featureNames = data.features.map(feature => Object.keys(feature.properties))[0];

  // Find the coordinate and time columns
  const columnMapping: ColumnMapping = findCoordinateAndTimeColumns(featureNames);

  // Add the order by time column
  const processedData = addOrderByTime(data, columnMapping);


  return processedData;
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
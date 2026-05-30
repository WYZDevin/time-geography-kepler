import { FeatureCollection } from '../interfaces/data-interfaces';

/**
 * Safely extract field names from GeoJSON FeatureCollection
 * This avoids issues with data processing
 */
export const extractFieldNames = (geoJsonData: FeatureCollection): string[] => {
    if (!geoJsonData || !geoJsonData.features || geoJsonData.features.length === 0) {
        return [];
    }

    const fieldSet = new Set<string>();

    // Extract fields from the first few features to get a comprehensive list
    const samplesToCheck = Math.min(10, geoJsonData.features.length);
    
    for (let i = 0; i < samplesToCheck; i++) {
        const feature = geoJsonData.features[i];
        
        if (feature.properties) {
            Object.keys(feature.properties).forEach(key => {
                fieldSet.add(key);
            });
        }
        
        // Also check geometry coordinates if it's a Point (for lat/lng detection)
        if (feature.geometry && feature.geometry.type === 'Point') {
            // For Point geometries, we can infer longitude/latitude from coordinates
            // This is just for field detection, not actual mapping
            if (feature.geometry.coordinates && feature.geometry.coordinates.length >= 2) {
                fieldSet.add('_longitude'); // Virtual field for coordinate[0]
                fieldSet.add('_latitude');  // Virtual field for coordinate[1]
                if (feature.geometry.coordinates.length >= 3) {
                    fieldSet.add('_altitude'); // Virtual field for coordinate[2]
                }
            }
        }
    }

    return Array.from(fieldSet).sort();
};

/**
 * Create a visualization-compatible dataset from GeoJSON
 * This safely prepares the data for visualization
 */
export const prepareDataForVisualization = (geoJsonData: FeatureCollection, datasetName: string = 'analysis-data') => {
    try {
        // Create a deep copy to avoid modifying the original data
        const dataCopy = JSON.parse(JSON.stringify(geoJsonData));
        
        return {
            info: {
                label: datasetName,
                id: datasetName.toLowerCase().replace(/\s+/g, '-')
            },
            data: dataCopy
        };
    } catch (error) {
        console.error('Error preparing data for visualization:', error);
        return null;
    }
};

/**
 * Validate GeoJSON structure
 */
export const validateGeoJSON = (data: any): data is FeatureCollection => {
    return (
        data &&
        typeof data === 'object' &&
        data.type === 'FeatureCollection' &&
        Array.isArray(data.features) &&
        data.features.length > 0
    );
}; 
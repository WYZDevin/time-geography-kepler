import { PROCESSED_HEIGHT_FIELD } from "@/utils/constants";
/**
 * Creates GeoJSON features for coordinate axes visualization
 * @param bbox - Bounding box [minX, minY, maxX, maxY]
 * @param maxHeight - Maximum height for the z-axis
 * @returns Two GeoJSON FeatureCollections: one for the axis lines and one for the axis labels
 */
export function createAxisData(
    bbox: number[],
    maxHeight: number
  ): {
    axisFeatures: GeoJSON.FeatureCollection,
    labelFeatures: GeoJSON.FeatureCollection
  } {
    const [minX, minY, maxX, maxY] = bbox;
    const padding = 0.01 * Math.max(maxX - minX, maxY - minY); // 1% padding
    const paddingInMeters = padding * 111320;
    // Create axis lines
    const features: GeoJSON.Feature[] = [
      // X-axis (Longitude)
      {
        type: "Feature",
        properties: { type: "axis", label: "Longitude", [PROCESSED_HEIGHT_FIELD]: paddingInMeters },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [minX - padding, minY - padding, 0],
              [maxX + padding, minY - padding, 0],
              [maxX + padding, minY - padding, 0],
              [minX - padding, minY - padding, 0],
              [minX - padding, minY - padding, 0]
            ]
          ]
        }
      },
      // Y-axis (Latitude)
      {
        type: "Feature",
        properties: { type: "axis", label: "Latitude", [PROCESSED_HEIGHT_FIELD]: paddingInMeters },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [minX - padding, minY - padding, 0],
              [minX - padding, maxY + padding, 0],
              [minX - padding, maxY + padding, 0],
              [minX - padding, minY - padding, 0],
              [minX - padding, minY - padding, 0]
            ]
          ]
        }
      },
      // Z-axis (Height)
      {
        type: "Feature",
        properties: { type: "axis", label: "Height", [PROCESSED_HEIGHT_FIELD]: maxHeight },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
                // A small polygon around the minx and miny
                [minX - padding, minY - padding, 0],
                [minX - padding, minY + padding, 0],
                [minX + padding, minY + padding, 0],
                [minX + padding, minY - padding, 0],
                [minX - padding, minY - padding, 0]
            ]
          ]
        }
      }
    ];
  
    // Add axis labels as Point features at the middle of the axis
    const labelFeatures: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: { type: "label", text: "Longitude", 'latitude': minY, 'longitude': minX + (maxX - minX) / 2, [PROCESSED_HEIGHT_FIELD]: paddingInMeters },
        geometry: {
          type: "Point",
          coordinates: [minX + (maxX - minX) / 2, minY, 0]
        }
      },
      {
        type: "Feature",
        properties: { type: "label", text: "Latitude", 'latitude': minY + (maxY - minY) / 2, 'longitude': minX, [PROCESSED_HEIGHT_FIELD]: paddingInMeters },
        geometry: {
          type: "Point",
          coordinates: [minX, minY + (maxY - minY) / 2, 0]
        }
      },
      {
        type: "Feature",
        properties: { type: "label", text: "Time", 'latitude': minY, 'longitude': minX, [PROCESSED_HEIGHT_FIELD]: maxHeight / 2 },
        geometry: {
          type: "Point",
          coordinates: [minX, minY, maxHeight / 2]
        }
      }
    ];
  
    return {
      axisFeatures: {
        type: "FeatureCollection",
        features: [...features]
      },
      labelFeatures: {
        type: "FeatureCollection",
        features: [...labelFeatures]
      }
    };
  }
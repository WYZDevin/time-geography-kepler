/**
 * Mapping for non-spatial attributes only
 * 
 * All spatial data (coordinates) must come from GeoJSON geometry, not properties.
 * This interface only handles mapping of attribute data like time, values, categories, etc.
 */
export interface AttributeMapping {
  time?: string;      // Property containing temporal data
  value?: string;     // Property containing numeric values
  category?: string;  // Property containing categories
  id?: string;        // Property containing unique identifiers
}

/**
 * Helper to safely get property value from GeoJSON feature
 * 
 * @param feature - GeoJSON feature
 * @param propertyName - Name of the property to get
 * @returns Property value or undefined if not found
 */
export function getProperty(
  feature: GeoJSON.Feature,
  propertyName?: string
): any {
  if (!propertyName || !feature.properties) {
    return undefined;
  }
  return feature.properties[propertyName];
}
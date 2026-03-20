import { AttributeMapping } from '../interfaces/attribute-mapping';

// Common field name patterns for automatic detection
const FIELD_PATTERNS = {
    longitude: [
        'longitude', 'long', 'lng', 'lon', 'x', 'lng_decimal', 'longitude_decimal',
        'coord_x', 'x_coord', 'x_coordinate', 'eastings', 'easting'
    ],
    latitude: [
        'latitude', 'lat', 'y', 'lat_decimal', 'latitude_decimal',
        'coord_y', 'y_coord', 'y_coordinate', 'northings', 'northing'
    ],
    time: [
        'time', 'timestamp', 'datetime', 'date', 'date_time', 't', 'time_stamp',
        'created_at', 'updated_at', 'recorded_at', 'observed_at', 'event_time',
        'start_time', 'end_time', 'datetime_utc', 'utc_time'
    ],
    altitude: [
        'altitude', 'alt', 'z', 'elevation', 'height', 'elev', 'z_coord',
        'z_coordinate', 'depth', 'level', 'floor'
    ]
};

/**
 * Automatically detect and map common field names
 * @param availableFields - Array of field names from the dataset
 * @returns Partial column mapping with detected fields
 */
export function autoDetectFields(availableFields: string[]): Partial<AttributeMapping> {
    const mapping: Partial<AttributeMapping> = {};
    
    // Convert field names to lowercase for case-insensitive matching
    const lowercaseFields = availableFields.map(field => field.toLowerCase());
    
    // Only auto-detect non-spatial attributes (spatial data comes from GeoJSON geometry)
    const nonSpatialPatterns = {
        time: FIELD_PATTERNS.time
    };
    
    // Auto-detect each field type
    Object.entries(nonSpatialPatterns).forEach(([fieldType, patterns]) => {
        const detectedField = findBestMatch(availableFields, lowercaseFields, patterns);
        if (detectedField) {
            mapping[fieldType as keyof AttributeMapping] = detectedField;
        }
    });
    
    return mapping;
}

/**
 * Find the best matching field name from available fields
 * @param originalFields - Original field names (with correct casing)
 * @param lowercaseFields - Field names in lowercase for matching
 * @param patterns - Array of patterns to match against
 * @returns Best matching field name or null
 */
function findBestMatch(
    originalFields: string[], 
    lowercaseFields: string[], 
    patterns: string[]
): string | null {
    // First, try exact matches
    for (const pattern of patterns) {
        const index = lowercaseFields.indexOf(pattern.toLowerCase());
        if (index !== -1) {
            return originalFields[index];
        }
    }
    
    // Then, try partial matches (field contains pattern)
    for (const pattern of patterns) {
        const index = lowercaseFields.findIndex(field => 
            field.includes(pattern.toLowerCase())
        );
        if (index !== -1) {
            return originalFields[index];
        }
    }
    
    // Finally, try reverse partial matches (pattern contains field)
    for (const pattern of patterns) {
        const index = lowercaseFields.findIndex(field => 
            pattern.toLowerCase().includes(field)
        );
        if (index !== -1) {
            return originalFields[index];
        }
    }
    
    return null;
}

/**
 * Get confidence score for field detection
 * @param fieldName - The field name to check
 * @param fieldType - The type of field (longitude, latitude, etc.)
 * @returns Confidence score between 0 and 1
 */
export function getFieldConfidence(fieldName: string, fieldType: keyof typeof FIELD_PATTERNS): number {
    if (!fieldName) return 0;
    
    const patterns = FIELD_PATTERNS[fieldType as keyof typeof FIELD_PATTERNS];
    const lowercaseField = fieldName.toLowerCase();
    
    // Exact match gets highest confidence
    if (patterns.some((pattern: string) => pattern === lowercaseField)) {
        return 1.0;
    }
    
    // Partial match gets medium confidence
    if (patterns.some((pattern: string) => lowercaseField.includes(pattern) || pattern.includes(lowercaseField))) {
        return 0.7;
    }
    
    return 0;
}

/**
 * Validate automatic field detection results
 * @param mapping - The detected mapping
 * @param availableFields - Available field names
 * @returns Validation result with suggestions
 */
export function validateAutoDetection(
    mapping: Partial<AttributeMapping>,
    _availableFields: string[]
): {
    isValid: boolean;
    suggestions: string[];
    warnings: string[];
} {
    const suggestions: string[] = [];
    const warnings: string[] = [];
    
    // AttributeMapping only handles non-spatial attributes
    // Spatial data comes from GeoJSON geometry, so no longitude/latitude validation needed
    
    // Check for time field if provided
    if (mapping.time) {
        const confidence = getFieldConfidence(mapping.time, 'time');
        if (confidence < 0.7) {
            warnings.push(`Low confidence for time mapping: "${mapping.time}"`);
        }
    }
    
    // Check for duplicate mappings
    const mappedValues = Object.values(mapping).filter(Boolean);
    const duplicates = mappedValues.filter((value, index) => 
        mappedValues.indexOf(value) !== index
    );
    
    if (duplicates.length > 0) {
        warnings.push(`Duplicate field mappings detected: ${duplicates.join(', ')}`);
    }
    
    return {
        isValid: suggestions.length === 0,
        suggestions,
        warnings
    };
} 
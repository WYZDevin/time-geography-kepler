/**
 * CSV Processing Service
 * Handles CSV parsing, coordinate detection, format conversion, and GeoJSON generation
 */

import Papa from 'papaparse';
import { FeatureCollection, GeoJSONFeature } from '../interfaces/data-interfaces';

// Coordinate field patterns
export const COORDINATE_PATTERNS = {
  longitude: [
    'longitude', 'long', 'lng', 'lon', 'x', 'lng_decimal', 'longitude_decimal',
    'coord_x', 'x_coord', 'x_coordinate', 'eastings', 'easting', 'long_dd',
    'decimal_longitude', 'decimallong', 'gps_long', 'gpslong'
  ],
  latitude: [
    'latitude', 'lat', 'y', 'lat_decimal', 'latitude_decimal',
    'coord_y', 'y_coord', 'y_coordinate', 'northings', 'northing', 'lat_dd',
    'decimal_latitude', 'decimallat', 'gps_lat', 'gpslat'
  ],
  altitude: [
    'altitude', 'alt', 'z', 'elevation', 'height', 'elev', 'z_coord',
    'z_coordinate', 'depth', 'level', 'floor'
  ]
};

export interface CSVParseResult {
  data: any[];
  headers: string[];
  rowCount: number;
  errors?: Papa.ParseError[];
}

export interface CoordinateMapping {
  longitude: string | null;
  latitude: string | null;
  altitude?: string | null;
}

export interface ConversionOptions {
  coordinateMapping: CoordinateMapping;
  skipInvalidRows?: boolean;
  includeAllProperties?: boolean;
}

/**
 * Parse CSV file
 */
export const parseCSV = (file: File): Promise<CSVParseResult> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error(`CSV parsing failed: ${results.errors[0].message}`));
          return;
        }

        resolve({
          data: results.data,
          headers: results.meta.fields || [],
          rowCount: results.data.length,
          errors: results.errors.length > 0 ? results.errors : undefined,
        });
      },
      error: (error) => {
        reject(new Error(`CSV parsing error: ${error.message}`));
      },
    });
  });
};

/**
 * Auto-detect coordinate columns
 */
export const detectCoordinateColumns = (headers: string[]): CoordinateMapping => {
  const lowercaseHeaders = headers.map(h => h.toLowerCase());

  const findMatch = (patterns: string[]): string | null => {
    // Exact match first
    for (const pattern of patterns) {
      const index = lowercaseHeaders.indexOf(pattern.toLowerCase());
      if (index !== -1) {
        return headers[index];
      }
    }

    // Partial match
    for (const pattern of patterns) {
      const index = lowercaseHeaders.findIndex(h => h.includes(pattern.toLowerCase()));
      if (index !== -1) {
        return headers[index];
      }
    }

    return null;
  };

  return {
    longitude: findMatch(COORDINATE_PATTERNS.longitude),
    latitude: findMatch(COORDINATE_PATTERNS.latitude),
    altitude: findMatch(COORDINATE_PATTERNS.altitude),
  };
};

/**
 * Convert DMS (Degrees Minutes Seconds) to decimal degrees
 * Supports formats like: "40°26'46"N", "40 26 46 N", "40°26.767'N"
 */
export const dmsToDecimal = (dmsString: string): number | null => {
  if (typeof dmsString !== 'string') return null;

  const dms = dmsString.trim();

  // Try to match DMS patterns
  // Pattern: 40°26'46"N or 40 26 46 N or 40°26.767'N
  const patterns = [
    /^(-?)(\d+)[°\s]\s*(\d+)['\s]\s*(\d+\.?\d*)["\s]\s*([NSEW]?)$/i,
    /^(-?)(\d+)[°\s]\s*(\d+\.?\d*)['\s]\s*([NSEW]?)$/i,
    /^(-?)(\d+\.?\d*)[°\s]\s*([NSEW]?)$/i,
  ];

  for (const pattern of patterns) {
    const match = dms.match(pattern);
    if (match) {
      const sign = match[1] === '-' ? -1 : 1;
      const degrees = parseFloat(match[2]);
      const minutes = match[3] ? parseFloat(match[3]) : 0;
      const seconds = match[4] && !['N', 'S', 'E', 'W'].includes(match[4].toUpperCase())
        ? parseFloat(match[4])
        : 0;
      const direction = match[match.length - 1]?.toUpperCase();

      let decimal = degrees + minutes / 60 + seconds / 3600;
      decimal *= sign;

      // Apply direction
      if (direction === 'S' || direction === 'W') {
        decimal = -Math.abs(decimal);
      }

      return decimal;
    }
  }

  return null;
};

/**
 * Parse coordinate value - handles decimal degrees, DMS, and strings
 */
export const parseCoordinate = (value: any): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Already a number
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }

  // Try to parse as decimal
  if (typeof value === 'string') {
    const trimmed = value.trim();

    // Try decimal first
    const decimal = parseFloat(trimmed);
    if (!isNaN(decimal)) {
      return decimal;
    }

    // Try DMS
    return dmsToDecimal(trimmed);
  }

  return null;
};

/**
 * Validate coordinate values
 */
export const validateCoordinates = (lng: number, lat: number): {
  valid: boolean;
  error?: string;
} => {
  if (isNaN(lng) || isNaN(lat)) {
    return { valid: false, error: 'Invalid coordinate values' };
  }

  if (lng < -180 || lng > 180) {
    return { valid: false, error: `Longitude out of range: ${lng}` };
  }

  if (lat < -90 || lat > 90) {
    return { valid: false, error: `Latitude out of range: ${lat}` };
  }

  return { valid: true };
};

/**
 * Readable-timestamp handling
 *
 * A raw Unix epoch (seconds or milliseconds) is unreadable in the data table,
 * tooltips, and the Datetime Column picker. On import we detect such columns and
 * add a human-readable sibling column so the original epoch is preserved while a
 * friendly form is also available.
 */

/** Suffix appended to a detected epoch column to hold its readable form. */
export const READABLE_SUFFIX = '_readable';

// Plausible epoch windows, restricted to years 2000–2100 so arbitrary large
// numbers (IDs, phone numbers, measurements) don't get misread as timestamps.
// The seconds and milliseconds windows are disjoint, so a value's magnitude
// alone determines its unit (mirrors the backend's seconds-vs-ms split).
const EPOCH_SECONDS_MIN = 9.46e8; // 2000-01-01
const EPOCH_SECONDS_MAX = 4.1e9; // ~2100
const EPOCH_MILLIS_MIN = 9.46e11; // 2000-01-01
const EPOCH_MILLIS_MAX = 4.1e12; // ~2100

const isEpochValue = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  ((v >= EPOCH_SECONDS_MIN && v <= EPOCH_SECONDS_MAX) ||
    (v >= EPOCH_MILLIS_MIN && v <= EPOCH_MILLIS_MAX));

/**
 * Convert a raw epoch number to a friendly UTC string: "YYYY-MM-DD HH:MM".
 * Values in the seconds window are scaled to milliseconds first. Returns null
 * for anything outside a plausible epoch range.
 */
export const epochToReadable = (value: unknown): string | null => {
  if (!isEpochValue(value)) return null;
  const ms = value <= EPOCH_SECONDS_MAX ? value * 1000 : value;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
};

/**
 * Detect columns that hold raw Unix epoch numbers. A column qualifies when it is
 * numeric and every sampled non-empty value falls in a plausible epoch range.
 * Columns named in `exclude` (e.g. mapped coordinates) and columns whose readable
 * sibling already exists are skipped.
 */
export const detectEpochColumns = (
  data: Record<string, unknown>[],
  exclude: (string | null | undefined)[] = []
): string[] => {
  if (data.length === 0) return [];
  const excluded = new Set(exclude.filter(Boolean) as string[]);
  const headers = Object.keys(data[0]);
  const existing = new Set(headers);
  const SAMPLE = 100;

  return headers.filter(header => {
    if (excluded.has(header) || header.endsWith(READABLE_SUFFIX)) return false;
    if (existing.has(header + READABLE_SUFFIX)) return false;
    let seen = 0;
    for (const row of data) {
      const v = row[header];
      if (v === null || v === undefined || v === '') continue;
      if (!isEpochValue(v)) return false;
      if (++seen >= SAMPLE) break;
    }
    return seen > 0;
  });
};

/**
 * Convert CSV data to GeoJSON
 */
export const csvToGeoJSON = (
  data: any[],
  options: ConversionOptions
): {
  featureCollection: FeatureCollection;
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    errors: string[];
  };
} => {
  const { coordinateMapping, skipInvalidRows = true, includeAllProperties = true } = options;
  const features: GeoJSONFeature[] = [];
  const errors: string[] = [];
  let validRows = 0;
  let invalidRows = 0;

  if (!coordinateMapping.longitude || !coordinateMapping.latitude) {
    throw new Error('Longitude and latitude columns must be specified');
  }

  // Columns holding raw epoch numbers get a readable sibling column added below.
  const epochColumns = detectEpochColumns(data, [
    coordinateMapping.longitude,
    coordinateMapping.latitude,
    coordinateMapping.altitude,
  ]);

  data.forEach((row, index) => {
    try {
      // Parse coordinates
      const lngValue = row[coordinateMapping.longitude!];
      const latValue = row[coordinateMapping.latitude!];
      const altValue = coordinateMapping.altitude ? row[coordinateMapping.altitude] : undefined;

      const lng = parseCoordinate(lngValue);
      const lat = parseCoordinate(latValue);

      if (lng === null || lat === null) {
        const error = `Row ${index + 1}: Invalid coordinates (lng: ${lngValue}, lat: ${latValue})`;
        errors.push(error);
        invalidRows++;

        if (!skipInvalidRows) {
          throw new Error(error);
        }
        return;
      }

      // Validate coordinates
      const validation = validateCoordinates(lng, lat);
      if (!validation.valid) {
        const error = `Row ${index + 1}: ${validation.error}`;
        errors.push(error);
        invalidRows++;

        if (!skipInvalidRows) {
          throw new Error(error);
        }
        return;
      }

      // Parse altitude if available
      const alt = altValue !== undefined ? parseCoordinate(altValue) : undefined;

      // Build coordinates array
      const coordinates: number[] = alt !== null && alt !== undefined
        ? [lng, lat, alt]
        : [lng, lat];

      // Build properties
      const properties: Record<string, any> = {};
      if (includeAllProperties) {
        Object.keys(row).forEach(key => {
          // Exclude coordinate columns from properties
          if (
            key !== coordinateMapping.longitude &&
            key !== coordinateMapping.latitude &&
            key !== coordinateMapping.altitude
          ) {
            properties[key] = row[key];
          }
        });

        // Add a readable sibling column for each raw-epoch timestamp column.
        for (const col of epochColumns) {
          const readable = epochToReadable(row[col]);
          if (readable !== null) {
            properties[col + READABLE_SUFFIX] = readable;
          }
        }
      }

      // Create feature
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties,
      });

      validRows++;
    } catch (error) {
      const errorMsg = `Row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      invalidRows++;

      if (!skipInvalidRows) {
        throw new Error(errorMsg);
      }
    }
  });

  if (features.length === 0) {
    throw new Error('No valid features could be created from the CSV data');
  }

  return {
    featureCollection: {
      type: 'FeatureCollection',
      features,
    },
    stats: {
      totalRows: data.length,
      validRows,
      invalidRows,
      errors: errors.slice(0, 10), // Limit errors shown
    },
  };
};

/**
 * Get confidence score for coordinate detection
 */
export const getCoordinateConfidence = (
  _headers: string[],
  mapping: CoordinateMapping
): {
  longitude: number;
  latitude: number;
  overall: number;
} => {
  const getScore = (fieldName: string | null, patterns: string[]): number => {
    if (!fieldName) return 0;

    const lowercase = fieldName.toLowerCase();

    // Exact match
    if (patterns.some(p => p === lowercase)) {
      return 1.0;
    }

    // Starts with pattern
    if (patterns.some(p => lowercase.startsWith(p))) {
      return 0.9;
    }

    // Contains pattern
    if (patterns.some(p => lowercase.includes(p))) {
      return 0.7;
    }

    return 0.3; // User selected but low confidence
  };

  const lngScore = getScore(mapping.longitude, COORDINATE_PATTERNS.longitude);
  const latScore = getScore(mapping.latitude, COORDINATE_PATTERNS.latitude);
  const overall = (lngScore + latScore) / 2;

  return {
    longitude: lngScore,
    latitude: latScore,
    overall,
  };
};

/**
 * Preview CSV data (first N rows)
 */
export const previewCSVData = (data: any[], limit: number = 5): any[] => {
  return data.slice(0, limit);
};

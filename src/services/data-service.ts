import { v4 as uuidv4 } from 'uuid';
import { FeatureCollection, ColumnMapping } from '../interfaces/data-interfaces';
import { DataSource, ProcessingSession } from '../stores/data-slice';
import { validateGeoJSON } from '../utils/data-utils';
import { AppDispatch } from '../stores/store';
import { 
  addDataSource, 
  startProcessingSession, 
  completeProcessingSession, 
  failProcessingSession,
  addDataRelationship 
} from '../stores/data-slice';

export class DataService {
  private dispatch: AppDispatch;

  constructor(dispatch: AppDispatch) {
    this.dispatch = dispatch;
  }

  /**
   * Upload and register a new data source
   */
  async uploadDataSource(
    name: string,
    data: FeatureCollection,
    fieldMapping?: ColumnMapping,
    tags: string[] = []
  ): Promise<string> {
    // Validate data
    if (!validateGeoJSON(data)) {
      throw new Error('Invalid GeoJSON data');
    }

    if (data.features.length === 0) {
      throw new Error('Data contains no features');
    }

    // Calculate statistics
    const statistics = this.calculateDataStatistics(data);
    
    // Create data source
    const dataSource: DataSource = {
      id: uuidv4(),
      name,
      type: 'uploaded',
      data,
      metadata: {
        uploadedAt: new Date().toISOString(),
        fieldMapping,
        statistics,
      },
      tags: [...tags, 'uploaded'],
      isActive: true,
    };

    // Add to store
    this.dispatch(addDataSource(dataSource));
    
    return dataSource.id;
  }

  /**
   * Process data with a tool and create derived data sources
   */
  async processDataWithTool(
    toolId: string,
    toolName: string,
    inputDataIds: string[],
    fieldMapping: ColumnMapping,
    options: Record<string, any>,
    processFunction: () => Promise<{ datasets: any[]; metadata?: any }>
  ): Promise<string[]> {
    const sessionId = uuidv4();
    
    // Start processing session
    this.dispatch(startProcessingSession({
      id: sessionId,
      toolId,
      toolName,
      inputDataIds,
      outputDataIds: [],
      options,
      fieldMapping,
    }));

    try {
      // Execute processing
      const result = await processFunction();
      
      // Create data sources for each output dataset
      const outputDataIds: string[] = [];
      
      for (const dataset of result.datasets) {
        const dataSource: DataSource = {
          id: dataset.id || uuidv4(),
          name: dataset.name,
          type: 'processed',
          data: dataset.data,
          metadata: {
            processedBy: toolId,
            originalSource: inputDataIds.join(','),
            fieldMapping,
            processingOptions: options,
            statistics: this.calculateDataStatistics(dataset.data),
            ...dataset.metadata,
          },
          tags: [toolId, 'processed', ...(dataset.tags || [])],
          isActive: true,
        };

        this.dispatch(addDataSource(dataSource));
        outputDataIds.push(dataSource.id);

        // Add relationships
        inputDataIds.forEach(parentId => {
          this.dispatch(addDataRelationship({ parentId, childId: dataSource.id }));
        });
      }

      // Complete session
      this.dispatch(completeProcessingSession({ sessionId, outputDataIds }));
      
      return outputDataIds;
      
    } catch (error) {
      // Fail session
      this.dispatch(failProcessingSession({ 
        sessionId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
      throw error;
    }
  }

  /**
   * Generate synthetic data for testing
   */
  async generateSyntheticData(
    type: 'trajectory' | 'points' | 'polygons',
    count: number = 100,
    name?: string
  ): Promise<string> {
    const data = this.createSyntheticData(type, count);
    const dataSourceName = name || `Synthetic ${type} (${count} features)`;
    
    return this.uploadDataSource(dataSourceName, data, undefined, ['synthetic', type]);
  }

  /**
   * Export data source to various formats
   */
  async exportDataSource(dataSourceId: string, format: 'geojson' | 'csv' | 'kml'): Promise<Blob> {
    // This would be implemented based on your export requirements
    throw new Error('Export functionality not yet implemented');
  }

  /**
   * Calculate basic statistics for a dataset
   */
  private calculateDataStatistics(data: FeatureCollection) {
    const features = data.features;
    const featureCount = features.length;
    
    if (featureCount === 0) {
      return { featureCount: 0 };
    }

    // Calculate spatial bounds
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    let hasTime = false;
    let minTime: string | undefined, maxTime: string | undefined;

    features.forEach(feature => {
      if (feature.geometry?.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }

      // Check for time fields
      const props = feature.properties || {};
      const timeFields = ['time', 'timestamp', 'datetime', 'date'];
      
      for (const field of timeFields) {
        if (props[field]) {
          hasTime = true;
          const timeStr = new Date(props[field]).toISOString();
          if (!minTime || timeStr < minTime) minTime = timeStr;
          if (!maxTime || timeStr > maxTime) maxTime = timeStr;
          break;
        }
      }
    });

    const statistics: any = {
      featureCount,
      spatialBounds: isFinite(minLat) ? { minLat, maxLat, minLng, maxLng } : undefined,
    };

    if (hasTime && minTime && maxTime) {
      statistics.temporalBounds = { start: minTime, end: maxTime };
    }

    return statistics;
  }

  /**
   * Create synthetic data for testing
   */
  private createSyntheticData(type: string, count: number): FeatureCollection {
    const features = [];
    const baseTime = new Date('2024-01-01T00:00:00Z').getTime();
    
    // San Francisco area bounds
    const bounds = {
      minLat: 37.7049,
      maxLat: 37.8049,
      minLng: -122.5149,
      maxLng: -122.3849,
    };

    for (let i = 0; i < count; i++) {
      const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
      const lng = bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng);
      const time = new Date(baseTime + i * 60000).toISOString(); // 1 minute intervals

      features.push({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat, Math.random() * 100], // Add altitude
        },
        properties: {
          id: i,
          timestamp: time,
          user_id: `user_${Math.floor(i / 10)}`,
          activity: ['walking', 'driving', 'stationary'][Math.floor(Math.random() * 3)],
          speed: Math.random() * 50,
        },
      });
    }

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  /**
   * Validate field mapping against data source
   */
  validateFieldMapping(dataSourceId: string, fieldMapping: ColumnMapping): { valid: boolean; errors: string[] } {
    // This would validate that the mapped fields exist in the data source
    // Implementation depends on your specific validation requirements
    return { valid: true, errors: [] };
  }

  /**
   * Get data source preview (first N features)
   */
  getDataPreview(dataSourceId: string, limit: number = 10): FeatureCollection | null {
    // This would return a preview of the data source
    // Implementation would get data from store and return limited features
    return null;
  }
}

// Singleton instance
let dataServiceInstance: DataService | null = null;

export const createDataService = (dispatch: AppDispatch): DataService => {
  if (!dataServiceInstance) {
    dataServiceInstance = new DataService(dispatch);
  }
  return dataServiceInstance;
};

export const getDataService = (): DataService => {
  if (!dataServiceInstance) {
    throw new Error('DataService not initialized. Call createDataService first.');
  }
  return dataServiceInstance;
};
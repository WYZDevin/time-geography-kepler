import { FeatureCollection } from './data-interfaces';
import { AttributeMapping } from './attribute-mapping';

export type ExecutionMode = 'frontend' | 'backend';
export type ExecutionPolicy = 'frontend_only' | 'backend_only' | 'hybrid';

export interface ToolCapabilities {
  executionPolicy: ExecutionPolicy;
  defaultMode?: ExecutionMode; // only for hybrid
  recommendations?: {
    frontendMaxRows?: number;
    frontendMaxFeatures?: number;
    notes?: string[];
  };
}

export interface ToolRunMeta {
  toolName: string;
  toolVersion: string;
  runAt: number; // epoch ms
  sourceDatasetIds: string[];
  params: Record<string, unknown>;
  summary: {
    inputCount: number;
    outputCount: number;
    timeRange?: { min: number; max: number };
    bbox?: [number, number, number, number];
  };
  warnings?: string[];
}

/**
 * Minimal tool interface - tools just transform GeoJSON
 */
export interface SimpleTool {
  // Identity
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'visualization' | 'analysis' | 'processing';
  version: string;

  // Execution policy declaration (required per CLAUDE.md)
  capabilities: ToolCapabilities;

  // Optional: declare what attributes this tool uses
  attributeMapping?: AttributeMapping;

  // Get the option schema for this tool
  getOptionSchema(): ToolOptionSchema[];

  // The only method that matters
  analyze(
    data: FeatureCollection,
    options: Record<string, unknown>,
    // Pass attribute mapping only if tool declares it needs it
    attributes?: AttributeMapping
  ): Promise<FeatureCollection[]>;
}

/**
 * Tool metadata for UI rendering
 */
export interface ToolMetadata {
  id: string;
  options: ToolOptionSchema[];
  requiredProperties?: string[]; // Required GeoJSON properties
}

/**
 * Schema for tool options (replaces complex validation)
 */
export interface ToolOptionSchema {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'dataset';
  required?: boolean;
  defaultValue?: unknown;
  
  // Type-specific constraints
  min?: number;              // for number type
  max?: number;              // for number type
  step?: number;             // for number type
  options?: SelectOption[];  // for select type
  placeholder?: string;      // for string type
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Simple result type
 */
export interface ToolResult {
  success: boolean;
  data?: FeatureCollection[];
  error?: string;
}
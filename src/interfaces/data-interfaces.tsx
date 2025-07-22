import { z } from "zod";

interface ColumnMapping {
    longitude: string;
    latitude: string;
    altitude?: string;
    time?: string;
}

interface GeoJSONFeature {
    type: "Feature";
    geometry: any;
    properties: {
        [key: string]: any;
    };
}


interface FeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
}

// New interfaces for toolbox structure
export interface Tool {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: 'visualization' | 'analysis' | 'processing';
    requiredFields: string[];
    optionalFields?: string[];
}

export interface ToolWorkflowState {
    selectedTool: Tool | null;
    currentStep: 'tool-selection' | 'data-upload' | 'field-mapping' | 'options' | 'visualization';
    uploadedData: FeatureCollection | null;
    fieldMapping: ColumnMapping | null;
    toolOptions: Record<string, any>;
}

// Define a schema for the form using zod
export const fileFormSchema = z.object({
    latitude: z.string().nonempty('Latitude is required'),
    longitude: z.string().nonempty('Longitude is required'),
    time: z.string().nonempty('Time is required'),
    // altitude is optional; uncomment if needed
    // altitude: z.string().optional(),
    visualizeStay: z.boolean().optional(),
    stayField: z.string().optional(),
    stayValues: z.array(z.any()).optional(),
    visualizeSTKDE: z.boolean().optional(),
    visualizeAxis: z.boolean().optional(),
});

interface FileFormValues extends z.infer<typeof fileFormSchema> {}

  
  
export type { ColumnMapping, GeoJSONFeature, FeatureCollection, FileFormValues };
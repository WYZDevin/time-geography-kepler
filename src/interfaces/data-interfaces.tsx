import { z } from "zod";
import { SimpleTool } from "./simple-tool";
import { AttributeMapping } from "./attribute-mapping";

// GeoJSON interfaces
interface GeoJSONFeature {
    type: "Feature";
    geometry: any;
    properties: {
        [key: string]: any;
    } | null;
}

interface FeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
}

// Simplified tool workflow state using SimpleTool
export interface ToolWorkflowState {
    selectedTool: SimpleTool | null;
    currentStep: 'tool-selection' | 'data-upload' | 'field-mapping' | 'options' | 'visualization';
    uploadedData: FeatureCollection | null;
    attributeMapping: AttributeMapping | null;
    toolOptions: Record<string, any>;
}

// Define a schema for the form using zod
export const fileFormSchema = z.object({
    time: z.string().nonempty('Time field is required'),
    visualizeStay: z.boolean().optional(),
    stayField: z.string().optional(),
    stayValues: z.array(z.any()).optional(),
    visualizeSTKDE: z.boolean().optional(),
    visualizeAxis: z.boolean().optional(),
});

interface FileFormValues extends z.infer<typeof fileFormSchema> {}

export type { GeoJSONFeature, FeatureCollection, FileFormValues };
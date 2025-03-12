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

// Define a schema for the form using zod
export const fileFormSchema = z.object({
    latitude: z.string().nonempty('Latitude is required'),
    longitude: z.string().nonempty('Longitude is required'),
    time: z.string().nonempty('Time is required'),
    // altitude is optional; uncomment if needed
    // altitude: z.string().optional(),
    visualizeActivitySpace: z.boolean().optional(),
    activitySpaceField: z.string().optional(),
    activitySpaceValues: z.array(z.any()).optional(),
});

interface FileFormValues extends z.infer<typeof fileFormSchema> {}

  
  
export type { ColumnMapping, GeoJSONFeature, FeatureCollection, FileFormValues };
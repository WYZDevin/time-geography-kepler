import store from "@/stores/store";
import { addDataToMap } from '@kepler.gl/actions';

import { updateMap } from '@kepler.gl/actions';
import { ColumnMapping, FeatureCollection, FileFormValues } from "@/interfaces/data-interfaces";
import { createCustomConfigActivitySpace, createCustomConfigAquarim, createCustomLineLayer, createCustomConfigAxisLine, createCustomConfigAxisLabel } from "../utils/config";
// import { PROCESSED_TIME_FIELD } from "../utils/constants";
import { preprocessGeojsonData } from "@/data-processors/data-preprocessing";
import { createRawConvexHullGeojson } from "./convex-hull";
import { createStayArea } from "./activity-space";
import { createSTKDE } from "./stkde";
import { progressService } from "@/components/custom-components/progress-bar";
import * as turf from "@turf/turf";
import { createAxisData } from "./axis";
import { selectSideLength } from "@/stores/metadata-slice";

/** 
 * Finds the coordinate and time columns in the feature names
 * @param featureNames - The names of the features in the file
 * @returns The longitude, latitude, altitude, and time columns
 */
const findCoordinateAndTimeColumns = (fields: string[]): ColumnMapping => {
    // const featureNames = fields.map((f: Field) => f.name);
    const featureNames = fields;
    // Regular expressions for matching common coordinate column names
    const longitudePatterns = [/lon/i, /lng/i, /longitude/i, /^x$/i];
    const latitudePatterns = [/lat/i, /latitude/i, /^y$/i];
    const altitudePatterns = [/alt/i, /elev/i, /elevation/i, /^z$/i];

    // Regular expressions for matching common time column names
    const timePatterns = [/time/i, /date/i, /timestamp/i, /datetime/i];

    // Find the first matching column for each type
    const longitude = featureNames.find(name =>
        longitudePatterns.some(pattern => pattern.test(name))
    );
    const latitude = featureNames.find(name =>
        latitudePatterns.some(pattern => pattern.test(name))
    );
    const altitude = featureNames.find(name =>
        altitudePatterns.some(pattern => pattern.test(name))
    );
    const time = featureNames.find(name =>
        timePatterns.some(pattern => pattern.test(name))
    );

    return { longitude: longitude || '', latitude: latitude || '', altitude: altitude || '', time: time || '' };
}


const getZoom = (data: FeatureCollection) => {

    // Calculate bounds from data points
    const lngs = data.features.map((f: any) => f.geometry.coordinates[0]);
    const lats = data.features.map((f: any) => f.geometry.coordinates[1]);

    const minLat = Math.min(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const maxLat = Math.max(...lats);

    // Calculate zoom level to fit the bounds
    const latDiff = maxLat - minLat;
    const lngDiff = maxLng - minLng;
    const zoom = Math.min(
        Math.floor(Math.log2(360 / latDiff)),
        Math.floor(Math.log2(360 / lngDiff))
    );

    return zoom;
}


const addDataToKeplerWithTime = async (
    data: FeatureCollection, 
    fileFormValues: FileFormValues
) => {
    let processedSTKDEDatas: ProcessorResult[] = [];
    let processedAxisData: {
        axisFeatures: ProcessorResult,
        labelFeatures: ProcessorResult
    } | null = null;
    let processedTrajectoryData: ProcessorResult | null = null;
    let processedConvexHullData: ProcessorResult | null = null;
    let processedStayData: ProcessorResult | null = null;

    const zoom = getZoom(data) - 5; // Add 1 to zoom in closer to the data

    // Step 1: preprocess trajectory data
    progressService.update("Preparing Data");
    const preprocessedTrajectoryData = preprocessGeojsonData(data);
    processedTrajectoryData = processGeojson(preprocessedTrajectoryData);

    // Sleep for 1 second
    // await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 2: create convex hull data
    progressService.update("Creating Convex Hull");
    const convexHullData = createRawConvexHullGeojson(preprocessedTrajectoryData);
    processedConvexHullData = processGeojson(convexHullData);

    // Sleep for 1 second
    // await new Promise(resolve => setTimeout(resolve, 1000));

    // (Optional) Step 3: create stay area data
    let stayData: FeatureCollection | null = null;
    if (fileFormValues.visualizeStay) {
        progressService.update("Creating Stay Area");
        const stayValues = fileFormValues.stayValues?.map((obj: any) => obj.value);
        stayData = createStayArea(preprocessedTrajectoryData, stayValues!, fileFormValues.stayField!);
        processedStayData = processGeojson(stayData);
        // Sleep for 1 second
        // await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // (Optional) Step 4: create STKDE data
    let stkdeData: FeatureCollection[] | null = null;
    if (fileFormValues.visualizeSTKDE) {
        progressService.update("Creating STKDE");
        stkdeData = await createSTKDE(preprocessedTrajectoryData, fileFormValues.time!) as FeatureCollection[];
        processedSTKDEDatas = stkdeData ? stkdeData.map((data) => processGeojson(data as GeoJSON.FeatureCollection)) : [];
        console.log("Processed STKDE Data", processedSTKDEDatas);
    }

    // (Optional) Step 5: create axis data
    if (fileFormValues.visualizeAxis) {
        progressService.update("Creating Coordinate Axes");
        // Get the bounding box of the data
        const bbox = turf.bbox(preprocessedTrajectoryData);
        // Get the maximum height from the data
        const maxHeight = selectSideLength(store.getState());
        // Create axis visualization
        const axisData = createAxisData(bbox, maxHeight);
        processedAxisData = {
            axisFeatures: processGeojson(axisData.axisFeatures),
            labelFeatures: processGeojson(axisData.labelFeatures)
        };
    }

    // Post process to load data into kepler
    const customConfigConvexHull = createCustomConfigAquarim('my-convex-hull', true, "Space Time Aquarium");
    const customStayArea = createCustomConfigActivitySpace('my-stay-area', false, "Stay Area");
    const customConfigLine = createCustomLineLayer(fileFormValues.latitude, fileFormValues.longitude);
    const customConfigAxis = createCustomConfigAxisLine('my-axis', false, "Coordinate Axes");
    const customConfigAxisLabel = createCustomConfigAxisLabel('my-axis-labels', false, "Coordinate Axes");
    const customConfigSTKDE99 = createCustomConfigSTKDE('my-stkde-class3', false, "STKDE 99%", 99, 0.3);  // Highest transparency
    const customConfigSTKDE95 = createCustomConfigSTKDE('my-stkde-class2', false, "STKDE 95%", 95, 0.8);  // Strongest color
    const customConfigSTKDE90 = createCustomConfigSTKDE('my-stkde-class1', false, "STKDE 90%", 90, 0.6);  // Medium transparency

    // add points data to kepler
    store.dispatch(addDataToMap({
        datasets: [{
            info: {
                id: 'myData',
                label: 'myData',
            },
            data: processedTrajectoryData as any
        },
        {
            info: {
                id: 'my-convex-hull',
                label: 'convexHll',
            },
            data: processedConvexHullData as any
        },
        ...(processedSTKDEDatas.length > 0 ? processedSTKDEDatas.map((data, index) => ({
            info: {
                id: `my-stkde-class${index + 1}`,
                label: `stkde class ${index + 1}`,
            },
            data: processedSTKDEDatas[index] as any
        })) : []),
        ...(processedAxisData ? [{
            info: {
                id: 'my-axis',
                label: 'Coordinate Axes',
            },
            data: processedAxisData.axisFeatures as any
        }] : []),
        ...(processedAxisData ? [{
            info: {
                id: 'my-axis-labels',
                label: 'Axis Labels',
            },
            data: processedAxisData.labelFeatures as any
        }] : []),
        ...(stayData ? [{
            info: {
                id: 'my-stay-area',
                label: 'stay area',
            },
            data: processedStayData as any
        }] : [])],
        options: { centerMap: true, readOnly: false },
        config: {
            visState: {
                layers: [
                    customStayArea as any,
                    customConfigLine as any,
                    customConfigConvexHull as any,
                    customConfigAxis as any,
                    customConfigAxisLabel as any,
                    customConfigSTKDE99 as any,
                    customConfigSTKDE95 as any,
                    customConfigSTKDE90 as any,
                ]
            },
            mapStyle: {
                "styleType": "positron",
                "topLayerGroups": {},
                "visibleLayerGroups": {
                    "label": true,
                    "road": true,
                    "border": false,
                    "building": true,
                    "water": true,
                    "land": true,
                    "3d building": false
                },
                "threeDBuildingColor": [
                    233.71862868880427, 230.92517894351974, 226.26942936804556
                ],
                "mapStyles": {}
            }
        },
        
    }))

    console.log("Zoom", zoom);
    store.dispatch(updateMap({
        pitch: 45,
        bearing: 0,
        dragRotate: true,
        // zoom: 10// Subtract 3 to give some padding
    }));

    console.log("Data added to Kepler");            
};

export { addDataToKeplerWithTime, findCoordinateAndTimeColumns };
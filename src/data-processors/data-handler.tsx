import store from "../store";
import { addDataToMap } from '@kepler.gl/actions';

import { processGeojson } from '@kepler.gl/processors';
import { updateMap } from '@kepler.gl/actions';
import { ColumnMapping, FeatureCollection, FileFormValues } from "@/interfaces/data-interfaces";
import { createCustomConfigActivitySpace, createCustomConfigAquarim, createCustomConfigPoints, createCustomConfigSTKDE, createCustomLineLayer } from "../utils/config";
import { PROCESSED_ALTITUDE_FIELD } from "../utils/constants";
import { preprocessGeojsonData } from "@/data-processors/data-preprocessing";
import { Field } from "@kepler.gl/types";
import { createRawConvexHullGeojson } from "./convex-hull";
import { createStayArea } from "./activity-space";
import { createSTKDE, STKDEResult } from "./stkde";

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


const addDataToKeplerWithTime = async (data: FeatureCollection, fileFormValues: FileFormValues) => {

    const zoom = getZoom(data);
    const preprocessedData = preprocessGeojsonData(data);
    
    // create convex hull data
    const convexHullData = createRawConvexHullGeojson(preprocessedData);

    let stayData: FeatureCollection | null = null;
    if (fileFormValues.visualizeStay) {
        const stayValues = fileFormValues.stayValues?.map((obj: any) => obj.value);
        stayData = createStayArea(preprocessedData, stayValues!, fileFormValues.stayField!);
    }

    let stkdeData: any[] | null = null;
    if (fileFormValues.visualizeSTKDE) {
        stkdeData = await createSTKDE(preprocessedData, fileFormValues.time!);
    }
    const customConfigConvexHull = createCustomConfigAquarim('my-convex-hull', true, "Space Time Aquarium");
    const customStayArea = createCustomConfigActivitySpace('my-stay-area', false, "Stay Area");
    const customConfigLine = createCustomLineLayer(fileFormValues.latitude, fileFormValues.longitude);

    const customConfigSTKDE99 = createCustomConfigSTKDE('my-stkde-class3', false, "STKDE 99", 99, 1);
    const customConfigSTKDE95 = createCustomConfigSTKDE('my-stkde-class2', false, "STKDE 95", 95, 0.1);
    const customConfigSTKDE90 = createCustomConfigSTKDE('my-stkde-class1', false, "STKDE 90", 90, 0.01);

    
    // post process to load data into kepler
    const processedLineData = processGeojson(preprocessedData);
    const processedConvexHullData = processGeojson(convexHullData);
    const processedSTKDEDatas = stkdeData ? stkdeData.map((data) => processGeojson(data as FeatureCollection)) : [];

    let processedStayData = null;
    if (stayData) {
        processedStayData = processGeojson(stayData);
    }

    // add points data to kepler
    store.dispatch(addDataToMap({
        datasets: [{
            info: {
                id: 'myData',
                label: 'myData',
            },
            data: processedLineData as any
        },
        {
            info: {
                id: 'my-convex-hull',
                label: 'convexHull',
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

    store.dispatch(updateMap({
        pitch: 45,
        bearing: 0,
        dragRotate: true,
        zoom: zoom - 3 // Subtract 1 to give some padding
    }));






};

export { addDataToKeplerWithTime, findCoordinateAndTimeColumns };
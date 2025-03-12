import { FeatureCollection, GeoJSONFeature } from "@/interfaces/data-interfaces";
import { PROCESSED_ALTITUDE_FIELD } from "@/utils/constants";
import { createRawConvexHullGeojson } from "./convex-hull";

interface ActivitySpaceSegment {
    startHeight: number;
    endHeight: number;
    features: GeoJSONFeature[];
}

const getStaySegments = (data: FeatureCollection, activitySpaceValues: string [], activitySpaceField: string) => {

    const activitySpaceSegments: ActivitySpaceSegment[] = [];
    let currentSegment: GeoJSONFeature[] = [];
    let hasActiveActivitySpace = false;
    let startHeight = -1;
    let endHeight = -1;

    data.features.forEach((feature) => {

        const isCurrentFeatureActivitySpace = activitySpaceValues.includes(feature.properties[activitySpaceField]);
        // console.log(feature.properties[activitySpaceField], activitySpaceValues);
        // case 1: the current feature is part of the activity space and hasActiveActivitySpace is false
        if (isCurrentFeatureActivitySpace && !hasActiveActivitySpace) {
            currentSegment.push(feature);
            hasActiveActivitySpace = true;
            startHeight = feature.properties[PROCESSED_ALTITUDE_FIELD];
        } else if (isCurrentFeatureActivitySpace && hasActiveActivitySpace) {
            currentSegment.push(feature);
        } else if (!isCurrentFeatureActivitySpace && hasActiveActivitySpace) {
            endHeight = feature.properties[PROCESSED_ALTITUDE_FIELD];
            hasActiveActivitySpace = false;
            activitySpaceSegments.push({
                startHeight,
                endHeight,
                features: currentSegment
            });
            // reset the start and end heights and the current segment
            startHeight = -1;
            endHeight = -1;
            currentSegment = [];
        }
    })

    return activitySpaceSegments;
}

const mergeConvexHulls = (convexHulls: FeatureCollection[]) => {
    return convexHulls.reduce((merged, current) => {
        return {
            type: 'FeatureCollection',
            features: [...merged.features, ...current.features]
        }
    });
}

const createStayArea = (data: FeatureCollection, activitySpaceValues: string [], activitySpaceField: string) => {

    const activitySpaceSegments: ActivitySpaceSegment[] = getStaySegments(data, activitySpaceValues, activitySpaceField);

    // create convex hull for each segment
    const activitySpaceConvexHulls: FeatureCollection[] = activitySpaceSegments.map((segment) => {
        const sampleFeatureCollection: FeatureCollection = {
            type: 'FeatureCollection',
            features: segment.features
        }
        return createRawConvexHullGeojson(sampleFeatureCollection, segment.startHeight, segment.endHeight);
    });

    console.log(activitySpaceConvexHulls);

    // merge all convex hulls
    const mergedConvexHulls = mergeConvexHulls(activitySpaceConvexHulls);

    return mergedConvexHulls;
}

export { createStayArea };
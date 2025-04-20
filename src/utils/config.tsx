import { useColor } from "@/contexts/color-context";
import { selectHeightScale } from "@/stores/metadata-slice";
import store from "@/stores/store";
import { PROCESSED_NEIGHBORS_FIELD, PROCESSED_TIME_FIELD, SCALE_FACTOR, COLORS, PROCESSED_HEIGHT_FIELD } from "@/utils/constants";


export const createCustomLineLayer = (latField: string, longField: string) => {
    const heightScale = selectHeightScale(store.getState());
    return {
        id: 'my-line-layer',
        type: 'line',
        config: {
            dataId: 'myData',
            label: 'Custom Line',
            columnMode: 'neighbors',
            color: COLORS.LINE,
            columns: {
                lat: latField,
                lng: longField,
                neighbors: PROCESSED_NEIGHBORS_FIELD,
                alt: PROCESSED_TIME_FIELD
            },
            isVisible: true,
            visConfig: {
                opacity: 0.8,
                strokeOpacity: 0.8,
                thickness: 3.2,
                radius: 10,
                sizeRange: [0, 10],
                radiusRange: [0, 50],
                elevationScale: heightScale,
                stroked: true,
                filled: true,
                enable3d: true,
                wireframe: false,
                fixedHeight: false
            }
        }
    }
}


export const createCustomConfigPoints = (latField: string, longField: string, timeField: string | undefined) => {
    return {
        visState: {
            layers: [
                {
                    id: 'my-single-layer',
                    type: 'point',
                    config: {
                        dataId: 'myData',
                        label: 'Custom Points',
                        columns: {
                            lat: latField,
                            lng: longField,
                            altitude: timeField
                        },
                        isVisible: true,
                        visConfig: {
                            opacity: 0.8,
                            radius: 10,

                        }
                    }
                }
            ]
        }
    }
}

export const createCustomConfigActivitySpace = (dataId: string, hidden: boolean = false, label: string = "new layer") => {
    return {
        type: "geojson",
        config: {
            "dataId": dataId,
            "columnMode": "geojson",
            "label": label,
            "columns": { "geojson": "_geojson" },
            "isVisible": !hidden,
            "color": COLORS.ACTIVITY_SPACE,
            "visConfig": {
                "opacity": 0.8,
                "strokeOpacity": 0.8,
                "thickness": 0.5,
                "radius": 10,
                "sizeRange": [0, 10],
                "radiusRange": [0, 50],
                "heightRange": [0, 500],
                "elevationScale": 1,
                "stroked": true,
                "filled": true,
                "enable3d": true,
                "wireframe": false,
                "fixedHeight": true
            },
            "hidden": false,
            // height field should be here to be able to work
            "heightField": {
                "name": PROCESSED_TIME_FIELD,
                "type": "integer"
            }
        },
        visualChannels: {
            "heightScale": "linear",
            // "heightField": {
            //     "name": PROCESSED_ALTITUDE_FIELD,
            //     "type": "integer"
            // },
            "colorField": null,
            "colorScale": "quantile",
            "strokeColorField": null,
            "strokeColorScale": "quantile",
            "sizeField": null,
            "sizeScale": "linear"
        }

    }
}

export const createCustomConfigAquarim = (dataId: string, hidden: boolean = false, label: string = "new layer") => {
    const heightScale = selectHeightScale(store.getState());
    return {
        type: "geojson",
        config: {
            "dataId": dataId,
            "columnMode": "geojson",
            "label": label,
            "columns": { "geojson": "_geojson" },
            "isVisible": !hidden,
            "color": COLORS.AQUARIUM,
            "visConfig": {
                "opacity": 0.1,
                "strokeOpacity": 0.8,
                "thickness": 0.5,
                "radius": 10,
                "sizeRange": [0, 10],
                "radiusRange": [0, 50],
                "heightRange": [0, 500],
                "elevationScale": heightScale,
                "stroked": true,
                "filled": true,
                "enable3d": true,
                "wireframe": false,
                "fixedHeight": true
            },
            "hidden": false,
            // height field should be here to be able to work
            "heightField": {
                "name": PROCESSED_TIME_FIELD,
                "type": "integer"
            }
        },
        visualChannels: {
            "heightScale": "linear",
            // "heightField": {
            //     "name": PROCESSED_ALTITUDE_FIELD,
            //     "type": "integer"
            // },
            "colorField": null,
            "colorScale": "quantile",
            "strokeColorField": null,
            "strokeColorScale": "quantile",
            "sizeField": null,
            "sizeScale": "linear"
        }

    }
}

export const createCustomConfigSTKDE = (
    dataId: string,
    hidden: boolean = false,
    label: string = "new layer",
    percent: number = 99,
    opacity: number = 0.8) => {
    const color = percent === 99 ? COLORS.STKDE_99 : percent === 95 ? COLORS.STKDE_95 : COLORS.STKDE_90;
    return {
        type: "geojson",
        config: {
            "dataId": dataId,
            "columnMode": "geojson",
            "label": label,
            "columns": { "geojson": "_geojson" },
            "isVisible": !hidden,
            "color": color,
            "visConfig": {
                "opacity": opacity,
                "strokeOpacity": 0.8,
                "thickness": 0.5,
                "radius": 10,
                "sizeRange": [0, 10],
                "radiusRange": [0, 50],
                "heightRange": [0, 500],
                "elevationScale": 1,
                "stroked": true,
                "filled": true,
                "enable3d": true,
                "wireframe": false,
                "fixedHeight": true
            },
            "hidden": false,
            // height field should be here to be able to work
            "heightField": {
                "name": PROCESSED_HEIGHT_FIELD,
                "type": "float"
            }
        },
        visualChannels: {
            "heightScale": "linear",
            "colorField": null,
            "colorScale": "quantile",
            "strokeColorField": null,
            "strokeColorScale": "quantile",
            "sizeField": null,
            "sizeScale": "linear"
        }

    }
}

export const createCustomConfigAxisLine = (
    dataId: string,
    hidden: boolean = false,
    label: string = "Coordinate Axes"
    ) => {
    return {
        type: "geojson",
        config: {
            "dataId": dataId,
            "columnMode": "geojson",
            "label": label,
            "columns": { "geojson": "_geojson" },
            "isVisible": !hidden,
            "color": [183, 136, 94],
            "highlightColor": [252, 242, 26, 255],
            "visConfig": {
                "opacity": 0.8,
                "strokeOpacity": 0.8,
                "thickness": 0.5,
                "strokeColor": [255, 203, 153],
                "radius": 10,
                "sizeRange": [0, 10],
                "radiusRange": [0, 50],
                "heightRange": [0, 500],
                "elevationScale": 1,
                "stroked": true,
                "filled": true,
                "enable3d": true,
                "wireframe": false,
                "fixedHeight": true
            },
            "hidden": false,
            "heightField": {
                "name": PROCESSED_HEIGHT_FIELD,
                "type": "float"
            },
        },
        visualChannels: {
            "heightScale": "linear"
        }
    }
}

export const createCustomConfigAxisLabel = (
    dataId: string,
    hidden: boolean = false,
    label: string = "Coordinate Axes"
) => {
    return {
        type: "point",
        config: {
            "dataId": dataId,
            "columnMode": "points",
            "label": label,
            "color": [221, 178, 124],
            "highlightColor": [252, 242, 26, 255],
            "columns": {
                "lat": "latitude",
                "lng": "longitude",
                "altitude": PROCESSED_HEIGHT_FIELD
            },
            "isVisible": !hidden,
            "visConfig": {
                "radius": 10,
                "fixedRadius": false,
                "opacity": 0.8,
                "outline": false,
                "thickness": 2,
                "strokeColor": null,
                "radiusRange": [0, 50],
                "filled": true,
                "billboard": false,
                "allowHover": true,
                "showNeighborOnHover": false,
                "showHighlightColor": true
            },
            "hidden": false,
            "textLabel": [
                {
                    "field": { "name": "text", "type": "string" },
                    "color": [218, 0, 0],
                    "size": 18,
                    "offset": [0, 0],
                    "anchor": "end",
                    "alignment": "center",
                    "outlineWidth": 0,
                    "outlineColor": [255, 0, 0, 255],
                    "background": false,
                    "backgroundColor": [0, 0, 200, 255]
                }
            ]
        },
    }
}


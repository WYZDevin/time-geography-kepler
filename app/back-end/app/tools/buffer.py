import geopandas as gpd
import numpy as np
from shapely.ops import unary_union

from .base import BaseTool

UNIT_TO_METERS = {
    "meters": 1.0,
    "kilometers": 1000.0,
    "feet": 0.3048,
    "miles": 1609.344,
}


class BufferTool(BaseTool):
    @property
    def id(self) -> str:
        return "buffer-analysis"

    @property
    def name(self) -> str:
        return "Buffer Analysis"

    @property
    def description(self) -> str:
        return "Create buffer zones around geometries"

    def execute(self, gdf, options, attributes):
        if gdf.empty:
            raise ValueError("No features provided for buffer analysis")

        distance = options.get("bufferDistance", 100)
        units = options.get("units", "meters")
        dissolve = options.get("dissolve", False)
        steps = options.get("steps", 16)

        factor = UNIT_TO_METERS.get(units, 1.0)
        distance_m = distance * factor

        # Project to UTM for accurate metric buffering
        utm_crs = gdf.estimate_utm_crs()
        gdf_utm = gdf.to_crs(utm_crs)

        gdf_utm["geometry"] = gdf_utm.geometry.buffer(distance_m, resolution=steps)

        result = gdf_utm.to_crs(epsg=4326)

        # Preserve original feature id
        result["_buffer_distance"] = distance
        result["_buffer_units"] = units
        result["_original_feature_id"] = np.arange(len(result))

        if dissolve:
            merged = unary_union(result.geometry)
            result = gpd.GeoDataFrame(
                {
                    "_buffer_distance": [distance],
                    "_buffer_units": [units],
                    "_dissolved": [True],
                    "_original_feature_count": [len(gdf)],
                },
                geometry=[merged],
                crs="EPSG:4326",
            )

        return [result]

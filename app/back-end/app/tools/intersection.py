from datetime import UTC, datetime

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon

from .base import BaseTool

_POLYGON_TYPES = (Polygon, MultiPolygon)


class IntersectionTool(BaseTool):
    @property
    def id(self) -> str:
        return "intersection-analysis"

    @property
    def name(self) -> str:
        return "Intersection Analysis"

    @property
    def description(self) -> str:
        return "Compute pairwise intersections of polygon features"

    def execute(self, gdf, options, attributes):
        # Filter to polygons only
        mask = gdf.geometry.apply(lambda g: isinstance(g, _POLYGON_TYPES))
        polys = gdf[mask].reset_index(drop=True)

        if len(polys) < 2:
            raise ValueError("Intersection requires at least 2 polygon features")
        if len(polys) > 100:
            raise ValueError("Intersection limited to 100 polygons maximum")

        preserve = options.get("preserveProperties", False)
        now = datetime.now(UTC).isoformat()

        results = []
        for i in range(len(polys)):
            for j in range(i + 1, len(polys)):
                geom_a = polys.geometry.iloc[i]
                geom_b = polys.geometry.iloc[j]
                inter = geom_a.intersection(geom_b)
                if inter.is_empty:
                    continue

                props = {
                    "_intersection_operation": "pairwise",
                    "_feature_pair": f"{i},{j}",
                    "_operation_timestamp": now,
                }
                if preserve:
                    props["feature_a_props"] = {
                        k: v for k, v in polys.iloc[i].drop("geometry").items()
                    }
                    props["feature_b_props"] = {
                        k: v for k, v in polys.iloc[j].drop("geometry").items()
                    }

                results.append({"geometry": inter, **props})

        if not results:
            return [gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")]

        geoms = [r.pop("geometry") for r in results]
        result_gdf = gpd.GeoDataFrame(results, geometry=geoms, crs="EPSG:4326")
        return [result_gdf]

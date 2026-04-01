from datetime import UTC, datetime

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

from .base import BaseTool

_POLYGON_TYPES = (Polygon, MultiPolygon)


class UnionTool(BaseTool):
    @property
    def id(self) -> str:
        return "union-analysis"

    @property
    def name(self) -> str:
        return "Union Analysis"

    @property
    def description(self) -> str:
        return "Merge polygon features into a single geometry"

    def execute(self, gdf, options, attributes):
        mask = gdf.geometry.apply(lambda g: isinstance(g, _POLYGON_TYPES))
        polys = gdf[mask].reset_index(drop=True)

        if polys.empty:
            raise ValueError("No polygon features provided for union")

        now = datetime.now(UTC).isoformat()
        merged = unary_union(polys.geometry)

        props = {
            "_union_operation": "unary_union",
            "_original_feature_count": len(polys),
            "_operation_timestamp": now,
        }

        if options.get("preserveProperties", False):
            for idx, row in polys.iterrows():
                props[f"feature_{idx}_props"] = {k: v for k, v in row.drop("geometry").items()}

        result = gpd.GeoDataFrame([props], geometry=[merged], crs="EPSG:4326")
        return [result]

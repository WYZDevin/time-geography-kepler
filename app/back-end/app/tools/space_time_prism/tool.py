import logging
from typing import Any

import geopandas as gpd

from app.models import SpaceTimePrismOptions
from ..base import BaseTool
from .interactive import execute_anchor_prism, execute_interactive_prism
from .pasta_execution import execute_pasta
from .timing import timed

logger = logging.getLogger(__name__)


class SpaceTimePrismTool(BaseTool):
    @property
    def id(self) -> str:
        return "space-time-prism"

    @property
    def name(self) -> str:
        return "Space-Time Prism"

    @property
    def description(self) -> str:
        return "Compute explanatory prisms and PASTA potential dwell-time surfaces"

    def execute(
        self,
        gdf: gpd.GeoDataFrame,
        options: dict[str, Any],
        attributes: dict[str, Any],
    ) -> list[gpd.GeoDataFrame]:
        opts = SpaceTimePrismOptions.model_validate(options)
        analysis_mode = opts.analysisMode or opts.prismAnalysisMode or "interactive"
        # Private methods retain raw dict access — they have many spread options.get() calls
        logger.info("space-time-prism: starting '%s' mode (prismMode=%s)",
                    analysis_mode, options.get("prismMode", "euclidean"))
        with timed(f"space-time-prism: TOTAL ({analysis_mode})"):
            if analysis_mode == "pasta":
                return self._execute_pasta(gdf, options, attributes)
            return self._execute_interactive_prism(gdf, options, attributes)

    def _execute_interactive_prism(self, gdf: gpd.GeoDataFrame, options: dict[str, Any], attributes: dict[str, Any]) -> list[gpd.GeoDataFrame]:
        return execute_interactive_prism(gdf, options, attributes)

    def _execute_anchor_prism(self, anchor_a: dict, anchor_b: dict, options: dict[str, Any], gdf: gpd.GeoDataFrame | None = None, time_field: str | None = None) -> list[gpd.GeoDataFrame]:
        return execute_anchor_prism(anchor_a, anchor_b, options, gdf, time_field)

    def _execute_pasta(self, gdf: gpd.GeoDataFrame, options: dict[str, Any], attributes: dict[str, Any]) -> list[gpd.GeoDataFrame]:
        return execute_pasta(gdf, options, attributes)

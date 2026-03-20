from abc import ABC, abstractmethod

import geopandas as gpd


class BaseTool(ABC):
    @property
    @abstractmethod
    def id(self) -> str: ...

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def description(self) -> str: ...

    @property
    def version(self) -> str:
        return "1.0.0"

    @property
    def execution_policy(self) -> str:
        return "hybrid"

    @abstractmethod
    def execute(
        self,
        gdf: gpd.GeoDataFrame,
        options: dict,
        attributes: dict,
    ) -> list[gpd.GeoDataFrame]:
        """Run the tool and return a list of result GeoDataFrames."""
        ...

    def metadata(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "executionPolicy": self.execution_policy,
        }

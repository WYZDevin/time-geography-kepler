from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Shared attribute mapping (field selector from frontend)
# ---------------------------------------------------------------------------

class AttributeMapping(BaseModel):
    model_config = ConfigDict(extra="ignore")
    time: str | None = None


# ---------------------------------------------------------------------------
# Per-tool options models
# ---------------------------------------------------------------------------

class BufferOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    bufferDistance: float = 100.0
    units: Literal["meters", "kilometers", "feet", "miles"] = "meters"
    dissolve: bool = False
    steps: int = 16


class UnionOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    preserveProperties: bool = False


class IntersectionOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    preserveProperties: bool = False


class TimeGeographyOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    visualizeStay: bool = False
    stayField: str = ""
    stayDistanceThreshold: float = 100.0
    timeWindow: int = 300_000


class STKDEOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    spatialBandwidth: float | None = None
    temporalBandwidth: float | None = None
    nTimeSlices: int = 10


class SpaceTimeCubeOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    cellSize: float | None = None
    timeSlices: int = 10
    envField: str | None = None  # pre-joined exposure field on trajectory (e.g. 'env_exposure')
    userIdField: str | None = None  # column identifying each trajectory/user
    alignUserTime: bool = False  # measure time elapsed from each trajectory's own start


class SpaceTimePrismOptions(BaseModel):
    # extra="allow" keeps _anchorA, _anchorB and PASTA-mode fields accessible
    # via model_extra for the private methods that still use raw dicts
    model_config = ConfigDict(extra="allow")
    analysisMode: str = "interactive"
    prismAnalysisMode: str | None = None
    speedMode: str = "walking"
    customSpeed: float = 5.0
    timeSlices: int = 10
    showPPA: bool = True


class RoadNetworkSTPOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    speedMode: str = "walking"
    customSpeed: float = 5.0       # km/h, used when speedMode="custom"
    bufferMeters: float = 100.0    # fallback corridor width when PPA degenerates
    metricCrs: str | None = None
    roadNetworkPath: str | None = None
    roadNetworkData: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Tool metadata
# ---------------------------------------------------------------------------

class ToolMetadata(BaseModel):
    id: str
    name: str
    description: str
    version: str
    executionPolicy: str


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------

class ExecuteRequest(BaseModel):
    data: dict[str, Any] = Field(
        default_factory=lambda: {"type": "FeatureCollection", "features": []}
    )
    options: dict[str, Any] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)
    sourceDatasetIds: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Response components
# ---------------------------------------------------------------------------

class ExecutionMetadata(BaseModel):
    executionTime: int
    featureCount: int
    timestamp: str


class RunSummary(BaseModel):
    inputCount: int
    outputCount: int
    bbox: list[float] | None


class RunMeta(BaseModel):
    toolName: str
    toolVersion: str
    runAt: int
    sourceDatasetIds: list[str]
    params: dict[str, Any]
    summary: RunSummary
    warnings: list[str]


# ---------------------------------------------------------------------------
# Top-level responses
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    version: str


class ListToolsResponse(BaseModel):
    tools: list[ToolMetadata]


class ExecuteResponse(BaseModel):
    success: bool
    toolId: str
    outputs: list[dict[str, Any]]
    metadata: ExecutionMetadata
    runMeta: RunMeta


class ErrorResponse(BaseModel):
    success: bool = False
    toolId: str | None = None
    error: str
    outputs: list[dict[str, Any]] = Field(default_factory=list)
    metadata: ExecutionMetadata | None = None

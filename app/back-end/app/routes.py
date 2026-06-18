import time
from datetime import UTC, datetime

from flask import Blueprint, Response, jsonify, request
from pydantic import ValidationError

from .models import ErrorResponse, ExecuteRequest, ExecutionMetadata, HealthResponse, ListToolsResponse
from .tool_registry import registry
from .utils import build_response, filter_to_research_area, gdf_to_geojson, geojson_to_gdf

api = Blueprint("api", __name__, url_prefix="/api/v1")


@api.route("/health", methods=["GET"])
def health() -> Response:
    return jsonify(HealthResponse(status="healthy", version="1.0.0").model_dump())


@api.route("/tools", methods=["GET"])
def list_tools() -> Response:
    tools = [t.metadata() for t in registry.all_tools()]
    return jsonify(ListToolsResponse(tools=tools).model_dump())


@api.route("/tools/<tool_id>/execute", methods=["POST"])
def execute_tool(tool_id: str) -> Response | tuple[Response, int]:
    tool = registry.get(tool_id)
    if tool is None:
        return jsonify(ErrorResponse(error=f"Unknown tool: {tool_id}").model_dump()), 404

    try:
        req = ExecuteRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as exc:
        return jsonify(ErrorResponse(error=str(exc)).model_dump()), 422

    start = time.time()
    try:
        gdf = geojson_to_gdf(req.data)
        exec_options = req.options
        if req.researchArea:
            # Hand the area to tools that can pre-clip heavy work (e.g. the road
            # network prism clips its OSM download extent to it). Kept under a
            # private key out of req.options so it isn't echoed in runMeta.params.
            exec_options = {**req.options, "_researchArea": req.researchArea}
        result_gdfs = tool.execute(gdf, exec_options, req.attributes)
        if req.researchArea:
            result_gdfs = [filter_to_research_area(r, req.researchArea) for r in result_gdfs]
        outputs = [gdf_to_geojson(r) for r in result_gdfs]
        warnings = [w for r in result_gdfs for w in r.attrs.get("warnings", [])]
    except Exception as exc:
        error_resp = ErrorResponse(
            toolId=tool_id,
            error=str(exc),
            metadata=ExecutionMetadata(
                executionTime=int((time.time() - start) * 1000),
                featureCount=0,
                timestamp=datetime.now(UTC).isoformat(),
            ),
        )
        return jsonify(error_resp.model_dump()), 400

    resp = build_response(
        tool=tool,
        outputs=outputs,
        input_count=len(req.data.get("features", [])),
        options=req.options,
        source_dataset_ids=req.sourceDatasetIds,
        start_time=start,
        warnings=warnings or None,
    )
    return jsonify(resp.model_dump())

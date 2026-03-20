import time

from flask import Blueprint, jsonify, request

from .tool_registry import registry
from .utils import geojson_to_gdf, gdf_to_geojson, build_response

api = Blueprint("api", __name__, url_prefix="/api/v1")


@api.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy", "version": "1.0.0"})


@api.route("/tools", methods=["GET"])
def list_tools():
    tools = [t.metadata() for t in registry.all_tools()]
    return jsonify({"tools": tools})


@api.route("/tools/<tool_id>/execute", methods=["POST"])
def execute_tool(tool_id: str):
    tool = registry.get(tool_id)
    if tool is None:
        return jsonify({"success": False, "error": f"Unknown tool: {tool_id}"}), 404

    body = request.get_json(silent=True) or {}
    data = body.get("data", {"type": "FeatureCollection", "features": []})
    options = body.get("options", {})
    attributes = body.get("attributes", {})
    source_dataset_ids = body.get("sourceDatasetIds", [])

    start = time.time()
    try:
        gdf = geojson_to_gdf(data)
        result_gdfs = tool.execute(gdf, options, attributes)
        outputs = [gdf_to_geojson(r) for r in result_gdfs]
    except Exception as exc:
        return jsonify({
            "success": False,
            "toolId": tool_id,
            "error": str(exc),
            "outputs": [],
            "metadata": {
                "executionTime": int((time.time() - start) * 1000),
                "featureCount": 0,
                "timestamp": __import__("datetime").datetime.now(
                    __import__("datetime").timezone.utc
                ).isoformat(),
            },
        }), 400

    resp = build_response(
        tool=tool,
        outputs=outputs,
        input_count=len(data.get("features", [])),
        options=options,
        source_dataset_ids=source_dataset_ids,
        start_time=start,
    )
    return jsonify(resp)

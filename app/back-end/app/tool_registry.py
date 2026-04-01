from app.tools.base import BaseTool


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.id] = tool

    def get(self, tool_id: str) -> BaseTool | None:
        return self._tools.get(tool_id)

    def all_tools(self) -> list[BaseTool]:
        return list(self._tools.values())


registry = ToolRegistry()


def _register_all():
    from app.tools.buffer import BufferTool
    from app.tools.intersection import IntersectionTool
    from app.tools.space_time_cube import SpaceTimeCubeTool
    from app.tools.stkde import STKDETool
    from app.tools.time_geography import TimeGeographyTool
    from app.tools.union import UnionTool

    for cls in (
        BufferTool,
        IntersectionTool,
        UnionTool,
        TimeGeographyTool,
        STKDETool,
        SpaceTimeCubeTool,
    ):
        registry.register(cls())


_register_all()

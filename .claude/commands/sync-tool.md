# Sync Tool Between Frontend and Backend

You are synchronizing a geospatial analysis tool between the frontend (`app/front-end/`) and backend (`app/back-end/`) codebases. The user will provide a tool name or ID, and optionally the direction.

## Determine Direction

First, figure out where the tool currently exists:

1. Check `app/back-end/app/tool_registry.py` for backend registration
2. Check `app/front-end/src/tools/index.ts` for frontend registration
3. Check `app/back-end/app/tools/` for the backend implementation file
4. Check `app/front-end/src/tools/` for the frontend implementation file

Based on what exists:
- **Tool exists only in backend** → Register it in the frontend (stub only — no `analyze()` implementation unless the user explicitly asks)
- **Tool exists only in frontend** → Create a full backend implementation and register it
- **Tool exists in both** → Report that it's already synced, check if the tool IDs match across both sides

---

## Direction A: Backend → Frontend (Registration Only)

When a tool exists in the backend but NOT in the frontend, create a **frontend stub**. This makes the tool visible in the UI and runnable via the backend, without implementing browser-side logic.

### Steps

1. **Read the backend tool** to extract: `id`, `name`, `description`, `version`, `execution_policy`, and what `options`/`attributes` it accepts in `execute()`.

2. **Create frontend tool file** at `app/front-end/src/tools/<tool-name>-tool.ts`:

```typescript
import { SimpleTool, ToolOptionSchema } from '@/interfaces/simple-tool';
import { FeatureCollection } from '@/interfaces/data-interfaces';
import { AttributeMapping } from '@/interfaces/attribute-mapping';

export class <ToolClass> implements SimpleTool {
  id = '<tool-id>';                    // Must match backend tool.id exactly
  name = '<Tool Name>';
  description = '<description>';
  icon = '<emoji>';
  category = '<visualization|analysis|processing>' as const;
  version = '<version>';
  capabilities = {
    executionPolicy: 'backend_only' as const,  // Backend-only since no frontend implementation
  };

  // Only declare attributeMapping if the backend tool uses attributes
  attributeMapping?: AttributeMapping = { /* match backend attributes */ };

  getOptionSchema(): ToolOptionSchema[] {
    // Mirror the options the backend tool accepts
    return [ /* ... */ ];
  }

  async analyze(
    data: FeatureCollection,
    options: Record<string, unknown>,
    attributes?: AttributeMapping
  ): Promise<FeatureCollection[]> {
    // This tool runs on the backend only
    throw new Error('<Tool Name> requires the backend server. Enable backend mode to use this tool.');
  }
}
```

3. **Register in `app/front-end/src/tools/index.ts`**:
   - Add the import: `import { <ToolClass> } from './<tool-name>-tool';`
   - Add `new <ToolClass>()` to the `availableTools` array

4. **Add normalizer case** in `app/front-end/src/services/backend-normalizer.ts` if the backend tool uses `_processed_*` fields or needs layer config injection. If it's a simple polygon tool, the `normalizeGeneric()` fallback works — just add the tool ID to the `labels` map in `createGenericPolygonLayerConfig()` if needed.

5. **Verify the tool ID matches exactly** between `backend tool.id` and `frontend tool.id`. The execution resolver and backend API service use this ID to route execution.

### What NOT to do
- Do NOT implement `analyze()` logic unless the user explicitly asks for a hybrid/frontend implementation
- Do NOT change the backend code
- Do NOT set `executionPolicy` to `hybrid` unless the user asks for a frontend implementation too

---

## Direction B: Frontend → Backend (Full Implementation)

When a tool exists in the frontend but NOT in the backend, create a **full backend implementation**.

### Steps

1. **Read the frontend tool** to understand: `id`, `name`, `description`, `version`, `capabilities`, `attributeMapping`, `getOptionSchema()`, and the `analyze()` logic.

2. **Create backend tool file** at `app/back-end/app/tools/<tool_name>.py`:

```python
import geopandas as gpd
from .base import BaseTool

class <ToolName>Tool(BaseTool):
    @property
    def id(self) -> str:
        return "<tool-id>"  # Must match frontend tool.id exactly

    @property
    def name(self) -> str:
        return "<Tool Name>"

    @property
    def description(self) -> str:
        return "<description>"

    # Override execution_policy if not "hybrid" (default)
    # @property
    # def execution_policy(self) -> str:
    #     return "backend_only"

    def execute(
        self,
        gdf: gpd.GeoDataFrame,
        options: dict,
        attributes: dict,
    ) -> list[gpd.GeoDataFrame]:
        """
        Port the frontend analyze() logic to Python/geopandas.

        - Use geopandas/shapely for geometry operations (NOT turf.js equivalents)
        - Use the same option keys the frontend uses
        - Return list[GeoDataFrame] — the route handler converts to GeoJSON
        - Use constants from app.constants for field names (_processed_*)
        """
        # Implementation here...
        return [result_gdf]
```

3. **Register in `app/back-end/app/tool_registry.py`**:
   - Add the import in `_register_all()`
   - Add the class to the registration loop

4. **Update the frontend tool's `executionPolicy`** to `hybrid` (since it can now run on both sides):
   - In `app/front-end/src/tools/<tool-name>-tool.ts`, change `executionPolicy: 'frontend_only'` to `executionPolicy: 'hybrid'`
   - Optionally set `defaultMode: 'frontend'` or `'backend'` based on what makes sense

5. **Add normalizer case** in `app/front-end/src/services/backend-normalizer.ts` if the backend uses different field names than the frontend. Check if the backend tool outputs `_processed_*` fields that need remapping to frontend `_*` fields.

### Key translation patterns (Frontend JS → Backend Python)

| Frontend (Turf.js) | Backend (Shapely/GeoPandas) |
|--------------------|-----------------------------|
| `turf.buffer(feature, dist, {units})` | `gdf.to_crs(utm).buffer(dist_meters)` |
| `turf.union(a, b)` | `shapely.ops.unary_union(geometries)` |
| `turf.intersect(a, b)` | `gdf1.overlay(gdf2, how='intersection')` |
| `turf.bbox(fc)` | `gdf.total_bounds` |
| `feature.geometry.coordinates` | `gdf.geometry.x`, `gdf.geometry.y` |
| `new Date(ts).getTime()` | `pd.to_datetime(col).astype(int) // 10**6` |

### Backend field naming convention
- The backend uses `_processed_*` prefixed field names (defined in `app/back-end/app/constants.py`)
- The frontend normalizer remaps these to the frontend names (defined in `app/front-end/src/utils/constants.tsx`)
- Mapping: `_processed_time` → `_time_order`, `_processed_height` → `_height`, `_processed_neighbors` → `_neighbors`

---

## After Sync

After completing the sync:

1. Report what files were created/modified
2. Remind the user to test:
   - Backend: `cd app/back-end && uv run pytest tests/`
   - Frontend: `cd app/front-end && npm run build`
3. If a normalizer case was added, note that the user should verify the deck.gl visualization renders correctly

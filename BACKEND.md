# Backend Integration Design

## Current Status: Frontend-Only

The Space-Time Analytics Platform is currently a **100% frontend-only application**. All data processing and analysis runs directly in the browser using JavaScript/TypeScript.

## Why Frontend-Only?

**Pragmatic Decision:**
- ✅ Simpler deployment (no server management)
- ✅ Faster development iteration
- ✅ Zero hosting costs
- ✅ Better privacy (data never leaves user's computer)
- ✅ Easier to prototype and demonstrate

**When Backend Becomes Necessary:**
- Datasets exceeding browser memory limits (>1GB)
- Computationally intensive algorithms requiring minutes of processing
- User collaboration and data sharing features
- Persistent storage of analysis results
- Integration with external spatial databases

---

## Future Backend Architecture

### Design Principles

**1. Optional Backend**
- Frontend remains fully functional without backend
- Backend is an **acceleration layer**, not a requirement
- User explicitly opts into backend processing

**2. Backend as a Tool Executor**
- Backend doesn't dictate architecture
- Frontend decides what to send to backend
- Tools can have both frontend and backend implementations

**3. API-First Design**
- Clean REST/GraphQL API contract
- Stateless request/response model
- Authentication for multi-user scenarios

---

## API Contract Specification

### Core Endpoints

#### 1. Tool Execution API

**POST /api/v1/tools/{toolId}/execute**

Execute an analysis tool on provided data.

**Request:**
```json
{
  "toolId": "time-geography",
  "data": {
    "type": "FeatureCollection",
    "features": [...]
  },
  "attributes": {
    "time": "timestamp",
    "latitude": "lat",
    "longitude": "lng"
  },
  "options": {
    "vMax": 100,
    "timeUnit": "seconds"
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "toolId": "time-geography",
  "outputs": [
    {
      "type": "FeatureCollection",
      "features": [...]
    }
  ],
  "metadata": {
    "executionTime": 1234,
    "featureCount": 42,
    "timestamp": "2025-01-15T10:30:00Z"
  },
  "runMeta": {
    "toolName": "Time Geography Analysis",
    "toolVersion": "1.0.0",
    "runAt": 1736937000000,
    "sourceDatasetIds": ["dataset-uuid"],
    "params": {
      "vMax": 100,
      "timeUnit": "seconds"
    },
    "summary": {
      "inputCount": 1,
      "outputCount": 42,
      "timeRange": { "min": 1736900000000, "max": 1736937000000 },
      "bbox": [-122.4, 37.7, -122.3, 37.8]
    },
    "warnings": []
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "toolId": "time-geography",
  "error": "Invalid time field: missing timestamps",
  "outputs": [],
  "metadata": {
    "executionTime": 0,
    "featureCount": 0,
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

> [!WARNING]
> **Data Transport Warning:** Sending gigabytes of text-based GeoJSON inside an HTTP POST payload is terrible for performance. If data genuinely exceeds typical memory/bandwidth bounds, `BACKEND.md` endpoints should ultimately pivot to stream binary formats (GeoParquet / Arrow / Protobuf) or rely on stored backend dataset identifiers rather than raw GeoJSON strings. For MVP backward-compatibility, GeoJSON conforms to the structural contract, but network latency will bottleneck it.

#### 2. Tool Metadata API

**GET /api/v1/tools**

List all available tools on the backend.

**Response:**
```json
{
  "tools": [
    {
      "id": "time-geography",
      "name": "Time Geography Analysis",
      "description": "Compute space-time prisms and potential path areas",
      "version": "1.0.0",
      "executionPolicy": "hybrid"
    },
    {
      "id": "buffer",
      "name": "Buffer Tool",
      "description": "Create buffer zones around geometries",
      "version": "1.0.0",
      "executionPolicy": "frontend_only"
    }
  ]
}
```

#### 3. Health Check API

**GET /api/v1/health**

Check backend availability.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "timestamp": "2025-01-15T10:30:00Z"
}
```

---

## Technology Stack Recommendations

### Backend Framework Options

**Option 1: FastAPI (Python) - Recommended**
- ✅ Python ecosystem (GeoPandas, Shapely, NumPy, SciPy)
- ✅ Native async/await support
- ✅ Automatic OpenAPI documentation
- ✅ Type hints and validation with Pydantic
- ✅ Excellent performance for geospatial workloads

**Example FastAPI Implementation:**
```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import geopandas as gpd

app = FastAPI()

class AnalysisRequest(BaseModel):
    toolId: str
    data: dict
    attributes: dict
    options: dict

@app.post("/api/v1/tools/{tool_id}/execute")
async def execute_tool(tool_id: str, request: AnalysisRequest):
    # Load tool from registry
    tool = tool_registry.get(tool_id)

    # Convert GeoJSON to GeoDataFrame
    gdf = gpd.GeoDataFrame.from_features(request.data)

    # Execute analysis
    result, run_meta = await tool.analyze(
        data=gdf,
        attributes=request.attributes,
        options=request.options
    )

    # Return execution matching expected AnalysisResult in frontend
    return {
        "success": True,
        "toolId": tool_id,
        "outputs": [result.to_geo_dict()],
        "metadata": {
            "executionTime": 450,
            "featureCount": len(gdf),
            "timestamp": "2025-01-15T10:30:00Z"
        },
        "runMeta": run_meta.dict()
    }
```

**Option 2: Express.js (Node.js)**
- ✅ JavaScript/TypeScript consistency with frontend
- ✅ Turf.js for geospatial operations
- ❌ Limited scientific computing libraries compared to Python
- ❌ Less mature geospatial ecosystem

**Option 3: PostGIS + pg_featureserv**
- ✅ Database-driven approach
- ✅ Native PostGIS functions for spatial analysis
- ❌ Requires PostgreSQL infrastructure
- ❌ Limited flexibility for custom algorithms

---

## Implementation Roadmap

### Phase 1: Backend Infrastructure (1-2 weeks)
- [ ] Setup FastAPI project structure
- [ ] Implement health check endpoint
- [ ] Implement tool metadata endpoint
- [ ] Add CORS configuration for frontend
- [ ] Dockerize backend service
- [ ] Setup CI/CD pipeline

### Phase 2: Tool Migration (2-3 weeks)
- [ ] Migrate time-geography-tool to Python
- [ ] Migrate buffer-tool to Python
- [ ] Migrate intersection-tool to Python
- [ ] Implement tool registry on backend
- [ ] Add unit tests for each tool
- [ ] Performance benchmarking

### Phase 3: Frontend Integration (1 week)
- [ ] Create backend-api-service.ts in frontend
- [ ] Add backend URL configuration (environment variable)
- [ ] Implement tool execution API client
- [ ] Add backend availability detection
- [ ] Add error handling and fallback to frontend
- [ ] Add progress tracking for long-running jobs

### Phase 4: Production Deployment (1 week)
- [ ] Setup production backend hosting (AWS, GCP, or Azure)
- [ ] Configure load balancer
- [ ] Add authentication/authorization (optional)
- [ ] Setup monitoring and logging
- [ ] Document deployment process
- [ ] Performance testing with large datasets

---

## Frontend Code Integration

### 1. Create Backend API Service

**File: `src/services/backend-api-service.ts`**
```typescript
import { AnalysisResult } from './analysis-engine';
import { FeatureCollection } from '../interfaces/data-interfaces';
import { AttributeMapping } from '../interfaces/attribute-mapping';

export class BackendApiService {
  private baseUrl: string;
  private available: boolean = false;

  constructor() {
    this.baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      this.available = response.ok;
    } catch (error) {
      this.available = false;
    }
  }

  public isAvailable(): boolean {
    return this.available;
  }

  public async executeAnalysis(
    toolId: string,
    data: FeatureCollection,
    attributes?: AttributeMapping,
    options?: Record<string, any>
  ): Promise<AnalysisResult> {
    if (!this.available) {
      throw new Error('Backend is not available');
    }

    const response = await fetch(`${this.baseUrl}/api/v1/tools/${toolId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId,
        data,
        attributes: attributes || {},
        options: options || {}
      })
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.statusText}`);
    }

    const result = await response.json();
    return result as AnalysisResult;
  }
}

export const backendApiService = new BackendApiService();
```

### 2. Modify Analysis Engine to Support Backend

**File: `src/services/analysis-engine.ts`**
```typescript
import { backendApiService } from './backend-api-service';

export class AnalysisEngine {
  private preferBackend: boolean = false;

  public setPreferBackend(prefer: boolean): void {
    this.preferBackend = prefer;
  }

  public async execute(request: AnalysisRequest): Promise<AnalysisResult> {
    // Try backend first if preferred and available
    if (this.preferBackend && backendApiService.isAvailable()) {
      try {
        console.log('Executing analysis on backend...');
        return await backendApiService.executeAnalysis(
          request.toolId,
          request.data,
          request.attributes,
          request.options
        );
      } catch (error) {
        console.warn('Backend execution failed, falling back to frontend:', error);
      }
    }

    // Fallback to frontend execution
    console.log('Executing analysis on frontend...');
    return await this.executeOnFrontend(request);
  }

  private async executeOnFrontend(request: AnalysisRequest): Promise<AnalysisResult> {
    // Existing frontend execution logic
    const tool = toolRegistry.getTool(request.toolId);
    // ... rest of implementation
  }
}
```

### 3. Add Backend Toggle to Settings (Future)

When implementing a settings panel, add:

```typescript
<div className="setting-item">
  <label>
    <input
      type="checkbox"
      checked={preferBackend}
      onChange={(e) => {
        analysisEngine.setPreferBackend(e.target.checked);
        setPreferBackend(e.target.checked);
      }}
      disabled={!backendApiService.isAvailable()}
    />
    Use backend processing (faster for large datasets)
  </label>
  {!backendApiService.isAvailable() && (
    <p className="text-xs text-gray-500">
      Backend is not available. Analysis will run in your browser.
    </p>
  )}
</div>
```

---

## Security Considerations

### Authentication
- **Public Deployment**: No authentication needed (stateless, no persistence)
- **Enterprise Deployment**: Add JWT-based authentication
  - Use OAuth2 for SSO integration
  - Token expiration and refresh

### Rate Limiting
- Limit requests per IP: 100 requests/hour
- Limit file size: 50MB per request
- Timeout long-running requests: 5 minutes max

### Input Validation
- Validate GeoJSON structure before processing
- Sanitize user inputs (field names, options)
- Check coordinate bounds (valid lat/lng ranges)
- Limit feature count per request (max 100k features)

### CORS Configuration
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend-domain.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
```

---

## Cost Estimation

### Infrastructure Costs (Monthly)

**Small Deployment (Personal/Prototype):**
- Hosting: Vercel/Netlify (Free tier)
- Backend: Fly.io or Railway ($5-10/month)
- **Total: $5-10/month**

**Medium Deployment (Team/Startup):**
- Hosting: Vercel Pro ($20/month)
- Backend: AWS EC2 t3.medium ($30/month)
- Database (optional): AWS RDS ($20/month)
- **Total: $70/month**

**Large Deployment (Enterprise):**
- Hosting: AWS CloudFront + S3 ($50/month)
- Backend: AWS ECS + Load Balancer ($200/month)
- Database: AWS RDS PostgreSQL + PostGIS ($100/month)
- Monitoring: DataDog/New Relic ($50/month)
- **Total: $400/month**

---

## Performance Benchmarks (Expected)

### Frontend (Browser)
- Small dataset (1k features): 100-500ms
- Medium dataset (10k features): 1-5 seconds
- Large dataset (100k features): 10-60 seconds
- Memory usage: 100MB - 1GB

### Backend (Python + FastAPI)
- Small dataset (1k features): 50-200ms
- Medium dataset (10k features): 200ms-2 seconds
- Large dataset (100k features): 2-10 seconds
- Very large dataset (1M features): 20-120 seconds
- Memory usage: 500MB - 4GB

**Speedup Factor: 2-5x for typical workloads**

---

## Decision Matrix: When to Add Backend?

| Scenario | Frontend | Backend | Hybrid |
|----------|----------|---------|--------|
| Personal prototype | ✅ | ❌ | ❌ |
| Small team (<10 users) | ✅ | ❌ | ✅ |
| Medium team (10-100 users) | ⚠️ | ✅ | ✅ |
| Enterprise (100+ users) | ❌ | ✅ | ✅ |
| Datasets < 10k features | ✅ | ⚠️ | ✅ |
| Datasets > 100k features | ❌ | ✅ | ✅ |
| Offline use required | ✅ | ❌ | ✅ |
| Collaboration required | ❌ | ✅ | ✅ |
| Budget < $50/month | ✅ | ❌ | ❌ |

**Legend:**
- ✅ Recommended
- ⚠️ Works but not optimal
- ❌ Not recommended

---

## Conclusion

**Current Status:** Frontend-only is the right choice for this stage of the project. It enables rapid iteration, easy deployment, and zero infrastructure costs.

**Future Path:** When the platform matures and user needs grow (larger datasets, collaboration features, persistent storage), the backend can be added incrementally without major architectural changes.

**Key Takeaway:** The frontend architecture is **backend-ready** but **backend-optional**. This pragmatic approach balances simplicity with future scalability.

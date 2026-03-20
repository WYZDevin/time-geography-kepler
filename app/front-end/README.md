# Space-Time Analytics Platform

A modern time geography data visualization tool built with React, TypeScript, and Kepler.gl. This platform provides comprehensive tools for analyzing, visualizing, and exploring space-time trajectory data.

## 🚀 Features

### Core Capabilities
- **Interactive 3D Visualization**: Powered by Kepler.gl for immersive space-time data exploration
- **Time Geography Analysis**: Advanced trajectory analysis with stay point detection and space-time KDE
- **Data Management**: Centralized data source management with relationships and metadata
- **Tool Ecosystem**: Extensible tool architecture for custom analysis workflows
- **Modern UI**: Clean, responsive interface with data panels and workflow management

### Analysis Tools
- **Time Geography Tool**: Analyze movement patterns and space-time paths
- **Stay Point Detection**: Identify stationary locations in trajectories
- **Space-Time KDE**: Kernel density estimation in space and time dimensions
- **3D Coordinate Axes**: Visual reference for time dimension

### Data Management
- **Multi-format Support**: GeoJSON, CSV (planned)
- **Data Relationships**: Track data lineage and processing chains
- **Metadata Tracking**: Comprehensive data statistics and processing history
- **Session Management**: Track analysis workflows and results

## 🏗️ Architecture

### Modern Data-Centric Design
The platform uses a modern, data-centric architecture that separates concerns and enables scalability:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   UI Components │    │  Service Layer  │    │  State Management│
│                 │    │                 │    │                 │
│ • Data Panel    │◄──►│ • DataService   │◄──►│ • Data Slice    │
│ • Workflow      │    │ • ToolManager   │    │ • Workflow Slice│
│ • Visualization │    │ • AnalysisRunner│    │ • Progress Slice│
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Components

#### Data Management Layer
- **DataService**: Handles data upload, processing, and management
- **Data Slice**: Redux state for data sources, relationships, and metadata
- **Processing Sessions**: Track tool executions and results

#### Tool System
- **ToolManager**: Registry and execution manager for analysis tools
- **AbstractBaseTool**: Base class for all analysis tools
- **AnalysisRunner**: Orchestrates complex analysis workflows

#### UI Architecture
- **AppProvider**: Context provider for service initialization
- **DataPanel**: Centralized data source management interface
- **WorkflowContainer**: Step-by-step analysis workflow
- **Modern Components**: Built with shadcn/ui and Tailwind CSS

## 🛠️ Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```

## 📊 Usage

### 1. Data Upload
- Drag and drop GeoJSON files
- Generate synthetic data for testing
- Automatic data validation and statistics

### 2. Data Management
- View all data sources in the data panel
- Track data relationships and lineage
- Manage multiple datasets simultaneously

### 3. Analysis Workflow
- Select analysis tools from the toolbox
- Configure field mappings and options
- Execute analysis with progress tracking
- View results in interactive visualizations

### 4. Visualization
- 3D space-time trajectories
- Interactive Kepler.gl maps
- Multiple visualization layers
- Custom styling and themes

## 🔧 Extending the Platform

### Adding New Tools
1. Extend `AbstractBaseTool`
2. Implement required methods
3. Register with `ToolManager`

```typescript
export class MyCustomTool extends AbstractBaseTool {
  readonly id = 'my-custom-tool';
  readonly name = 'My Custom Tool';
  // ... implement required properties and methods
}

// Register the tool
toolManager.registerTool(new MyCustomTool());
```

### Custom Data Sources
1. Implement data parsing logic
2. Use `DataService.uploadDataSource()`
3. Add metadata and relationships

### UI Customization
- Components built with shadcn/ui
- Tailwind CSS for styling
- Fully customizable themes

## 🏛️ Architecture

### Core Architecture Principles
- **Frontend-Only Design**: Simplified deployment with all processing done client-side
- **Tool-Based System**: Extensible SimpleTool interface for analysis plugins
- **Redux State Management**: Centralized state with specialized slices (data, workflow, metadata, progress)
- **Visualization Templates**: JSON-based Kepler.gl layer configurations
- **Type-Safe Development**: Comprehensive TypeScript interfaces throughout

### Code Organization
```
src/
├── components/        # React UI components
│   ├── data-panel/    # Data source management
│   ├── toolbox/       # Tool selection
│   └── workflow/      # Analysis workflow steps
├── contexts/          # React contexts
├── interfaces/        # TypeScript type definitions
├── services/          # Business logic layer
│   ├── analysis-engine.ts
│   └── visualization-service.ts
├── stores/            # Redux state slices
├── tools/             # Analysis tool implementations
├── utils/             # Utility functions
│   ├── field-auto-detection.ts
│   ├── tool-registry.ts
│   ├── data-utils.ts
│   └── constants.tsx
└── visualization-templates/  # Kepler.gl configs
```

### Recent Architectural Improvements (Phase 2)
- ✅ **Standardized Tool Interface**: All tools implement SimpleTool with getOptionSchema()
- ✅ **Removed Legacy Code**: Eliminated 500+ lines of unused data processors and hardcoded configs
- ✅ **Clean Utils Structure**: Focused, single-responsibility utility modules
- ✅ **Zero TypeScript Errors**: Full type safety across the codebase
- ✅ **Frontend-Only Architecture**: Removed backend abstraction layer for simplified deployment

### Frontend-Only Processing

This platform is **100% client-side** - all data processing and analysis runs directly in your browser:

**Benefits:**
- ✅ **Privacy First**: Your data never leaves your computer
- ✅ **Zero Setup**: No server infrastructure required
- ✅ **Instant Deploy**: Host on any static file server (Vercel, Netlify, GitHub Pages)
- ✅ **Offline Capable**: Works without internet connection (after initial load)
- ✅ **Cost Effective**: No server costs, scales infinitely

**Trade-offs:**
- ⚠️ **Performance**: Large datasets (>100k features) may be slow on older devices
- ⚠️ **Memory Limits**: Browser memory constraints apply
- ⚠️ **No Persistence**: Data cleared when you close the browser (localStorage planned)

**Future Backend Integration:**
While the platform is frontend-only today, the architecture supports optional backend processing for:
- Heavy computational workloads
- Dataset storage and sharing
- Real-time collaboration
See [BACKEND.md](./BACKEND.md) for the integration design.

### Performance Optimizations
- Data caching and memoization
- Lazy loading of components
- Efficient state updates
- Progress tracking for long operations
- Client-side analysis keeps data local (no network overhead)

### Scalability Features
- Plugin architecture for tools via SimpleTool interface
- Extensible data source types (GeoJSON, CSV planned)
- JSON-based visualization templates for easy customization
- Modular component system with clear boundaries

## 📈 Future Enhancements

- **Additional Data Formats**: CSV, KML, Shapefile support
- **Advanced Analytics**: Machine learning integration
- **Collaboration**: Multi-user workflows and sharing
- **Export Options**: Multiple output formats
- **Performance**: WebGL optimizations and data streaming

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests and documentation
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Built with [Kepler.gl](https://kepler.gl/) for visualization
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Powered by [React](https://reactjs.org/) and [TypeScript](https://www.typescriptlang.org/)

# Architecture Overview

## 🎯 Design Philosophy

The new architecture follows a **data-centric approach** where data is the primary concern, and tools operate on shared data sources. This is a significant improvement over the previous workflow-centric design.

## 🏗️ Core Architecture

### 1. Data Management Layer

#### DataService (`src/services/data-service.ts`)
- **Purpose**: Central hub for all data operations
- **Responsibilities**:
  - Upload and validate data sources
  - Process data with tools
  - Generate synthetic data for testing
  - Calculate data statistics
  - Manage data relationships

#### Data Slice (`src/stores/data-slice.ts`)
- **Purpose**: Redux state management for data
- **State Structure**:
  ```typescript
  interface DataState {
    dataSources: Record<string, DataSource>;
    activeDataSourceId: string | null;
    sessions: Record<string, ProcessingSession>;
    dataRelationships: Record<string, string[]>;
    selectedDataIds: string[];
    // ... more state
  }
  ```

### 2. Tool Management System

#### ToolManager (`src/services/tool-manager.ts`)
- **Purpose**: Registry and execution manager for analysis tools
- **Features**:
  - Tool registration and discovery
  - Input validation
  - Execution orchestration
  - Progress tracking

#### AbstractBaseTool (`src/tools/base-tool.ts`)
- **Purpose**: Base class for all analysis tools
- **Provides**:
  - Standard validation methods
  - Helper utilities
  - Result formatting
  - Error handling

### 3. Analysis Orchestration

#### AnalysisRunner (`src/services/analysis-runner.ts`)
- **Purpose**: Orchestrates complex analysis workflows
- **Features**:
  - Sequential analysis chains
  - Parallel analysis execution
  - Tool recommendations
  - Session management

### 4. Application Context

#### AppProvider (`src/contexts/app-context.tsx`)
- **Purpose**: Initialize and provide services to the entire app
- **Services Provided**:
  - DataService instance
  - ToolManager instance
  - AnalysisRunner instance
  - Initialization status

## 🔄 Data Flow

### 1. Data Upload Flow
```
User Upload → DataService.uploadDataSource() → Data Slice → UI Update
```

### 2. Analysis Flow
```
Tool Selection → AnalysisRunner.runAnalysis() → ToolManager.executeTool() → 
Tool.analyze() → DataService.processDataWithTool() → Results Storage
```

### 3. Visualization Flow
```
Data Sources → Kepler.gl Integration → Interactive Visualization
```

## 🎨 UI Architecture

### Layout Structure
```
App (with AppProvider)
├── Header
└── Grid Layout (50% | 25% | 25%)
    ├── Kepler.gl Map
    ├── Data Panel
    └── Workflow Container
```

### Key Components

#### DataPanel (`src/components/data-panel/data-panel.tsx`)
- **Purpose**: Centralized data source management
- **Features**:
  - List/tree/timeline views
  - Data source statistics
  - Selection and bulk operations
  - Metadata display

#### ModernDataUploadStep (`src/components/workflow/steps/modern-data-upload-step.tsx`)
- **Purpose**: Modern file upload interface
- **Features**:
  - Drag & drop support
  - Multiple format support
  - Sample data generation
  - Real-time validation

## 🔧 Key Improvements

### From Previous Architecture

1. **Data-Centric Design**
   - **Before**: Workflow managed data temporarily
   - **After**: Centralized data management with persistence

2. **Service Layer**
   - **Before**: Direct tool execution
   - **After**: Comprehensive service layer with validation

3. **State Management**
   - **Before**: Single workflow slice
   - **After**: Specialized slices for different concerns

4. **Tool System**
   - **Before**: Basic tool abstraction
   - **After**: Full tool lifecycle management

5. **UI/UX**
   - **Before**: Single workflow panel
   - **After**: Multi-panel interface with data management

### Performance Benefits

1. **Data Caching**: Processed data is cached and reusable
2. **Lazy Loading**: Components load on demand
3. **Efficient Updates**: Granular state updates
4. **Progress Tracking**: Real-time feedback for long operations

### Scalability Features

1. **Plugin Architecture**: Easy to add new tools
2. **Extensible Data Sources**: Support for multiple formats
3. **Modular Components**: Reusable UI components
4. **Service Abstraction**: Easy to swap implementations

## 🚀 Usage Patterns

### Adding a New Tool
```typescript
// 1. Create tool class
export class MyTool extends AbstractBaseTool {
  readonly id = 'my-tool';
  readonly name = 'My Tool';
  // ... implement methods
}

// 2. Register in AppProvider
const myTool = new MyTool();
toolManager.registerTool(myTool);
```

### Processing Data
```typescript
// Upload data
const dataId = await dataService.uploadDataSource(name, data);

// Run analysis
const result = await analysisRunner.runAnalysis({
  toolId: 'time-geography',
  inputDataIds: [dataId],
  fieldMapping: mapping,
  options: options
});
```

### Managing Data Sources
```typescript
// Get all data sources
const dataSources = useSelector(selectAllDataSources);

// Get active data source
const activeData = useSelector(selectActiveDataSource);

// Set active data source
dispatch(setActiveDataSource(dataId));
```

## 🔮 Future Enhancements

### Planned Features
1. **Data Streaming**: Real-time data processing
2. **Collaborative Editing**: Multi-user workflows
3. **Advanced Caching**: Persistent data cache
4. **Plugin Marketplace**: Community tools
5. **Export Pipeline**: Multiple output formats

### Technical Improvements
1. **WebWorkers**: Background processing
2. **IndexedDB**: Client-side data persistence
3. **WebGL**: Performance optimizations
4. **TypeScript**: Stricter typing
5. **Testing**: Comprehensive test coverage

## 📊 Monitoring & Debugging

### Development Tools
- Redux DevTools integration
- Service layer logging
- Progress tracking
- Error boundaries
- Performance monitoring

### Production Monitoring
- Error tracking
- Performance metrics
- User analytics
- Data processing statistics

This architecture provides a solid foundation for scaling your time geography visualization tool while maintaining clean separation of concerns and excellent developer experience.
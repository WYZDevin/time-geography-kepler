# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Space-Time Analytics Platform** - a modern time geography data visualization tool that analyzes and visualizes space-time trajectory data. The application uses a data-centric architecture built with React, TypeScript, and Kepler.gl.

## Essential Commands

```bash
# Install dependencies
npm install

# Run development server (Vite on port 5173)
npm run dev

# Build for production
npm run build

# Lint the codebase
npm run lint

# Preview production build
npm run preview
```

## High-Level Architecture

### Data-Centric Design
The application prioritizes data management over workflow management. Data sources are persistent and can be used across multiple analysis sessions.

### Service Layer Architecture
```
AppProvider (Context)
├── DataService - Central hub for all data operations
├── ToolManager - Registry and execution for analysis tools  
└── AnalysisRunner - Orchestrates complex analysis workflows
```

### State Management
Redux store with specialized slices:
- **data-slice**: Manages data sources, relationships, and metadata
- **workflow-slice**: Handles analysis workflow state
- **store**: Combines slices and provides typed hooks

### Tool System
All analysis tools extend `AbstractBaseTool` and are registered with `ToolManager`. Tools operate on data sources and produce new data sources as results.

### Key Data Flow Patterns
1. **Data Upload**: User → DataService.uploadDataSource() → Redux Store → UI Update
2. **Analysis**: Tool Selection → AnalysisRunner → ToolManager → Tool.analyze() → New Data Source
3. **Visualization**: Data Sources → Kepler.gl Integration → 3D Map Visualization

## Critical Implementation Notes

### When Adding New Tools
1. Extend `AbstractBaseTool` in `src/tools/`
2. Implement all required methods (id, name, category, analyze, etc.)
3. Register in `AppProvider` initialization
4. Tools must return valid GeoJSON FeatureCollections

### Data Source Management
- All data sources must have unique IDs (use uuid)
- Track relationships between parent and derived data sources
- Store processing metadata in sessions
- Data sources are immutable - tools create new sources

### UI Component Patterns
- Use shadcn/ui components from `src/components/ui/`
- Follow existing patterns for form validation with react-hook-form and zod
- Maintain consistent styling with Tailwind CSS
- Components should use the AppContext for service access

### Kepler.gl Integration
- Configuration is in `src/utils/config.tsx`
- Custom map styles and layers are defined there
- Visualization templates are in `vis-json-template/`
- Map takes 50% of the screen width in the layout

### Type Safety
- All data interfaces are in `src/interfaces/`
- Use proper TypeScript types for all new code
- Avoid `any` types - define proper interfaces
- Tool interfaces must extend from base types

## Key Files to Understand

- `src/contexts/app-context.tsx` - Service initialization and dependency injection
- `src/services/data-service.ts` - Core data management logic
- `src/tools/base-tool.ts` - Base class for all analysis tools
- `src/stores/data-slice.ts` - Redux state structure for data
- `src/components/data-panel/data-panel.tsx` - Main data management UI
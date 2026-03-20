import { toolRegistry } from '../utils/tool-registry';
import { TimeGeographyTool } from './time-geography-tool';
import { BufferTool } from './buffer-tool';
import { IntersectionTool } from './intersection-tool';
import { UnionTool } from './union-tool';
import { STKDETool } from './stkde-tool';
import { SpaceTimeCubeTool } from './space-time-cube-tool';

// Import all SimpleTool implementations
const availableTools = [
    // Space-Time Analysis Tools
    new TimeGeographyTool(),
    new STKDETool(),
    new SpaceTimeCubeTool(),

    // Spatial Analysis Tools
    new BufferTool(),
    new IntersectionTool(),
    new UnionTool(),
];

/**
 * Initialize and register all available tools
 */
export function initializeTools(): void {
    // Clear existing tools
    toolRegistry.clear();

    // Register all tools
    availableTools.forEach(tool => {
        try {
            toolRegistry.register(tool);
        } catch (error) {
            console.error(`Failed to register tool ${tool.id}:`, error);
        }
    });

}

/**
 * Get all registered tools for the UI
 */
export function getAvailableTools() {
    return toolRegistry.getAllTools();
}

/**
 * Get tools by category for the UI
 */
export function getToolsByCategory(category: string) {
    return toolRegistry.getToolsByCategory(category);
}

/**
 * Get a specific tool by ID
 */
export function getTool(toolId: string) {
    return toolRegistry.getTool(toolId);
}

// Export tool registry for direct access if needed
export { toolRegistry } from '../utils/tool-registry';

// Auto-initialize tools when this module is imported
initializeTools();
// Force HMR 12
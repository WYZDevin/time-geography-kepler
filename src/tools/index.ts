import { toolRegistry } from '../utils/tool-registry';
import { TimeGeographyTool } from './time-geography-tool';
import { StayPointsTool } from './stay-points-tool';
import { STKDETool } from './stkde-tool';
import { PotentialPathEstimationTool } from './potential-path-estimation-tool';

// Import all tool implementations
const availableTools = [
    new TimeGeographyTool(),
    new StayPointsTool(), 
    new STKDETool(),
    new PotentialPathEstimationTool(),
    // new TemporalAggregationTool(),
    // new SpatialClusteringTool(),
];

/**
 * Initialize and register all available tools
 */
export function initializeTools(): void {
    console.log('Initializing analysis tools...');
    
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
    
    console.log(`Successfully registered ${toolRegistry.getToolCount()} tools`);
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
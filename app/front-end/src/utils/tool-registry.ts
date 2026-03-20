import { SimpleTool } from '../interfaces/simple-tool';

export interface SimpleToolRegistry {
    register(tool: SimpleTool): void;
    unregister(toolId: string): void;
    getTool(toolId: string): SimpleTool | undefined;
    getAllTools(): SimpleTool[];
    getToolsByCategory(category: string): SimpleTool[];
}

class ToolRegistryImpl implements SimpleToolRegistry {
    private tools: Map<string, SimpleTool> = new Map();

    register(tool: SimpleTool): void {
        if (this.tools.has(tool.id)) {
            console.warn(`Tool with id "${tool.id}" is already registered. Overwriting...`);
        }
        this.tools.set(tool.id, tool);
    }

    unregister(toolId: string): void {
        if (this.tools.has(toolId)) {
            this.tools.delete(toolId);
        } else {
            console.warn(`Tool with id "${toolId}" not found for unregistration`);
        }
    }

    getTool(toolId: string): SimpleTool | undefined {
        return this.tools.get(toolId);
    }

    getAllTools(): SimpleTool[] {
        return Array.from(this.tools.values());
    }

    getToolsByCategory(category: string): SimpleTool[] {
        return this.getAllTools().filter(tool => tool.category === category);
    }

    // Additional utility methods
    getToolIds(): string[] {
        return Array.from(this.tools.keys());
    }

    getToolCount(): number {
        return this.tools.size;
    }

    isRegistered(toolId: string): boolean {
        return this.tools.has(toolId);
    }

    clear(): void {
        this.tools.clear();
    }
}

// Create singleton instance
export const toolRegistry = new ToolRegistryImpl();

// Export the registry type for dependency injection
 
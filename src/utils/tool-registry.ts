import { BaseTool, ToolRegistry } from '../interfaces/tool-interfaces';

class ToolRegistryImpl implements ToolRegistry {
    private tools: Map<string, BaseTool> = new Map();

    register(tool: BaseTool): void {
        if (this.tools.has(tool.id)) {
            console.warn(`Tool with id "${tool.id}" is already registered. Overwriting...`);
        }
        this.tools.set(tool.id, tool);
        console.log(`Tool "${tool.name}" (${tool.id}) registered successfully`);
    }

    unregister(toolId: string): void {
        if (this.tools.has(toolId)) {
            const tool = this.tools.get(toolId);
            this.tools.delete(toolId);
            console.log(`Tool "${tool?.name}" (${toolId}) unregistered`);
        } else {
            console.warn(`Tool with id "${toolId}" not found for unregistration`);
        }
    }

    getTool(toolId: string): BaseTool | undefined {
        return this.tools.get(toolId);
    }

    getAllTools(): BaseTool[] {
        return Array.from(this.tools.values());
    }

    getToolsByCategory(category: string): BaseTool[] {
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
        console.log('All tools unregistered');
    }
}

// Create singleton instance
export const toolRegistry = new ToolRegistryImpl();

// Export the registry type for dependency injection
export type { ToolRegistry }; 
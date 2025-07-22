import { Tool } from '../interfaces/data-interfaces';

export const AVAILABLE_TOOLS: Tool[] = [
    {
        id: 'time-geography',
        name: 'Time Geography',
        description: 'Analyze movement patterns and space-time paths',
        icon: '🕐',
        category: 'analysis',
        requiredFields: ['latitude', 'longitude', 'time'],
        optionalFields: ['altitude']
    },
    {
        id: 'space-time-kde',
        name: 'Space-Time KDE',
        description: 'Generate kernel density estimation in space and time',
        icon: '📊',
        category: 'analysis',
        requiredFields: ['latitude', 'longitude', 'time'],
        optionalFields: ['weight']
    },
    {
        id: 'trajectory-visualization',
        name: 'Trajectory Visualization',
        description: 'Visualize movement trajectories and paths',
        icon: '📍',
        category: 'visualization',
        requiredFields: ['latitude', 'longitude'],
        optionalFields: ['time', 'sequence']
    },
    {
        id: 'stay-point-detection',
        name: 'Stay Point Detection',
        description: 'Identify and analyze stay points in movement data',
        icon: '⭕',
        category: 'processing',
        requiredFields: ['latitude', 'longitude', 'time'],
        optionalFields: ['stay_duration', 'radius']
    },
    {
        id: 'temporal-aggregation',
        name: 'Temporal Aggregation',
        description: 'Aggregate data across different time intervals',
        icon: '📅',
        category: 'processing',
        requiredFields: ['time'],
        optionalFields: ['aggregation_field']
    },
    {
        id: 'spatial-clustering',
        name: 'Spatial Clustering',
        description: 'Cluster spatial data points using various algorithms',
        icon: '🔗',
        category: 'analysis',
        requiredFields: ['latitude', 'longitude'],
        optionalFields: ['cluster_field']
    }
];

export const getToolById = (id: string): Tool | undefined => {
    return AVAILABLE_TOOLS.find(tool => tool.id === id);
};

export const getToolsByCategory = (category: Tool['category']): Tool[] => {
    return AVAILABLE_TOOLS.filter(tool => tool.category === category);
}; 
/**
 * Brain graph type definitions.
 * Adapted from Kybernesis Canvas arcana/types.ts.
 */

// Wire format from GET /brain/graph
export interface GraphNodeDTO {
  id: number;
  name: string;
  type: EntityType;
  mention_count: number;
  priority: number;
  decay_score: number;
  tier: string;
  last_seen: string;
}

export interface GraphEdgeDTO {
  source: number;
  target: number;
  relationship: string;
  strength: number;
  confidence: number;
}

export interface GraphResponse {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
}

export type EntityType = 'person' | 'company' | 'project' | 'place' | 'topic';

// Runtime canvas types
export interface CanvasNode {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  label: string;
  type: EntityType;
  mentions: number;
  priority: number;
  decay: number;
  tier: string;
  pulsePhase: number;
  connections: CanvasNode[];
}

export interface CanvasEdge {
  from: CanvasNode;
  to: CanvasNode;
  strength: number;
  confidence: number;
  relationship: string;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  targetZoom: number;
}

export interface Physics {
  clusterStrength: number;
  repulsion: number;
  damping: number;
  springStrength: number;
  idealDistance: number;
}

export const DEFAULT_PHYSICS: Physics = {
  clusterStrength: 0.005,
  repulsion: 3.0,
  damping: 0.88,
  springStrength: 0.003,
  idealDistance: 250,
};

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

export interface ColorScheme {
  bg: RGB;
  node: Record<string, RGB>;
  connection: RGBA;
  glow: RGBA;
  grid: RGBA;
}

export const darkColors: ColorScheme = {
  bg: [10, 10, 10],
  node: {
    person: [59, 130, 246],
    company: [34, 197, 94],
    project: [249, 115, 22],
    place: [239, 68, 68],
    topic: [168, 85, 247],
    default: [156, 163, 175],
  },
  connection: [255, 255, 255, 30],
  glow: [255, 255, 255, 80],
  grid: [255, 255, 255, 8],
};

export const lightColors: ColorScheme = {
  bg: [240, 239, 234],
  node: {
    person: [37, 99, 235],
    company: [22, 163, 74],
    project: [234, 88, 12],
    place: [220, 38, 38],
    topic: [147, 51, 234],
    default: [100, 116, 139],
  },
  connection: [0, 0, 0, 25],
  glow: [0, 0, 0, 60],
  grid: [0, 0, 0, 8],
};

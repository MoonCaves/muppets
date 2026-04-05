/**
 * Physics simulation for entity graph.
 * Adapted from Kybernesis Canvas page.tsx:888-934.
 */

import type { CanvasNode, CanvasEdge, Physics } from './types';

export function applyForces(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  physics: Physics,
): void {
  // Pairwise repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 200 && dist > 0.1) {
        const force = physics.repulsion / (dist + 1);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  // Spring forces along edges
  for (const edge of edges) {
    const dx = edge.to.x - edge.from.x;
    const dy = edge.to.y - edge.from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > physics.idealDistance && dist > 0.1) {
      const force = physics.springStrength * edge.strength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      edge.from.vx += fx;
      edge.from.vy += fy;
      edge.to.vx -= fx;
      edge.to.vy -= fy;
    }
  }

  // Apply velocity and damping
  for (const node of nodes) {
    node.vx *= physics.damping;
    node.vy *= physics.damping;
    node.x += node.vx;
    node.y += node.vy;
  }
}

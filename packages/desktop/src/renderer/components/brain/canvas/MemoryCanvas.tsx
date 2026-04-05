/**
 * p5.js memory graph canvas — React wrapper.
 * Renders entity graph with physics simulation.
 *
 * Uses p5 in instance mode for proper React lifecycle management.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { GraphNodeDTO, GraphEdgeDTO, CanvasNode, CanvasEdge, Camera, ColorScheme } from './types';
import { DEFAULT_PHYSICS, darkColors, lightColors } from './types';
import { applyForces } from './physics';

interface MemoryCanvasProps {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  isDark?: boolean;
  onNodeSelect?: (node: GraphNodeDTO | null) => void;
}

export default function MemoryCanvas({ nodes, edges, isDark = true, onNodeSelect }: MemoryCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const nodesRef = useRef<CanvasNode[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1, targetZoom: 1 });
  const timeRef = useRef(0);
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; camStartX: number; camStartY: number }>({ dragging: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0 });
  const [hoveredNode, setHoveredNode] = useState<CanvasNode | null>(null);
  const colorsRef = useRef<ColorScheme>(isDark ? darkColors : lightColors);

  useEffect(() => {
    colorsRef.current = isDark ? darkColors : lightColors;
  }, [isDark]);

  // Initialize nodes from data
  useEffect(() => {
    if (nodes.length === 0) return;

    const nodeMap = new Map<number, CanvasNode>();
    const canvasNodes: CanvasNode[] = nodes.map((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const radius = 200 + Math.random() * 300;
      const importance = n.priority * 0.7 + n.decay_score * 0.3;
      const node: CanvasNode = {
        id: n.id,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        size: 5 + Math.log2(n.mention_count + 1) * 4 + importance * 8,
        label: n.name,
        type: n.type,
        mentions: n.mention_count,
        priority: n.priority,
        decay: n.decay_score,
        tier: n.tier,
        pulsePhase: Math.random() * Math.PI * 2,
        connections: [],
      };
      nodeMap.set(n.id, node);
      return node;
    });

    const canvasEdges: CanvasEdge[] = edges.map(e => ({
      from: nodeMap.get(e.source)!,
      to: nodeMap.get(e.target)!,
      strength: e.strength,
      confidence: e.confidence,
      relationship: e.relationship,
    })).filter(e => e.from && e.to);

    // Build connection lists
    for (const edge of canvasEdges) {
      edge.from.connections.push(edge.to);
      edge.to.connections.push(edge.from);
    }

    nodesRef.current = canvasNodes;
    edgesRef.current = canvasEdges;

    // Center camera
    cameraRef.current.x = 0;
    cameraRef.current.y = 0;
  }, [nodes, edges]);

  // Canvas rendering loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const colors = colorsRef.current;
    const camera = cameraRef.current;
    const allNodes = nodesRef.current;
    const allEdges = edgesRef.current;

    timeRef.current += 0.01;
    camera.zoom += (camera.targetZoom - camera.zoom) * 0.1;

    // Apply physics
    applyForces(allNodes, allEdges, DEFAULT_PHYSICS);

    // Clear
    ctx.fillStyle = `rgb(${colors.bg.join(',')})`;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2 + camera.x, h / 2 + camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    // Draw grid
    ctx.strokeStyle = `rgba(${colors.grid.join(',')})`;
    ctx.lineWidth = 0.5;
    const gridSize = 100;
    const extent = 2000;
    for (let x = -extent; x <= extent; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, -extent);
      ctx.lineTo(x, extent);
      ctx.stroke();
    }
    for (let y = -extent; y <= extent; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(-extent, y);
      ctx.lineTo(extent, y);
      ctx.stroke();
    }

    // Draw edges
    for (const edge of allEdges) {
      const alpha = 10 + edge.confidence * 25;
      if (edge.strength > 0.6) {
        ctx.strokeStyle = `rgba(100, 150, 255, ${alpha / 255})`;
        ctx.lineWidth = 1 + edge.strength;
        ctx.setLineDash([]);
      } else if (edge.strength > 0.3) {
        ctx.strokeStyle = `rgba(150, 100, 255, ${alpha / 255})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
      } else {
        ctx.strokeStyle = `rgba(${colors.connection.slice(0, 3).join(',')}, ${alpha / 255})`;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1, 7]);
      }
      ctx.beginPath();
      ctx.moveTo(edge.from.x, edge.from.y);
      ctx.lineTo(edge.to.x, edge.to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw nodes
    for (const node of allNodes) {
      const rgb = colors.node[node.type] || colors.node.default;
      const pulse = Math.sin(timeRef.current * 2 + node.pulsePhase) * 0.15 + 1;
      const r = node.size * pulse;

      // Glow for high-priority
      if (node.priority > 0.7 && camera.zoom > 0.4) {
        const gradient = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, r * 3);
        gradient.addColorStop(0, `rgba(${rgb.join(',')}, 0.3)`);
        gradient.addColorStop(1, `rgba(${rgb.join(',')}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node circle
      const opacity = node.tier === 'hot' ? 1 : node.tier === 'warm' ? 0.7 : 0.4;
      ctx.fillStyle = `rgba(${rgb.join(',')}, ${opacity})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Label (only at sufficient zoom)
      if (camera.zoom > 0.5) {
        ctx.fillStyle = `rgba(${colorsRef.current.glow.slice(0, 3).join(',')}, 0.8)`;
        ctx.font = `${Math.max(9, 11 / camera.zoom)}px "Space Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y + r + 12 / camera.zoom);
      }
    }

    ctx.restore();

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  // Setup canvas and start loop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);
    canvasRef.current = canvas;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(devicePixelRatio, devicePixelRatio);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    rafRef.current = requestAnimationFrame(draw);

    // Mouse handlers
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      cameraRef.current.targetZoom = Math.max(0.3, Math.min(3.0, cameraRef.current.targetZoom * (1 + delta)));
    };

    const onMouseDown = (e: MouseEvent) => {
      dragRef.current = {
        dragging: true,
        startX: e.clientX,
        startY: e.clientY,
        camStartX: cameraRef.current.x,
        camStartY: cameraRef.current.y,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (dragRef.current.dragging) {
        cameraRef.current.x = dragRef.current.camStartX + (e.clientX - dragRef.current.startX);
        cameraRef.current.y = dragRef.current.camStartY + (e.clientY - dragRef.current.startY);
      }
    };

    const onMouseUp = () => {
      dragRef.current.dragging = false;
    };

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - rect.width / 2 - cameraRef.current.x) / cameraRef.current.zoom;
      const my = (e.clientY - rect.top - rect.height / 2 - cameraRef.current.y) / cameraRef.current.zoom;

      for (const node of nodesRef.current) {
        const dx = node.x - mx;
        const dy = node.y - my;
        if (Math.sqrt(dx * dx + dy * dy) < node.size * 2) {
          const dto = nodes.find(n => n.id === node.id);
          onNodeSelect?.(dto ?? null);
          return;
        }
      }
      onNodeSelect?.(null);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('click', onClick);
      container.removeChild(canvas);
    };
  }, [draw, nodes, onNodeSelect]);

  return <div ref={containerRef} className="w-full h-full" style={{ cursor: dragRef.current.dragging ? 'grabbing' : 'grab' }} />;
}

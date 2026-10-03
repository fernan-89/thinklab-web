import type { TopologyEdge, TopologyNode } from '../api/types';

export interface PositionedNode {
  node: TopologyNode;
  x: number;
  y: number;
  layer: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: { edge: TopologyEdge; from: PositionedNode; to: PositionedNode }[];
  width: number;
  height: number;
}

export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 40;
const H_GAP = 70;
const V_GAP = 24;
const PADDING = 20;

/**
 * Layered left-to-right layout: a node's layer is its longest-path distance from a node nothing points at, so for a
 * web -> app -> db chain the dependents sit on the left and what they depend on sits to the right. Cycles are tolerated
 * (an edge that closes a cycle is ignored when ranking) because the platform does not forbid them.
 */
export function layoutGraph(nodes: TopologyNode[], edges: TopologyEdge[]): GraphLayout {
  const known = new Set(nodes.map((n) => n.id));
  const drawable = edges.filter((e) => known.has(e.sourceNodeId) && known.has(e.targetNodeId) && e.sourceNodeId !== e.targetNodeId);

  const layers = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // Bellman-Ford style relaxation, capped at |nodes| rounds, which also bounds the work when there is a cycle.
  for (let round = 0; round < nodes.length; round++) {
    let changed = false;
    for (const e of drawable) {
      const candidate = (layers.get(e.sourceNodeId) ?? 0) + 1;
      if (candidate > (layers.get(e.targetNodeId) ?? 0) && candidate < nodes.length) {
        layers.set(e.targetNodeId, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLayer = new Map<number, TopologyNode[]>();
  for (const node of [...nodes].sort((a, b) => a.label.localeCompare(b.label))) {
    const layer = layers.get(node.id) ?? 0;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), node]);
  }

  const positioned = new Map<string, PositionedNode>();
  let tallest = 0;
  for (const [layer, members] of byLayer) {
    members.forEach((node, row) => {
      positioned.set(node.id, {
        node,
        layer,
        x: PADDING + layer * (NODE_WIDTH + H_GAP),
        y: PADDING + row * (NODE_HEIGHT + V_GAP),
      });
    });
    tallest = Math.max(tallest, members.length);
  }

  const layerCount = byLayer.size === 0 ? 0 : Math.max(...byLayer.keys()) + 1;
  return {
    nodes: [...positioned.values()],
    edges: drawable.map((edge) => ({ edge, from: positioned.get(edge.sourceNodeId)!, to: positioned.get(edge.targetNodeId)! })),
    width: PADDING * 2 + Math.max(layerCount, 1) * NODE_WIDTH + Math.max(layerCount - 1, 0) * H_GAP,
    height: PADDING * 2 + Math.max(tallest, 1) * NODE_HEIGHT + Math.max(tallest - 1, 0) * V_GAP,
  };
}

import { describe, expect, it } from 'vitest';
import type { TopologyEdge, TopologyNode } from '../api/types';
import { layoutGraph } from './layout';

const node = (id: string, label = id): TopologyNode => ({
  id, organisationId: 'o', nodeType: 'ASSET', externalId: id, label, status: 'ACTIVE', createdAt: '', updatedAt: '',
});
const edge = (source: string, target: string): TopologyEdge => ({
  id: `${source}-${target}`, organisationId: 'o', relationshipType: 'DEPENDS_ON', sourceNodeId: source, targetNodeId: target,
  status: 'ACTIVE', createdAt: '', updatedAt: '',
});
const layerOf = (layout: ReturnType<typeof layoutGraph>, id: string) => layout.nodes.find((n) => n.node.id === id)!.layer;

describe('layoutGraph', () => {
  it('ranks a chain left to right: dependents first, dependencies after', () => {
    const layout = layoutGraph([node('web'), node('app'), node('db')], [edge('web', 'app'), edge('app', 'db')]);

    expect([layerOf(layout, 'web'), layerOf(layout, 'app'), layerOf(layout, 'db')]).toEqual([0, 1, 2]);
    expect(layout.edges).toHaveLength(2);
  });

  it('uses the longest path so a node sits after everything that leads to it', () => {
    const layout = layoutGraph([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')]);

    expect(layerOf(layout, 'c')).toBe(2);
  });

  it('stacks nodes of the same layer in label order', () => {
    const layout = layoutGraph([node('1', 'zeta'), node('2', 'alpha')], []);
    const [first, second] = [...layout.nodes].sort((a, b) => a.y - b.y);

    expect([first.node.label, second.node.label]).toEqual(['alpha', 'zeta']);
    expect(first.x).toBe(second.x);
  });

  it('survives a cycle instead of looping forever', () => {
    const layout = layoutGraph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);

    expect(layout.nodes).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(0);
  });

  it('ignores self-loops and edges to nodes that are not in the graph', () => {
    const layout = layoutGraph([node('a')], [edge('a', 'a'), edge('a', 'ghost')]);

    expect(layout.edges).toHaveLength(0);
  });

  it('gives an empty graph a non-zero canvas', () => {
    const layout = layoutGraph([], []);

    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

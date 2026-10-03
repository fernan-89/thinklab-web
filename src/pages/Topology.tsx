import { useMemo, useState } from 'react';
import { topologyApi } from '../api/services';
import type { TraversalDirection } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner } from '../components/Feedback';
import { GraphView } from '../topology/GraphView';
import { layoutGraph } from '../topology/layout';
import { useAsync } from '../useAsync';

const DIRECTIONS: { value: TraversalDirection; label: string; hint: string }[] = [
  { value: 'UPSTREAM', label: 'Upstream', hint: 'what is hit if the selected node fails' },
  { value: 'DOWNSTREAM', label: 'Downstream', hint: 'what the selected node depends on' },
  { value: 'BOTH', label: 'Both', hint: 'everything connected' },
];

export function TopologyPage() {
  const { api } = useSession();
  const topology = topologyApi(api);
  const [selectedId, setSelectedId] = useState<string>();
  const [direction, setDirection] = useState<TraversalDirection>('UPSTREAM');
  const [maxHops, setMaxHops] = useState(3);

  const graph = useAsync(async () => {
    const [nodes, edges] = await Promise.all([topology.nodes({ status: 'ACTIVE' }), topology.edges({ status: 'ACTIVE' })]);
    return { nodes, edges };
  }, []);
  const layout = useMemo(() => layoutGraph(graph.data?.nodes ?? [], graph.data?.edges ?? []), [graph.data]);

  const radius = useAsync(
    () => (selectedId ? topology.blastRadius(selectedId, direction, maxHops) : Promise.resolve(undefined)),
    [selectedId, direction, maxHops],
  );
  const impact = useMemo(
    () => new Map((radius.data?.impactedNodes ?? []).map((n) => [n.nodeId, n.hops] as const)),
    [radius.data],
  );
  const selected = graph.data?.nodes.find((n) => n.id === selectedId);
  const hint = DIRECTIONS.find((d) => d.value === direction)?.hint;

  return (
    <section>
      <h1>Topology</h1>
      <p className="muted">Select a node to see what a failure there would reach.</p>
      <ProblemBanner error={graph.error ?? radius.error} />
      {graph.data?.nodes.length === 0 && !graph.loading && <Empty>The graph is empty. Nodes and edges are added through the API.</Empty>}

      {(graph.data?.nodes.length ?? 0) > 0 && (
        <div className="split">
          <div className="graph-scroll">
            <GraphView layout={layout} selectedId={selectedId} impact={impact} onSelect={setSelectedId} />
          </div>
          <aside className="detail" aria-label="Blast radius">
            <h2>Blast radius</h2>
            {!selected ? (
              <p className="muted">No node selected.</p>
            ) : (
              <>
                <p><strong>{selected.label}</strong> <span className="muted">({selected.nodeType})</span></p>
                <div className="filters">
                  <select aria-label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as TraversalDirection)}>
                    {DIRECTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                  <label className="inline-field">
                    Hops
                    <input type="number" min={1} max={10} value={maxHops} onChange={(e) => setMaxHops(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
                  </label>
                </div>
                <p className="muted small">{hint}</p>
                {radius.loading ? (
                  <p className="muted">Calculating...</p>
                ) : radius.data && radius.data.impactedNodes.length === 0 ? (
                  <Empty>Nothing else is reached.</Empty>
                ) : (
                  <ol className="impact-list">
                    {[...(radius.data?.impactedNodes ?? [])]
                      .sort((a, b) => a.hops - b.hops || a.label.localeCompare(b.label))
                      .map((n) => (
                        <li key={n.nodeId}>
                          <span className={`hop hop-${Math.min(n.hops, 3)}`}>{n.hops}</span> {n.label} <span className="muted small">{n.nodeType}</span>
                        </li>
                      ))}
                  </ol>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

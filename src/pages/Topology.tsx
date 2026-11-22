import { useMemo, useState } from 'react';
import { topologyApi } from '../api/services';
import type { TraversalDirection } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner } from '../components/Feedback';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { GraphView } from '../topology/GraphView';
import { layoutGraph } from '../topology/layout';
import { useAsync } from '../useAsync';

const DIRECTIONS: { value: TraversalDirection; label: MessageKey; hint: MessageKey }[] = [
  { value: 'UPSTREAM', label: 'topology.upstream', hint: 'topology.upstreamHint' },
  { value: 'DOWNSTREAM', label: 'topology.downstream', hint: 'topology.downstreamHint' },
  { value: 'BOTH', label: 'topology.both', hint: 'topology.bothHint' },
];

export function TopologyPage() {
  const { t } = useI18n();
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
  const hintKey = DIRECTIONS.find((d) => d.value === direction)?.hint;

  return (
    <section>
      <h1>{t('nav.topology')}</h1>
      <p className="muted">{t('topology.intro')}</p>
      <ProblemBanner error={graph.error ?? radius.error} />
      {graph.data?.nodes.length === 0 && !graph.loading && <Empty>{t('topology.empty')}</Empty>}

      {(graph.data?.nodes.length ?? 0) > 0 && (
        <div className="split">
          <div className="graph-scroll">
            <GraphView layout={layout} selectedId={selectedId} impact={impact} onSelect={setSelectedId} />
          </div>
          <aside className="detail" aria-label={t('topology.blastRadius')}>
            <h2>{t('topology.blastRadius')}</h2>
            {!selected ? (
              <p className="muted">{t('topology.noSelection')}</p>
            ) : (
              <>
                <p><strong>{selected.label}</strong> <span className="muted">({selected.nodeType})</span></p>
                <div className="filters">
                  <select aria-label={t('topology.direction')} value={direction} onChange={(e) => setDirection(e.target.value as TraversalDirection)}>
                    {DIRECTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{t(d.label)}</option>
                    ))}
                  </select>
                  <label className="inline-field">
                    {t('topology.hops')}
                    <input type="number" min={1} max={10} value={maxHops} onChange={(e) => setMaxHops(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
                  </label>
                </div>
                <p className="muted small">{hintKey ? t(hintKey) : null}</p>
                {radius.loading ? (
                  <p className="muted">{t('topology.calculating')}</p>
                ) : radius.data && radius.data.impactedNodes.length === 0 ? (
                  <Empty>{t('topology.nothingReached')}</Empty>
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

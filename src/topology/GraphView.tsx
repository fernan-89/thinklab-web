import { NODE_HEIGHT, NODE_WIDTH, type GraphLayout } from './layout';

interface Props {
  layout: GraphLayout;
  selectedId?: string;
  /** nodeId -> hops from the selected node, for the nodes the blast radius reached. */
  impact: Map<string, number>;
  onSelect: (nodeId: string) => void;
}

function hopClass(hops: number | undefined): string {
  if (hops === undefined) return '';
  return hops === 1 ? 'impact-1' : hops === 2 ? 'impact-2' : 'impact-3';
}

export function GraphView({ layout, selectedId, impact, onSelect }: Props) {
  return (
    <svg className="graph" role="img" aria-label="Topology graph" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrow" />
        </marker>
      </defs>
      {layout.edges.map(({ edge, from, to }) => (
        <g key={edge.id}>
          <line
            className="edge"
            x1={from.x + NODE_WIDTH}
            y1={from.y + NODE_HEIGHT / 2}
            x2={to.x}
            y2={to.y + NODE_HEIGHT / 2}
            markerEnd="url(#arrow)"
          />
          <title>{edge.relationshipType}</title>
        </g>
      ))}
      {layout.nodes.map(({ node, x, y }) => {
        const hops = impact.get(node.id);
        const classes = ['node', hopClass(hops), node.id === selectedId ? 'selected' : ''].filter(Boolean).join(' ');
        return (
          <g
            key={node.id}
            className={classes}
            transform={`translate(${x}, ${y})`}
            tabIndex={0}
            role="button"
            aria-label={`${node.label}, ${node.nodeType}${hops !== undefined ? `, impacted at ${hops} hop${hops === 1 ? '' : 's'}` : ''}`}
            onClick={() => onSelect(node.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(node.id);
              }
            }}
          >
            <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} />
            <text x={NODE_WIDTH / 2} y={17} textAnchor="middle" className="node-label">{node.label.length > 20 ? `${node.label.slice(0, 19)}...` : node.label}</text>
            <text x={NODE_WIDTH / 2} y={31} textAnchor="middle" className="node-type">{node.nodeType}</text>
          </g>
        );
      })}
    </svg>
  );
}

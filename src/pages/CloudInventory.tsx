import { useState } from 'react';
import { cloudInventoryApi } from '../api/services';
import {
  RESOURCE_KINDS, RESOURCE_PRESENCES, RESOURCE_PROVIDERS, RESOURCE_STATES,
  type CloudResource, type ResourceKind, type ResourcePresence, type ResourceProvider, type ResourceState,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

const when = (value?: string) => (value ? new Date(value).toLocaleString() : undefined);

export function CloudInventoryPage() {
  const { api } = useSession();
  const inventory = cloudInventoryApi(api);
  const [providerFilter, setProviderFilter] = useState<ResourceProvider | ''>('');
  const [kindFilter, setKindFilter] = useState<ResourceKind | ''>('');
  const [stateFilter, setStateFilter] = useState<ResourceState | ''>('');
  const [presenceFilter, setPresenceFilter] = useState<ResourcePresence | ''>('');
  const [selectedId, setSelectedId] = useState<string>();

  const summary = useAsync(() => inventory.summary(), []);
  const list = useAsync(
    () => inventory.list({ provider: providerFilter || undefined, kind: kindFilter || undefined, state: stateFilter || undefined, presence: presenceFilter || undefined }),
    [providerFilter, kindFilter, stateFilter, presenceFilter],
  );
  const tiles: [string, number | undefined][] = [
    ['Missing', summary.data?.byPresence.MISSING ?? (summary.data ? 0 : undefined)],
    ['Present', summary.data?.byPresence.PRESENT ?? (summary.data ? 0 : undefined)],
    ['Gone', summary.data?.byPresence.GONE ?? (summary.data ? 0 : undefined)],
    ['AWS', summary.data?.byProvider.AWS ?? (summary.data ? 0 : undefined)],
    ['Azure', summary.data?.byProvider.AZURE ?? (summary.data ? 0 : undefined)],
    ['Total', summary.data?.total],
  ];

  return (
    <section>
      <div className="page-head">
        <h1>Cloud inventory</h1>
      </div>
      <p className="muted">What the AWS and Azure accounts run, as the discovery tools last reported it. Nobody edits a resource here: the tools say what exists. A resource the tools have not seen for a while is missing; one they said was terminated is gone.</p>
      <div className="tiles" aria-label="Summary">
        {tiles.map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={summary.error} />
      <div className="filters">
        <select aria-label="Provider" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value as ResourceProvider | '')}>
          <option value="">Any provider</option>
          {RESOURCE_PROVIDERS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Kind" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ResourceKind | '')}>
          <option value="">Any kind</option>
          {RESOURCE_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="State" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as ResourceState | '')}>
          <option value="">Any state</option>
          {RESOURCE_STATES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Presence" value={presenceFilter} onChange={(e) => setPresenceFilter(e.target.value as ResourcePresence | '')}>
          <option value="">Any presence</option>
          {RESOURCE_PRESENCES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No resources match.</Empty> : (
          <table aria-label="Resources">
            <thead><tr><th>Name</th><th>Provider</th><th>Kind</th><th>Region</th><th>State</th><th>Presence</th><th>Last seen</th></tr></thead>
            <tbody>
              {list.data?.map((resource) => (
                <tr key={resource.id} className={resource.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(resource.id)}>{resource.name}</button></td>
                  <td>{resource.provider}</td>
                  <td>{resource.kind}</td>
                  <td>{resource.region}</td>
                  <td>{resource.state}</td>
                  <td><StatusBadge status={resource.presence} /></td>
                  <td>{when(resource.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <ResourceDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} />}
      </div>
    </section>
  );
}

function ResourceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { api } = useSession();
  const detail = useAsync<CloudResource>(() => cloudInventoryApi(api).retrieve(id), [id]);
  const resource = detail.data;
  const tags = resource ? Object.entries(resource.tags) : [];

  return (
    <aside className="detail" aria-label="Resource detail">
      <div className="detail-head">
        <h2>{resource?.name ?? 'Resource'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={detail.error} />
      {resource && (
        <>
          <p><StatusBadge status={resource.presence} /> <StatusBadge status={resource.state} /></p>
          <dl>
            <dt>Provider id</dt><dd className="code">{resource.externalId}</dd>
            <dt>Provider</dt><dd>{resource.provider}, {resource.kind.toLowerCase()}, in {resource.region}</dd>
            <dt>Account</dt><dd className="code">{resource.accountId}</dd>
            <dt>First seen</dt><dd>{when(resource.firstSeenAt)}</dd>
            <dt>Last seen</dt><dd>{when(resource.lastSeenAt)}</dd>
            <dt>Last changed</dt><dd>{when(resource.updatedAt)}</dd>
          </dl>
          <h3>Tags</h3>
          {tags.length === 0 ? <Empty>No tags reported.</Empty> : (
            <dl aria-label="Tags">
              {tags.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
            </dl>
          )}
        </>
      )}
    </aside>
  );
}

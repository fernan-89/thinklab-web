import { useState } from 'react';
import { discoveryApi } from '../api/services';
import { ASSET_CATEGORIES, DISCOVERED_ITEM_STATUSES, type AssetCategory, type DiscoveredItem, type DiscoveredItemStatus } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

export function DiscoveryPage() {
  const { api } = useSession();
  const discovery = discoveryApi(api);
  const [status, setStatus] = useState<DiscoveredItemStatus | ''>('DISCOVERED');
  const list = useAsync(() => discovery.list({ status: status || undefined }), [status]);

  return (
    <section>
      <h1>Discovery</h1>
      <p className="muted">Items reported by collectors wait here until someone reviews them. Promoting one creates the real asset.</p>
      <div className="filters">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as DiscoveredItemStatus | '')}>
          <option value="">All statuses</option>
          {DISCOVERED_ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} items`}</span>
      </div>
      <ProblemBanner error={list.error} />
      {list.data?.length === 0 && !list.loading && <Empty>Nothing to review.</Empty>}
      <ul className="cards">
        {list.data?.map((item) => (
          <ItemCard key={item.id} item={item} onChanged={list.reload} />
        ))}
      </ul>
    </section>
  );
}

function ItemCard({ item, onChanged }: { item: DiscoveredItem; onChanged: () => void }) {
  const { api } = useSession();
  const discovery = discoveryApi(api);
  const [category, setCategory] = useState<AssetCategory | ''>(item.suggestedCategory ?? '');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  async function run(step: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await step();
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setBusy(false);
    }
  }

  const attributes = Object.entries(item.rawAttributes ?? {});
  return (
    <li className="card">
      <div className="card-head">
        <h2>{item.name}</h2>
        <StatusBadge status={item.status} />
      </div>
      <p className="muted small">
        {item.source} - <code>{item.externalKey}</code> - last seen {new Date(item.lastSeenAt).toLocaleString()}
      </p>
      {attributes.length > 0 && (
        <dl className="inline">
          {attributes.map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
      {item.promotedAssetId && <p>Promoted to asset <code>{item.promotedAssetId}</code></p>}
      <ProblemBanner error={error} />

      {item.status === 'DISCOVERED' && (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => run(() => discovery.claim(item.id))}>Claim for review</button>
          <button type="button" disabled={busy} onClick={() => run(() => discovery.ignore(item.id))}>Ignore</button>
        </div>
      )}
      {item.status === 'UNDER_REVIEW' && (
        <div className="actions">
          <label className="inline-field">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value as AssetCategory | '')}>
              <option value="">Choose...</option>
              {ASSET_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || category === '' || category === item.suggestedCategory}
            onClick={() => run(() => discovery.reviewUpdate(item.id, { suggestedCategory: category as AssetCategory }))}
          >
            Save category
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !item.suggestedCategory}
            title={item.suggestedCategory ? undefined : 'Save a category first'}
            onClick={() => run(() => discovery.promote(item.id))}
          >
            Promote to asset
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => discovery.ignore(item.id))}>Ignore</button>
        </div>
      )}
    </li>
  );
}

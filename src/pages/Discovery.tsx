import { useState } from 'react';
import { discoveryApi } from '../api/services';
import { ASSET_CATEGORIES, DISCOVERED_ITEM_STATUSES, type AssetCategory, type DiscoveredItem, type DiscoveredItemStatus } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useI18n } from '../i18n';
import { useAsync } from '../useAsync';

export function DiscoveryPage() {
  const { t, status: statusLabel } = useI18n();
  const { api } = useSession();
  const discovery = discoveryApi(api);
  const [status, setStatus] = useState<DiscoveredItemStatus | ''>('DISCOVERED');
  const list = useAsync(() => discovery.list({ status: status || undefined }), [status]);

  return (
    <section>
      <h1>{t('nav.discovery')}</h1>
      <p className="muted">{t('discovery.intro')}</p>
      <div className="filters">
        <select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as DiscoveredItemStatus | '')}>
          <option value="">{t('common.allStatuses')}</option>
          {DISCOVERED_ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('discovery.count', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      {list.data?.length === 0 && !list.loading && <Empty>{t('discovery.empty')}</Empty>}
      <ul className="cards">
        {list.data?.map((item) => (
          <ItemCard key={item.id} item={item} onChanged={list.reload} />
        ))}
      </ul>
    </section>
  );
}

function ItemCard({ item, onChanged }: { item: DiscoveredItem; onChanged: () => void }) {
  const { t, locale } = useI18n();
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
        {item.source} - <code>{item.externalKey}</code> - {t('discovery.lastSeen', { when: new Date(item.lastSeenAt).toLocaleString(locale) })}
      </p>
      {attributes.length > 0 && (
        <dl className="inline">
          {attributes.map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
      {item.promotedAssetId && <p>{t('discovery.promotedTo')} <code>{item.promotedAssetId}</code></p>}
      <ProblemBanner error={error} />

      {item.status === 'DISCOVERED' && (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => run(() => discovery.claim(item.id))}>{t('discovery.claim')}</button>
          <button type="button" disabled={busy} onClick={() => run(() => discovery.ignore(item.id))}>{t('discovery.ignore')}</button>
        </div>
      )}
      {item.status === 'UNDER_REVIEW' && (
        <div className="actions">
          <label className="inline-field">
            {t('common.category')}
            <select value={category} onChange={(e) => setCategory(e.target.value as AssetCategory | '')}>
              <option value="">{t('common.choose')}</option>
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
            {t('discovery.saveCategory')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !item.suggestedCategory}
            title={item.suggestedCategory ? undefined : t('discovery.saveCategoryFirst')}
            onClick={() => run(() => discovery.promote(item.id))}
          >
            {t('discovery.promote')}
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => discovery.ignore(item.id))}>{t('discovery.ignore')}</button>
        </div>
      )}
    </li>
  );
}

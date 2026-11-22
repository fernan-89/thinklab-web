import { useState } from 'react';
import { ASSET_ACTIONS, assetApi, type AssetAction } from '../api/services';
import { ASSET_CATEGORIES, ASSET_STATUSES, type Asset, type AssetCategory, type AssetStatus, type AuditEntry } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useI18n } from '../i18n';
import { useAsync } from '../useAsync';
import { NewAssetForm } from './NewAssetForm';

export function AssetsPage() {
  const { t, status: statusLabel } = useI18n();
  const { api } = useSession();
  const assets = assetApi(api);
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [category, setCategory] = useState<AssetCategory | ''>('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const list = useAsync(() => assets.list({ status: status || undefined, category: category || undefined }), [status, category]);
  const needle = query.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (asset) => !needle || asset.name.toLowerCase().includes(needle) || asset.serialNumber.toLowerCase().includes(needle),
  );

  return (
    <section>
      <div className="page-head">
        <h1>{t('nav.assets')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('assets.new')}</button>
      </div>
      {creating && (
        <NewAssetForm
          onCancel={() => setCreating(false)}
          onCreated={(asset) => {
            setCreating(false);
            setSelectedId(asset.id);
            list.reload();
          }}
        />
      )}
      <div className="filters">
        <input type="search" aria-label={t('assets.searchLabel')} placeholder={t('assets.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as AssetStatus | '')}>
          <option value="">{t('common.allStatuses')}</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <select aria-label={t('common.category')} value={category} onChange={(e) => setCategory(e.target.value as AssetCategory | '')}>
          <option value="">{t('common.allCategories')}</option>
          {ASSET_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: rows.length })}</span>
      </div>

      <ProblemBanner error={list.error} />

      <div className="split">
        {rows.length === 0 && !list.loading ? (
          <Empty>{t('assets.empty')}</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>{t('common.name')}</th><th>{t('common.category')}</th><th>{t('assets.col.serial')}</th><th>{t('common.status')}</th></tr>
            </thead>
            <tbody>
              {rows.map((asset) => (
                <tr key={asset.id} className={asset.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(asset.id)}>{asset.name}</button></td>
                  <td>{asset.category}</td>
                  <td><code>{asset.serialNumber}</code></td>
                  <td><StatusBadge status={asset.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && (
          <AssetDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={list.reload} />
        )}
      </div>
    </section>
  );
}

function AssetDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, status: statusLabel, action: actionLabel, locale } = useI18n();
  const { api } = useSession();
  const assets = assetApi(api);
  const detail = useAsync<{ asset: Asset; audit: AuditEntry[] }>(
    async () => ({ asset: await assets.retrieve(id), audit: await assets.auditLog(id) }),
    [id],
  );
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  async function run(action: AssetAction) {
    setBusy(true);
    setActionError(undefined);
    try {
      await assets.control(id, action);
      detail.reload();
      onChanged();
    } catch (failure) {
      setActionError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setBusy(false);
    }
  }

  const asset = detail.data?.asset;
  const specifications = Object.entries(asset?.specifications ?? {});
  return (
    <aside className="detail" aria-label={t('assets.detail')}>
      <div className="detail-head">
        <h2>{asset?.name ?? t('assets.detailFallback')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={detail.error ?? actionError} />
      {asset && (
        <>
          <dl>
            <dt>{t('common.status')}</dt><dd><StatusBadge status={asset.status} /></dd>
            <dt>{t('common.category')}</dt><dd>{asset.category}</dd>
            <dt>{t('assets.col.serial')}</dt><dd><code>{asset.serialNumber}</code></dd>
            <dt>Id</dt><dd><code>{asset.id}</code></dd>
          </dl>
          {specifications.length > 0 && (
            <>
              <h3>{t('assets.specifications')}</h3>
              <dl>
                {specifications.map(([key, value]) => (
                  <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </>
          )}
          <div className="actions">
            {ASSET_ACTIONS[asset.status].map(({ action, label }) => (
              <button key={action} type="button" disabled={busy} onClick={() => run(action)}>{actionLabel(label)}</button>
            ))}
          </div>
          <h3>{t('assets.auditLog')}</h3>
          <ol className="audit">
            {detail.data?.audit.map((entry) => (
              <li key={`${entry.occurredAt}-${entry.action}`}>
                <strong>{entry.action}</strong> {t('assets.audit.by', { executor: entry.executor })}
                {entry.fromStatus && entry.toStatus && entry.fromStatus !== entry.toStatus && t('assets.audit.fromTo', { from: statusLabel(entry.fromStatus), to: statusLabel(entry.toStatus) })}
                <div className="muted small">{new Date(entry.occurredAt).toLocaleString(locale)}{entry.detail ? ` - ${entry.detail}` : ''}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

import { useState } from 'react';
import { cloudInventoryApi } from '../api/services';
import {
  RESOURCE_KINDS, RESOURCE_PRESENCES, RESOURCE_PROVIDERS, RESOURCE_STATES,
  type CloudResource, type ResourceKind, type ResourcePresence, type ResourceProvider, type ResourceState,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : undefined);

export function CloudInventoryPage() {
  const { t, locale, enumValue } = useI18n();
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
    [t('procurement.total'), summary.data?.total],
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('nav.cloudInventory')}</h1>
      </div>
      <p className="muted">{t('cloudinv.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {tiles.map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={summary.error} />
      <div className="filters">
        <select aria-label={t('integrations.provider')} value={providerFilter} onChange={(e) => setProviderFilter(e.target.value as ResourceProvider | '')}>
          <option value="">{t('cloudcosts.anyProvider')}</option>
          {RESOURCE_PROVIDERS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label={t('ops.kind')} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ResourceKind | '')}>
          <option value="">{t('vendors.anyKind')}</option>
          {RESOURCE_KINDS.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <select aria-label={t('cloudinv.state')} value={stateFilter} onChange={(e) => setStateFilter(e.target.value as ResourceState | '')}>
          <option value="">{t('cloudinv.anyState')}</option>
          {RESOURCE_STATES.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <select aria-label={t('cloudinv.presence')} value={presenceFilter} onChange={(e) => setPresenceFilter(e.target.value as ResourcePresence | '')}>
          <option value="">{t('cloudinv.anyPresence')}</option>
          {RESOURCE_PRESENCES.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('cloudinv.noResources')}</Empty> : (
          <table aria-label={t('cloudinv.resources')}>
            <thead><tr><th>{t('common.name')}</th><th>{t('integrations.provider')}</th><th>{t('ops.kind')}</th><th>{t('cloudinv.region')}</th><th>{t('cloudinv.state')}</th><th>{t('cloudinv.presence')}</th><th>{t('cloudinv.lastSeen')}</th></tr></thead>
            <tbody>
              {list.data?.map((resource) => (
                <tr key={resource.id} className={resource.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(resource.id)}>{resource.name}</button></td>
                  <td>{resource.provider}</td>
                  <td>{resource.kind}</td>
                  <td>{resource.region}</td>
                  <td>{resource.state}</td>
                  <td><StatusBadge status={resource.presence} /></td>
                  <td>{when(resource.lastSeenAt, locale)}</td>
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
  const { t, locale } = useI18n();
  const { api } = useSession();
  const detail = useAsync<CloudResource>(() => cloudInventoryApi(api).retrieve(id), [id]);
  const resource = detail.data;
  const tags = resource ? Object.entries(resource.tags) : [];

  return (
    <aside className="detail" aria-label={t('cloudinv.detail')}>
      <div className="detail-head">
        <h2>{resource?.name ?? t('cloudinv.fallback')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={detail.error} />
      {resource && (
        <>
          <p><StatusBadge status={resource.presence} /> <StatusBadge status={resource.state} /></p>
          <dl>
            <dt>{t('cloudinv.providerId')}</dt><dd className="code">{resource.externalId}</dd>
            <dt>{t('integrations.provider')}</dt><dd>{resource.provider}, {resource.kind.toLowerCase()}, in {resource.region}</dd>
            <dt>{t('cloudcosts.account')}</dt><dd className="code">{resource.accountId}</dd>
            <dt>{t('cloudinv.firstSeen')}</dt><dd>{when(resource.firstSeenAt, locale)}</dd>
            <dt>{t('cloudinv.lastSeen')}</dt><dd>{when(resource.lastSeenAt, locale)}</dd>
            <dt>{t('cloudinv.lastChanged')}</dt><dd>{when(resource.updatedAt, locale)}</dd>
          </dl>
          <h3>{t('cloudinv.tags')}</h3>
          {tags.length === 0 ? <Empty>{t('cloudinv.noTags')}</Empty> : (
            <dl aria-label={t('cloudinv.tags')}>
              {tags.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
            </dl>
          )}
        </>
      )}
    </aside>
  );
}

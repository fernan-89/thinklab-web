import { useState, type FormEvent } from 'react';
import { cloudCostApi, vendorApi } from '../api/services';
import {
  CLOUD_PROVIDERS, COST_CURRENCIES, COST_LEVELS, POLICY_STATUSES,
  type AuditEntry, type CloudAccount, type CloudProvider, type CostCurrency, type CostLevel, type CostReport, type PolicyStatus,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : undefined);

/** An amount in the account's own currency, always with two decimals: amounts are never converted. */
const money = (amount: number, currency: CostCurrency) => `${amount.toFixed(2)} ${currency}`;

export function CloudCostsPage() {
  const { t, enumValue, status: statusLabel } = useI18n();
  const { api } = useSession();
  const accounts = cloudCostApi(api);
  const [levelFilter, setLevelFilter] = useState<CostLevel | ''>('');
  const [providerFilter, setProviderFilter] = useState<CloudProvider | ''>('');
  const [currencyFilter, setCurrencyFilter] = useState<CostCurrency | ''>('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => accounts.list({}), []);
  const list = useAsync(
    () => accounts.list({ level: levelFilter || undefined, provider: providerFilter || undefined, currency: currencyFilter || undefined, status: statusFilter || undefined }),
    [levelFilter, providerFilter, currencyFilter, statusFilter],
  );
  const reloadAll = () => { list.reload(); everything.reload(); };
  const count = (level: CostLevel) => everything.data?.filter((account) => account.level === level).length;

  return (
    <section>
      <div className="page-head">
        <h1>{t('nav.cloudCosts')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('cloudcosts.newAccount')}</button>
      </div>
      <p className="muted">{t('cloudcosts.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {([[t('cloudcosts.overBudget'), count('OVER_BUDGET')], [t('cloudcosts.nearBudget'), count('NEAR_BUDGET')], ['OK', count('OK')], [t('cloudcosts.nothingThisMonth'), count('NO_DATA')], ['Paused', count('PAUSED')], [t('procurement.total'), everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewAccountForm onCancel={() => setCreating(false)} onCreated={(account) => { setCreating(false); setSelectedId(account.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label={t('ops.level')} value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as CostLevel | '')}>
          <option value="">{t('capacity.anyLevel')}</option>
          {COST_LEVELS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('integrations.provider')} value={providerFilter} onChange={(e) => setProviderFilter(e.target.value as CloudProvider | '')}>
          <option value="">{t('cloudcosts.anyProvider')}</option>
          {CLOUD_PROVIDERS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label={t('procurement.currency')} value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value as CostCurrency | '')}>
          <option value="">{t('procurement.anyCurrency')}</option>
          {COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label={t('common.status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PolicyStatus | '')}>
          <option value="">{t('ops.activePaused')}</option>
          {POLICY_STATUSES.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('cloudcosts.noAccounts')}</Empty> : (
          <table aria-label={t('cloudcosts.accounts')}>
            <thead><tr><th>{t('cloudcosts.account')}</th><th>{t('integrations.provider')}</th><th>{t('ops.level')}</th><th>{t('cloudcosts.spent')}</th><th>{t('cloudcosts.headingTo')}</th></tr></thead>
            <tbody>
              {list.data?.map((account) => (
                <tr key={account.id} className={account.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(account.id)}>{account.name}</button></td>
                  <td>{account.provider}</td>
                  <td><StatusBadge status={account.level} />{account.stale && <span className="stale-note"> {t('cloudcosts.noRecentReport')}</span>}</td>
                  <td>{account.spent === undefined ? <span className="muted">-</span> : t('cloudcosts.ofBudget', { spent: money(account.spent, account.currency), budget: account.monthlyBudget.toFixed(2) })}</td>
                  <td>{account.projected === undefined ? <span className="muted">-</span> : money(account.projected, account.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <AccountDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={reloadAll} />}
      </div>
    </section>
  );
}

function NewAccountForm({ onCreated, onCancel }: { onCreated: (account: CloudAccount) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const vendors = useAsync(() => vendorApi(api).vendors({ status: 'ACTIVE' }), []);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<CloudProvider>('AWS');
  const [externalId, setExternalId] = useState('');
  const [currency, setCurrency] = useState<CostCurrency>('USD');
  const [budget, setBudget] = useState('');
  const [warn, setWarn] = useState('80');
  const [reportEvery, setReportEvery] = useState('24');
  const [vendorId, setVendorId] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && externalId.trim() !== '' && [budget, warn, reportEvery].every((value) => value.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await cloudCostApi(api).create({
        name: name.trim(), provider, externalId: externalId.trim(), currency, monthlyBudget: Number(budget), warnPercent: Number(warn),
        reportEveryHours: Number(reportEvery), vendorId: vendorId || undefined,
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={t('cloudcosts.newAccount')} onSubmit={submit}>
      <h2>{t('cloudcosts.newCloudAccount')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('integrations.provider')}
        <select value={provider} onChange={(e) => setProvider(e.target.value as CloudProvider)}>{CLOUD_PROVIDERS.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>{t('cloudcosts.accountId')}<input value={externalId} maxLength={64} onChange={(e) => setExternalId(e.target.value)} /></label>
      <label>{t('cloudcosts.currencyInput')}
        <select value={currency} onChange={(e) => setCurrency(e.target.value as CostCurrency)}>{COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>{t('cloudcosts.budgetInput')}<input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
      <label>{t('cloudcosts.warnInput')}<input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
      <label>{t('capacity.reportsInput')}<input inputMode="numeric" value={reportEvery} onChange={(e) => setReportEvery(e.target.value)} /></label>
      <label>{t('licences.vendorOptional')}
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">{t('licences.none')}</option>
          {vendors.data?.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      </label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('cloudcosts.create')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function AccountDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { api } = useSession();
  const accounts = cloudCostApi(api);
  const detail = useAsync<{ account: CloudAccount; reports: CostReport[]; trail: AuditEntry[] }>(async () => {
    const [account, reports, trail] = await Promise.all([accounts.retrieve(id), accounts.reports({ accountId: id }), accounts.auditLog(id)]);
    return { account, reports, trail };
  }, [id]);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const account = detail.data?.account;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
      detail.reload();
      onChanged();
    }
  }

  return (
    <aside className="detail" aria-label={t('cloudcosts.detail')}>
      <div className="detail-head">
        <h2>{account?.name ?? t('cloudcosts.account')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {account && (
        <>
          <p><StatusBadge status={account.level} /> <StatusBadge status={account.status} /></p>
          <dl>
            <dt>{t('cloudcosts.account')}</dt><dd>{account.provider} {account.externalId}</dd>
            <dt>{t('cloudcosts.budget')}</dt><dd>{t('cloudcosts.budgetText', { budget: money(account.monthlyBudget, account.currency), warn: account.warnPercent })}</dd>
            {account.spent !== undefined && <><dt>{account.month}</dt><dd>{t('cloudcosts.spentText', { spent: money(account.spent, account.currency), percent: account.usedPercent?.toFixed(1) ?? '', projected: money(account.projected ?? 0, account.currency) })}</dd></>}
            <dt>{t('capacity.reports')}</dt><dd>{t('licences.expectedEvery', { hours: account.reportEveryHours })}{account.lastReportedAt ? t('cloudcosts.lastAt', { when: when(account.lastReportedAt, locale) ?? '' }) : ''}{account.stale ? t('licences.stale') : ''}</dd>
          </dl>
          <div className="actions" aria-label={t('itsm.actions')}>
            {account.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => accounts.control(id, 'pause'))}>{t('ops.pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => accounts.control(id, 'resume'))}>{t('ops.resume')}</button>}
          </div>
          <h3>{t('cloudcosts.recentDays')}</h3>
          <p className="muted small">{t('cloudcosts.correction')}</p>
          {detail.data?.reports.length === 0 ? <Empty>{t('cloudcosts.noCosts')}</Empty> : (
            <table aria-label={t('cloudcosts.recentDays')}>
              <thead><tr><th>{t('cloudcosts.day')}</th><th>{t('cloudcosts.cost')}</th><th>{t('ops.by')}</th></tr></thead>
              <tbody>
                {detail.data?.reports.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.day}</td>
                    <td>{money(entry.amount, account.currency)}</td>
                    <td>{entry.reportedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>{t('itsm.history')}</h3>
          <ol className="audit">
            {detail.data?.trail.map((entry) => (
              <li key={`${entry.occurredAt}-${entry.action}`}>
                <strong>{entry.action}</strong> by {entry.executor}
                <div className="muted small">{new Date(entry.occurredAt).toLocaleString(locale)}{entry.detail ? ` - ${entry.detail}` : ''}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

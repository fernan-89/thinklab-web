import { useState, type FormEvent } from 'react';
import { cloudCostApi, vendorApi } from '../api/services';
import {
  CLOUD_PROVIDERS, COST_CURRENCIES, COST_LEVELS, POLICY_STATUSES,
  type AuditEntry, type CloudAccount, type CloudProvider, type CostCurrency, type CostLevel, type CostReport, type PolicyStatus,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value?: string) => (value ? new Date(value).toLocaleString() : undefined);

/** An amount in the account's own currency, always with two decimals: amounts are never converted. */
const money = (amount: number, currency: CostCurrency) => `${amount.toFixed(2)} ${currency}`;

export function CloudCostsPage() {
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
        <h1>Cloud costs</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New account</button>
      </div>
      <p className="muted">What each cloud account has cost this month against its monthly budget. A billing tool reports what each day cost, in the account's own currency (amounts are never converted); where the month is heading, and whether it is near or over budget, is worked out when you look.</p>
      <div className="tiles" aria-label="Summary">
        {([['Over budget', count('OVER_BUDGET')], ['Near budget', count('NEAR_BUDGET')], ['OK', count('OK')], ['Nothing this month', count('NO_DATA')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewAccountForm onCancel={() => setCreating(false)} onCreated={(account) => { setCreating(false); setSelectedId(account.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Level" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as CostLevel | '')}>
          <option value="">Any level</option>
          {COST_LEVELS.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
        </select>
        <select aria-label="Provider" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value as CloudProvider | '')}>
          <option value="">Any provider</option>
          {CLOUD_PROVIDERS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Currency" value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value as CostCurrency | '')}>
          <option value="">Any currency</option>
          {COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PolicyStatus | '')}>
          <option value="">Active and paused</option>
          {POLICY_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No accounts match.</Empty> : (
          <table aria-label="Cloud accounts">
            <thead><tr><th>Account</th><th>Provider</th><th>Level</th><th>Spent this month</th><th>Heading to</th></tr></thead>
            <tbody>
              {list.data?.map((account) => (
                <tr key={account.id} className={account.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(account.id)}>{account.name}</button></td>
                  <td>{account.provider}</td>
                  <td><StatusBadge status={account.level} />{account.stale && <span className="stale-note"> no recent report</span>}</td>
                  <td>{account.spent === undefined ? <span className="muted">-</span> : `${money(account.spent, account.currency)} of ${account.monthlyBudget.toFixed(2)}`}</td>
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
    <form className="card form" aria-label="New account" onSubmit={submit}>
      <h2>New cloud account</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Provider
        <select value={provider} onChange={(e) => setProvider(e.target.value as CloudProvider)}>{CLOUD_PROVIDERS.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>The provider's account id<input value={externalId} maxLength={64} onChange={(e) => setExternalId(e.target.value)} /></label>
      <label>Currency (fixed once created)
        <select value={currency} onChange={(e) => setCurrency(e.target.value as CostCurrency)}>{COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>Monthly budget<input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
      <label>Warn at (percent spent)<input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
      <label>The tool reports every (hours)<input inputMode="numeric" value={reportEvery} onChange={(e) => setReportEvery(e.target.value)} /></label>
      <label>Vendor (optional)
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">None</option>
          {vendors.data?.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      </label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create account'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function AccountDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
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
    <aside className="detail" aria-label="Account detail">
      <div className="detail-head">
        <h2>{account?.name ?? 'Account'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {account && (
        <>
          <p><StatusBadge status={account.level} /> <StatusBadge status={account.status} /></p>
          <dl>
            <dt>Account</dt><dd>{account.provider} {account.externalId}</dd>
            <dt>Budget</dt><dd>{money(account.monthlyBudget, account.currency)} a month, warn at {account.warnPercent}%</dd>
            {account.spent !== undefined && <><dt>{account.month}</dt><dd>{money(account.spent, account.currency)} spent ({account.usedPercent?.toFixed(1)}%), heading to {money(account.projected ?? 0, account.currency)}</dd></>}
            <dt>Reports</dt><dd>expected every {account.reportEveryHours} h{account.lastReportedAt ? `, last at ${when(account.lastReportedAt)}` : ''}{account.stale ? ', older than twice the expected interval' : ''}</dd>
          </dl>
          <div className="actions" aria-label="Actions">
            {account.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => accounts.control(id, 'pause'))}>Pause</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => accounts.control(id, 'resume'))}>Resume</button>}
          </div>
          <h3>Recent days</h3>
          <p className="muted small">A day reported again with another amount is a correction: the latest one counts.</p>
          {detail.data?.reports.length === 0 ? <Empty>No costs reported yet.</Empty> : (
            <table aria-label="Recent days">
              <thead><tr><th>Day</th><th>Cost</th><th>By</th></tr></thead>
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
          <h3>History</h3>
          <ol className="audit">
            {detail.data?.trail.map((entry) => (
              <li key={`${entry.occurredAt}-${entry.action}`}>
                <strong>{entry.action}</strong> by {entry.executor}
                <div className="muted small">{new Date(entry.occurredAt).toLocaleString()}{entry.detail ? ` - ${entry.detail}` : ''}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

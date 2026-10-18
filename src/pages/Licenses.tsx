import { useState, type FormEvent } from 'react';
import { licenseApi, vendorApi } from '../api/services';
import {
  LICENSE_LEVELS, LICENSE_UNITS, POLICY_STATUSES,
  type AuditEntry, type License, type LicenseLevel, type LicenseUnit, type PolicyStatus, type UsageReport,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value?: string) => (value ? new Date(value).toLocaleString() : undefined);

/** How many seats are left, in words: negative is seats too many. */
function seatsLeft(license: License): string {
  if (license.available === undefined) return '-';
  if (license.available < 0) return `${-license.available} too many`;
  return `${license.available} left`;
}

export function LicensesPage() {
  const { api } = useSession();
  const licenses = licenseApi(api);
  const [levelFilter, setLevelFilter] = useState<LicenseLevel | ''>('');
  const [unitFilter, setUnitFilter] = useState<LicenseUnit | ''>('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => licenses.list({}), []);
  const list = useAsync(
    () => licenses.list({ level: levelFilter || undefined, unit: unitFilter || undefined, status: statusFilter || undefined }),
    [levelFilter, unitFilter, statusFilter],
  );
  const reloadAll = () => { list.reload(); everything.reload(); };
  const count = (level: LicenseLevel) => everything.data?.filter((license) => license.level === level).length;

  return (
    <section>
      <div className="page-head">
        <h1>Licenses</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New licence</button>
      </div>
      <p className="muted">How many seats of each product were bought and how many are in use. The inventory tools report a count of seats in use (never who holds them); whether a licence is near or over its limit is worked out when you look.</p>
      <div className="tiles" aria-label="Summary">
        {([['Over the limit', count('OVER_LIMIT')], ['Near the limit', count('NEAR_LIMIT')], ['OK', count('OK')], ['No count yet', count('NO_DATA')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewLicenseForm onCancel={() => setCreating(false)} onCreated={(license) => { setCreating(false); setSelectedId(license.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Level" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as LicenseLevel | '')}>
          <option value="">Any level</option>
          {LICENSE_LEVELS.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
        </select>
        <select aria-label="Unit" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value as LicenseUnit | '')}>
          <option value="">Any unit</option>
          {LICENSE_UNITS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PolicyStatus | '')}>
          <option value="">Active and paused</option>
          {POLICY_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No licences match.</Empty> : (
          <table aria-label="Licences">
            <thead><tr><th>Product</th><th>Unit</th><th>Level</th><th>In use</th><th>Seats</th></tr></thead>
            <tbody>
              {list.data?.map((license) => (
                <tr key={license.id} className={license.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(license.id)}>{license.product}</button></td>
                  <td>{license.unit}</td>
                  <td><StatusBadge status={license.level} />{license.stale && <span className="stale-note"> no recent count</span>}</td>
                  <td>{license.lastInUse === undefined ? <span className="muted">-</span> : `${license.lastInUse} of ${license.entitled}`}</td>
                  <td>{seatsLeft(license)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <LicenseDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={reloadAll} />}
      </div>
    </section>
  );
}

function NewLicenseForm({ onCreated, onCancel }: { onCreated: (license: License) => void; onCancel: () => void }) {
  const { api } = useSession();
  const vendors = useAsync(() => vendorApi(api).vendors({ status: 'ACTIVE' }), []);
  const [product, setProduct] = useState('');
  const [unit, setUnit] = useState<LicenseUnit>('USER');
  const [entitled, setEntitled] = useState('');
  const [warn, setWarn] = useState('90');
  const [reportEvery, setReportEvery] = useState('24');
  const [vendorId, setVendorId] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = product.trim() !== '' && [entitled, warn, reportEvery].every((value) => value.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await licenseApi(api).create({
        product: product.trim(), unit, entitled: Number(entitled), warnPercent: Number(warn), reportEveryHours: Number(reportEvery), vendorId: vendorId || undefined,
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New licence" onSubmit={submit}>
      <h2>New licence</h2>
      <label>Product<input value={product} maxLength={80} onChange={(e) => setProduct(e.target.value)} /></label>
      <label>A seat is one
        <select value={unit} onChange={(e) => setUnit(e.target.value as LicenseUnit)}>{LICENSE_UNITS.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>Seats bought<input inputMode="numeric" value={entitled} onChange={(e) => setEntitled(e.target.value)} /></label>
      <label>Warn at (percent in use)<input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
      <label>The tool reports every (hours)<input inputMode="numeric" value={reportEvery} onChange={(e) => setReportEvery(e.target.value)} /></label>
      <label>Vendor (optional)
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">None</option>
          {vendors.data?.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      </label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create licence'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function LicenseDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const licenses = licenseApi(api);
  const detail = useAsync<{ license: License; reports: UsageReport[]; trail: AuditEntry[] }>(async () => {
    const [license, reports, trail] = await Promise.all([licenses.retrieve(id), licenses.reports({ licenseId: id }), licenses.auditLog(id)]);
    return { license, reports, trail };
  }, [id]);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const license = detail.data?.license;

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
    <aside className="detail" aria-label="Licence detail">
      <div className="detail-head">
        <h2>{license?.product ?? 'Licence'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {license && (
        <>
          <p><StatusBadge status={license.level} /> <StatusBadge status={license.status} /></p>
          <dl>
            <dt>Bought</dt><dd>{license.entitled} seats, one per {license.unit.toLowerCase()}, warn at {license.warnPercent}%</dd>
            {license.lastInUse !== undefined && <><dt>Latest count</dt><dd>{license.lastInUse} in use ({license.usagePercent?.toFixed(1)}%, {seatsLeft(license)}) at {when(license.lastMeasuredAt)}{license.stale ? ', older than twice the expected interval' : ''}</dd></>}
            <dt>Reports</dt><dd>expected every {license.reportEveryHours} h</dd>
          </dl>
          <div className="actions" aria-label="Actions">
            {license.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => licenses.control(id, 'pause'))}>Pause</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => licenses.control(id, 'resume'))}>Resume</button>}
          </div>
          <h3>Recent counts</h3>
          {detail.data?.reports.length === 0 ? <Empty>No counts reported yet.</Empty> : (
            <table aria-label="Recent counts">
              <thead><tr><th>Counted</th><th>In use</th><th>By</th></tr></thead>
              <tbody>
                {detail.data?.reports.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.measuredAt).toLocaleString()}</td>
                    <td>{entry.inUse}</td>
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

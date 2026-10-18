import { useState, type FormEvent } from 'react';
import { capacityApi } from '../api/services';
import {
  CAPACITY_FORECASTS, CAPACITY_LEVELS, CAPACITY_METRICS, POLICY_STATUSES,
  type AuditEntry, type CapacityForecast, type CapacityLevel, type CapacityMetric, type CapacityPolicy, type CapacitySample, type PolicyStatus,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value?: string) => (value ? new Date(value).toLocaleString() : undefined);
const percent = (value?: number) => (value === undefined ? undefined : `${value.toFixed(1)}%`);

/** Where the trend leads, in words a person can read. */
function runsOut(policy: CapacityPolicy): string {
  switch (policy.forecast) {
    case 'WITHIN_HORIZON':
    case 'BEYOND_HORIZON':
      return policy.daysToLimit === 0 ? 'now' : `in ${policy.daysToLimit?.toFixed(1)} days`;
    case 'STABLE':
      return 'not growing';
    case 'NOT_ENOUGH_DATA':
      return 'not enough samples';
    default:
      return '-';
  }
}

export function CapacityPage() {
  const { api } = useSession();
  const capacity = capacityApi(api);
  const [levelFilter, setLevelFilter] = useState<CapacityLevel | ''>('');
  const [forecastFilter, setForecastFilter] = useState<CapacityForecast | ''>('');
  const [metricFilter, setMetricFilter] = useState<CapacityMetric | ''>('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => capacity.list({}), []);
  const list = useAsync(
    () => capacity.list({ level: levelFilter || undefined, forecast: forecastFilter || undefined, metric: metricFilter || undefined, status: statusFilter || undefined }),
    [levelFilter, forecastFilter, metricFilter, statusFilter],
  );
  const reloadAll = () => { list.reload(); everything.reload(); };
  const count = (level: CapacityLevel) => everything.data?.filter((policy) => policy.level === level).length;

  return (
    <section>
      <div className="page-head">
        <h1>Capacity</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New policy</button>
      </div>
      <p className="muted">How full each asset is and, by a straight line through its recent samples, how many days are left. The tools that measure report each sample here; nothing on this page measures anything.</p>
      <div className="tiles" aria-label="Summary">
        {([['Critical', count('CRITICAL')], ['Warning', count('WARNING')], ['OK', count('OK')], ['No data', count('NO_DATA')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewPolicyForm onCancel={() => setCreating(false)} onCreated={(policy) => { setCreating(false); setSelectedId(policy.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Level" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as CapacityLevel | '')}>
          <option value="">Any level</option>
          {CAPACITY_LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Forecast" value={forecastFilter} onChange={(e) => setForecastFilter(e.target.value as CapacityForecast | '')}>
          <option value="">Any forecast</option>
          {CAPACITY_FORECASTS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Metric" value={metricFilter} onChange={(e) => setMetricFilter(e.target.value as CapacityMetric | '')}>
          <option value="">Any metric</option>
          {CAPACITY_METRICS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PolicyStatus | '')}>
          <option value="">Active and paused</option>
          {POLICY_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No policies match.</Empty> : (
          <table aria-label="Policies">
            <thead><tr><th>Policy</th><th>Metric</th><th>Level</th><th>Used</th><th>Runs out</th><th>Status</th></tr></thead>
            <tbody>
              {list.data?.map((policy) => (
                <tr key={policy.id} className={policy.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(policy.id)}>{policy.name}</button></td>
                  <td>{policy.metric}</td>
                  <td><StatusBadge status={policy.level} />{policy.stale && <span className="stale-note"> no recent sample</span>}</td>
                  <td>{percent(policy.utilisationPercent) ?? <span className="muted">-</span>}</td>
                  <td>{runsOut(policy)}</td>
                  <td><StatusBadge status={policy.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <PolicyDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={reloadAll} />}
      </div>
    </section>
  );
}

function NewPolicyForm({ onCreated, onCancel }: { onCreated: (policy: CapacityPolicy) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [metric, setMetric] = useState<CapacityMetric>('DISK');
  const [limit, setLimit] = useState('');
  const [warn, setWarn] = useState('70');
  const [critical, setCritical] = useState('90');
  const [windowDays, setWindowDays] = useState('30');
  const [horizonDays, setHorizonDays] = useState('30');
  const [reportEvery, setReportEvery] = useState('24');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && assetId.trim() !== '' && [limit, warn, critical, windowDays, horizonDays, reportEvery].every((value) => value.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await capacityApi(api).create({
        name: name.trim(), assetId: assetId.trim(), metric, limit: Number(limit), warnPercent: Number(warn), criticalPercent: Number(critical),
        windowDays: Number(windowDays), horizonDays: Number(horizonDays), reportEveryHours: Number(reportEvery),
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New policy" onSubmit={submit}>
      <h2>New policy</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Asset it watches (identifier)<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>Metric
        <select value={metric} onChange={(e) => setMetric(e.target.value as CapacityMetric)}>{CAPACITY_METRICS.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>Limit (in the unit the tool reports)<input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
      <label>Warn at (percent used)<input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
      <label>Critical at (percent used, above the warning)<input inputMode="numeric" value={critical} onChange={(e) => setCritical(e.target.value)} /></label>
      <label>Trend drawn from the last (days)<input inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} /></label>
      <label>Warn about running out within (days)<input inputMode="numeric" value={horizonDays} onChange={(e) => setHorizonDays(e.target.value)} /></label>
      <label>The tool reports every (hours)<input inputMode="numeric" value={reportEvery} onChange={(e) => setReportEvery(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create policy'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function PolicyDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const capacity = capacityApi(api);
  const detail = useAsync<{ policy: CapacityPolicy; samples: CapacitySample[]; trail: AuditEntry[] }>(async () => {
    const [policy, samples, trail] = await Promise.all([capacity.retrieve(id), capacity.samples({ policyId: id }), capacity.auditLog(id)]);
    return { policy, samples, trail };
  }, [id]);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const policy = detail.data?.policy;

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
    <aside className="detail" aria-label="Policy detail">
      <div className="detail-head">
        <h2>{policy?.name ?? 'Policy'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {policy && (
        <>
          <p><StatusBadge status={policy.level} /> <StatusBadge status={policy.status} />{policy.forecast && <> <StatusBadge status={policy.forecast} /></>}</p>
          <dl>
            <dt>Watch</dt><dd>{policy.metric} of {policy.limit}, warn at {policy.warnPercent}%, critical at {policy.criticalPercent}%</dd>
            <dt>Asset</dt><dd><code>{policy.assetId}</code></dd>
            {policy.lastValue !== undefined && <><dt>Latest sample</dt><dd>{policy.lastValue} ({percent(policy.utilisationPercent)}) at {when(policy.lastMeasuredAt)}{policy.stale ? ', older than twice the expected interval' : ''}</dd></>}
            <dt>Trend</dt><dd>a straight line through the last {policy.windowDays} days; running out {runsOut(policy)}{policy.projectedExhaustionAt ? `, around ${when(policy.projectedExhaustionAt)}` : ''}</dd>
            <dt>Reports</dt><dd>expected every {policy.reportEveryHours} h, warning when it would run out within {policy.horizonDays} days</dd>
          </dl>
          <div className="actions" aria-label="Actions">
            {policy.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => capacity.control(id, 'pause'))}>Pause</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => capacity.control(id, 'resume'))}>Resume</button>}
          </div>
          <h3>Recent samples</h3>
          {detail.data?.samples.length === 0 ? <Empty>No samples reported yet.</Empty> : (
            <table aria-label="Recent samples">
              <thead><tr><th>Taken</th><th>Value</th><th>By</th></tr></thead>
              <tbody>
                {detail.data?.samples.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.measuredAt).toLocaleString()}</td>
                    <td>{entry.value}</td>
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

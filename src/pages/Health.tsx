import { useState, type FormEvent } from 'react';
import { healthApi } from '../api/services';
import { CHECK_STATUSES, CHECK_TYPES, HEALTHS, type AuditEntry, type CheckStatus, type CheckType, type Health, type HealthCheck, type ProbeResult } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const optionalNumber = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value));

export function HealthPage() {
  const { api } = useSession();
  const health = healthApi(api);
  const [healthFilter, setHealthFilter] = useState<Health | ''>('');
  const [statusFilter, setStatusFilter] = useState<CheckStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const summary = useAsync(() => health.summary(), []);
  const list = useAsync(() => health.list({ health: healthFilter || undefined, status: statusFilter || undefined }), [healthFilter, statusFilter]);
  const reloadAll = () => { list.reload(); summary.reload(); };

  return (
    <section>
      <div className="page-head">
        <h1>Health</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New check</button>
      </div>
      <p className="muted">Things the platform watches by itself, on a schedule. A check goes down after several failures in a row, so one dropped packet is not an outage.</p>
      <div className="tiles" aria-label="Summary">
        {([['Up', summary.data?.up], ['Down', summary.data?.down], ['Not known yet', summary.data?.unknown], ['Paused', summary.data?.paused], ['Total', summary.data?.total]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={summary.error} />
      {creating && <NewCheckForm onCancel={() => setCreating(false)} onCreated={(check) => { setCreating(false); setSelectedId(check.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Health" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value as Health | '')}>
          <option value="">Any health</option>
          {HEALTHS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CheckStatus | '')}>
          <option value="">Active and paused</option>
          {CHECK_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No checks match.</Empty> : (
          <table aria-label="Checks">
            <thead><tr><th>Check</th><th>Type</th><th>Target</th><th>Health</th><th>Last probe</th><th>Status</th></tr></thead>
            <tbody>
              {list.data?.map((check) => (
                <tr key={check.id} className={check.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(check.id)}>{check.name}</button></td>
                  <td>{check.type}</td>
                  <td><code>{check.target}</code></td>
                  <td><StatusBadge status={check.health} /></td>
                  <td>{check.lastCheckedAt ? <>{new Date(check.lastCheckedAt).toLocaleTimeString()} ({check.lastLatencyMillis ?? '-'} ms){check.lastError ? <span className="field-error"> {check.lastError}</span> : null}</> : <span className="muted">not yet</span>}</td>
                  <td><StatusBadge status={check.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <CheckDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={reloadAll} />}
      </div>
    </section>
  );
}

function NewCheckForm({ onCreated, onCancel }: { onCreated: (check: HealthCheck) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [type, setType] = useState<CheckType>('HTTP');
  const [target, setTarget] = useState('');
  const [interval, setIntervalValue] = useState('');
  const [timeout, setTimeoutValue] = useState('');
  const [expected, setExpected] = useState('');
  const [failures, setFailures] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && target.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await healthApi(api).create({
        name: name.trim(), type, target: target.trim(), intervalSeconds: optionalNumber(interval), timeoutMillis: optionalNumber(timeout),
        expectedStatus: type === 'HTTP' ? optionalNumber(expected) : undefined, failureThreshold: optionalNumber(failures),
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New check" onSubmit={submit}>
      <h2>New check</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Type
        <select value={type} onChange={(e) => setType(e.target.value as CheckType)}>{CHECK_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>{type === 'HTTP' ? 'Address (http or https, no credentials or query)' : 'Host and port'}
        <input value={target} maxLength={300} placeholder={type === 'HTTP' ? 'https://intranet.acme.test/health' : 'db.internal:5432'} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <label>Every (seconds, 10 to 86400, default 60)<input inputMode="numeric" value={interval} onChange={(e) => setIntervalValue(e.target.value)} /></label>
      <label>Timeout (milliseconds, default 5000)<input inputMode="numeric" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} /></label>
      {type === 'HTTP' && <label>Expected status (default: any 200 to 399)<input inputMode="numeric" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>}
      <label>Down after this many failures in a row (default 3)<input inputMode="numeric" value={failures} onChange={(e) => setFailures(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Starting...' : 'Start watching'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function CheckDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const health = healthApi(api);
  const detail = useAsync<{ check: HealthCheck; results: ProbeResult[]; trail: AuditEntry[] }>(async () => {
    const [check, results, trail] = await Promise.all([health.retrieve(id), health.results(id), health.auditLog(id)]);
    return { check, results, trail };
  }, [id]);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const check = detail.data?.check;

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
    <aside className="detail" aria-label="Check detail">
      <div className="detail-head">
        <h2>{check?.name ?? 'Check'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {check && (
        <>
          <p><StatusBadge status={check.health} /> <StatusBadge status={check.status} /></p>
          <dl>
            <dt>Target</dt><dd><code>{check.target}</code></dd>
            <dt>Probed</dt><dd>every {check.intervalSeconds} s, timeout {check.timeoutMillis} ms</dd>
            <dt>Down after</dt><dd>{check.failureThreshold} failure(s) in a row; up after {check.successThreshold} success(es)</dd>
            {check.expectedStatus && <><dt>Expected status</dt><dd>{check.expectedStatus}</dd></>}
            {check.consecutiveFailures > 0 && <><dt>Failing for</dt><dd>{check.consecutiveFailures} probe(s) in a row</dd></>}
            {check.lastStateChangeAt && <><dt>Last change of health</dt><dd>{new Date(check.lastStateChangeAt).toLocaleString()}</dd></>}
          </dl>
          <div className="actions" aria-label="Actions">
            <button type="button" disabled={busy} onClick={() => void run(() => health.run(id))}>Probe now</button>
            {check.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => health.control(id, 'pause'))}>Pause</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => health.control(id, 'resume'))}>Resume</button>}
          </div>
          <h3>Recent probes</h3>
          {detail.data?.results.length === 0 ? <Empty>No probes yet.</Empty> : (
            <table aria-label="Recent probes">
              <thead><tr><th>When</th><th>Result</th><th>Status</th><th>Latency</th></tr></thead>
              <tbody>
                {detail.data?.results.map((result) => (
                  <tr key={result.at}>
                    <td>{new Date(result.at).toLocaleTimeString()}</td>
                    <td>{result.ok ? 'up' : <span className="field-error">{result.error}</span>}</td>
                    <td>{result.statusCode ?? '-'}</td>
                    <td>{result.latencyMillis} ms</td>
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

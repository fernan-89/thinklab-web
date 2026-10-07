import { useState, type FormEvent } from 'react';
import { backupApi } from '../api/services';
import { POLICY_STATUSES, PROTECTIONS, type AuditEntry, type BackupPolicy, type BackupRun, type PolicyStatus, type Protection } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const optionalNumber = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value));
const when = (value?: string) => (value ? new Date(value).toLocaleString() : undefined);

export function BackupsPage() {
  const { api } = useSession();
  const backups = backupApi(api);
  const [protectionFilter, setProtectionFilter] = useState<Protection | ''>('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => backups.list({}), []);
  const list = useAsync(() => backups.list({ protection: protectionFilter || undefined, status: statusFilter || undefined }), [protectionFilter, statusFilter]);
  const reloadAll = () => { list.reload(); everything.reload(); };
  const count = (protection: Protection) => everything.data?.filter((policy) => policy.protection === protection).length;

  return (
    <section>
      <div className="page-head">
        <h1>Backups</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New policy</button>
      </div>
      <p className="muted">What is promised about each asset, and whether the promise holds right now. The tools that make the backups report each run here; nothing on this page starts one.</p>
      <div className="tiles" aria-label="Summary">
        {([['Protected', count('OK')], ['No backup yet', count('NEVER')], ['Past the RPO', count('RPO_BREACHED')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewPolicyForm onCancel={() => setCreating(false)} onCreated={(policy) => { setCreating(false); setSelectedId(policy.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Protection" value={protectionFilter} onChange={(e) => setProtectionFilter(e.target.value as Protection | '')}>
          <option value="">Any protection</option>
          {PROTECTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
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
            <thead><tr><th>Policy</th><th>Protection</th><th>Last backup</th><th>Protected until</th><th>Restore test</th><th>Status</th></tr></thead>
            <tbody>
              {list.data?.map((policy) => (
                <tr key={policy.id} className={policy.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(policy.id)}>{policy.name}</button></td>
                  <td><StatusBadge status={policy.protection} /></td>
                  <td>{when(policy.lastSuccessAt) ?? <span className="muted">none yet</span>}</td>
                  <td>{when(policy.protectedUntil) ?? <span className="muted">-</span>}</td>
                  <td><StatusBadge status={policy.restoreTest} /></td>
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

function NewPolicyForm({ onCreated, onCancel }: { onCreated: (policy: BackupPolicy) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [frequency, setFrequency] = useState('24');
  const [rpo, setRpo] = useState('48');
  const [rto, setRto] = useState('120');
  const [retention, setRetention] = useState('30');
  const [restoreEvery, setRestoreEvery] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && assetId.trim() !== '' && [frequency, rpo, rto, retention].every((value) => value.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await backupApi(api).create({
        name: name.trim(), assetId: assetId.trim(), frequencyHours: Number(frequency), rpoHours: Number(rpo), rtoMinutes: Number(rto),
        retentionDays: Number(retention), restoreTestEveryDays: optionalNumber(restoreEvery),
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
      <label>Asset it protects (identifier)<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>Backed up every (hours)<input inputMode="numeric" value={frequency} onChange={(e) => setFrequency(e.target.value)} /></label>
      <label>Most data that may be lost (hours, not less than the frequency)<input inputMode="numeric" value={rpo} onChange={(e) => setRpo(e.target.value)} /></label>
      <label>Longest recovery (minutes)<input inputMode="numeric" value={rto} onChange={(e) => setRto(e.target.value)} /></label>
      <label>Keep copies for (days)<input inputMode="numeric" value={retention} onChange={(e) => setRetention(e.target.value)} /></label>
      <label>Prove a restore every (days, optional)<input inputMode="numeric" value={restoreEvery} onChange={(e) => setRestoreEvery(e.target.value)} /></label>
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
  const backups = backupApi(api);
  const detail = useAsync<{ policy: BackupPolicy; runs: BackupRun[]; trail: AuditEntry[] }>(async () => {
    const [policy, runs, trail] = await Promise.all([backups.retrieve(id), backups.runs({ policyId: id }), backups.auditLog(id)]);
    return { policy, runs, trail };
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
          <p><StatusBadge status={policy.protection} /> <StatusBadge status={policy.status} /></p>
          <dl>
            <dt>Promise</dt><dd>a backup every {policy.frequencyHours} h, at most {policy.rpoHours} h of data lost, recovered within {policy.rtoMinutes} min, copies kept {policy.retentionDays} days</dd>
            <dt>Asset</dt><dd><code>{policy.assetId}</code></dd>
            {policy.restoreTestEveryDays && <><dt>Restore test</dt><dd>every {policy.restoreTestEveryDays} days: <StatusBadge status={policy.restoreTest} />{policy.restoreTestDueAt ? ` due ${when(policy.restoreTestDueAt)}` : ''}</dd></>}
            {policy.lastRestoreMinutes !== undefined && <><dt>Last restore took</dt><dd>{policy.lastRestoreMinutes} min, {policy.rtoMet ? 'within' : 'over'} the objective</dd></>}
            {policy.lastRunAt && <><dt>Last run</dt><dd>{when(policy.lastRunAt)}</dd></>}
          </dl>
          <div className="actions" aria-label="Actions">
            {policy.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => backups.control(id, 'pause'))}>Pause</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => backups.control(id, 'resume'))}>Resume</button>}
          </div>
          <h3>Recent runs</h3>
          {detail.data?.runs.length === 0 ? <Empty>No runs reported yet.</Empty> : (
            <table aria-label="Recent runs">
              <thead><tr><th>Started</th><th>Kind</th><th>Result</th><th>Took</th><th>By</th></tr></thead>
              <tbody>
                {detail.data?.runs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.startedAt).toLocaleString()}</td>
                    <td>{entry.kind === 'BACKUP' ? 'backup' : 'restore test'}</td>
                    <td>{entry.outcome === 'SUCCEEDED' ? 'succeeded' : <span className="field-error">{entry.failureReason}</span>}</td>
                    <td>{entry.durationMinutes} min</td>
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

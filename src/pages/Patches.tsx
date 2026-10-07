import { useState, type FormEvent } from 'react';
import { patchApi } from '../api/services';
import {
  FINDING_STATUSES, PATCH_COMPLIANCES, POLICY_STATUSES, WAIVER_REASONS, type FindingStatus, type PatchCompliance, type PatchFinding, type PatchPolicy,
  type PolicyStatus, type WaiverReason, type AuditEntry,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value?: string) => (value ? new Date(value).toLocaleString() : undefined);
const DAY_MS = 24 * 3600 * 1000;

export function PatchesPage() {
  const { api } = useSession();
  const patches = patchApi(api);
  const [complianceFilter, setComplianceFilter] = useState<PatchCompliance | ''>('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => patches.list({}), []);
  const list = useAsync(() => patches.list({ compliance: complianceFilter || undefined, status: statusFilter || undefined }), [complianceFilter, statusFilter]);
  const reloadAll = () => { list.reload(); everything.reload(); };
  const count = (compliance: PatchCompliance) => everything.data?.filter((policy) => policy.compliance === compliance).length;

  return (
    <section>
      <div className="page-head">
        <h1>Patches</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New policy</button>
      </div>
      <p className="muted">How many days a patch may wait on each asset, and which patches are past that. Scanners report the patches and the update tools report them applied; nothing on this page applies one.</p>
      <div className="tiles" aria-label="Summary">
        {([['Compliant', count('COMPLIANT')], ['Overdue', count('OVERDUE')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewPolicyForm onCancel={() => setCreating(false)} onCreated={(policy) => { setCreating(false); setSelectedId(policy.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Compliance" value={complianceFilter} onChange={(e) => setComplianceFilter(e.target.value as PatchCompliance | '')}>
          <option value="">Any compliance</option>
          {PATCH_COMPLIANCES.map((value) => <option key={value} value={value}>{value}</option>)}
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
            <thead><tr><th>Policy</th><th>Compliance</th><th>Open</th><th>Overdue</th><th>Waived</th><th>Days (C/H/M/L)</th><th>Status</th></tr></thead>
            <tbody>
              {list.data?.map((policy) => (
                <tr key={policy.id} className={policy.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(policy.id)}>{policy.name}</button></td>
                  <td><StatusBadge status={policy.compliance} /></td>
                  <td>{policy.openFindings}</td>
                  <td>{policy.overdueFindings}</td>
                  <td>{policy.waivedFindings}</td>
                  <td>{policy.criticalDays}/{policy.highDays}/{policy.mediumDays}/{policy.lowDays}</td>
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

function NewPolicyForm({ onCreated, onCancel }: { onCreated: (policy: PatchPolicy) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [critical, setCritical] = useState('2');
  const [high, setHigh] = useState('7');
  const [medium, setMedium] = useState('30');
  const [low, setLow] = useState('90');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && assetId.trim() !== '' && [critical, high, medium, low].every((value) => value.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await patchApi(api).create({
        name: name.trim(), assetId: assetId.trim(), criticalDays: Number(critical), highDays: Number(high), mediumDays: Number(medium), lowDays: Number(low),
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
      <label>Asset it covers (identifier)<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>Days for a critical patch<input inputMode="numeric" value={critical} onChange={(e) => setCritical(e.target.value)} /></label>
      <label>Days for a high patch<input inputMode="numeric" value={high} onChange={(e) => setHigh(e.target.value)} /></label>
      <label>Days for a medium patch<input inputMode="numeric" value={medium} onChange={(e) => setMedium(e.target.value)} /></label>
      <label>Days for a low patch (a more severe patch cannot get more time)<input inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} /></label>
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
  const patches = patchApi(api);
  const [statusFilter, setStatusFilter] = useState<FindingStatus | ''>('');
  const detail = useAsync<{ policy: PatchPolicy; findings: PatchFinding[]; trail: AuditEntry[] }>(async () => {
    const [policy, findings, trail] = await Promise.all([patches.retrieve(id), patches.findings({ policyId: id, status: statusFilter || undefined }), patches.auditLog(id)]);
    return { policy, findings, trail };
  }, [id, statusFilter]);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [waiving, setWaiving] = useState<string>();
  const [reason, setReason] = useState<WaiverReason>('ACCEPTED_RISK');
  const [days, setDays] = useState('30');
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
          <p><StatusBadge status={policy.compliance} /> <StatusBadge status={policy.status} /></p>
          <dl>
            <dt>Promise</dt><dd>critical {policy.criticalDays} d, high {policy.highDays} d, medium {policy.mediumDays} d, low {policy.lowDays} d after it is announced</dd>
            <dt>Asset</dt><dd><code>{policy.assetId}</code></dd>
            <dt>Open</dt><dd>{policy.openFindings} open, {policy.overdueFindings} overdue, {policy.waivedFindings} waived</dd>
            {policy.oldestOverdueDueAt && <><dt>Oldest overdue since</dt><dd>{when(policy.oldestOverdueDueAt)}</dd></>}
          </dl>
          <div className="actions" aria-label="Actions">
            {policy.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => patches.control(id, 'pause'))}>Pause</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => patches.control(id, 'resume'))}>Resume</button>}
          </div>
          <h3>Patches</h3>
          <div className="filters">
            <select aria-label="Patch status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FindingStatus | '')}>
              <option value="">Any status</option>
              {FINDING_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          {detail.data?.findings.length === 0 ? <Empty>No patches reported.</Empty> : (
            <table aria-label="Patches">
              <thead><tr><th>Patch</th><th>Severity</th><th>Due</th><th>Status</th><th /></tr></thead>
              <tbody>
                {detail.data?.findings.map((finding) => (
                  <tr key={finding.id}>
                    <td><code>{finding.patchRef}</code></td>
                    <td><StatusBadge status={finding.severity} /></td>
                    <td>{when(finding.dueAt) ?? '-'}{finding.overdue && <span className="field-error"> overdue</span>}</td>
                    <td>
                      <StatusBadge status={finding.status} />
                      {finding.status === 'WAIVED' && <div className="muted small">{finding.waiverReason} until {when(finding.waivedUntil)}</div>}
                    </td>
                    <td>
                      {finding.status === 'PENDING' && <button type="button" className="link" disabled={busy} onClick={() => setWaiving(finding.id)}>Waive</button>}
                      {finding.status === 'WAIVED' && <button type="button" className="link" disabled={busy} onClick={() => void run(() => patches.unwaive(finding.id))}>Withdraw waiver</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {waiving && (
            <form className="card form" aria-label="Waive patch" onSubmit={(event) => {
              event.preventDefault();
              const target = waiving;
              setWaiving(undefined);
              void run(() => patches.waive(target, reason, new Date(Date.now() + Number(days) * DAY_MS).toISOString()));
            }}>
              <h3>Waive this patch</h3>
              <label>Reason
                <select value={reason} onChange={(e) => setReason(e.target.value as WaiverReason)}>{WAIVER_REASONS.map((value) => <option key={value} value={value}>{value}</option>)}</select>
              </label>
              <label>For how many days (1 to 365)<input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
              <div className="actions">
                <button type="submit" className="primary" disabled={days.trim() === ''}>Waive</button>
                <button type="button" onClick={() => setWaiving(undefined)}>Cancel</button>
              </div>
            </form>
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

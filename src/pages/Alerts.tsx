import { useState, type FormEvent } from 'react';
import { alertingApi, healthApi } from '../api/services';
import { ALERT_STATUSES, SEVERITIES, type AlertRule, type AlertStatus, type Evaluation, type Severity } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

export function AlertsPage() {
  const { api } = useSession();
  const alerting = alertingApi(api);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>('');
  const [creating, setCreating] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation>();
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const rules = useAsync(() => alerting.rules(), []);
  const alerts = useAsync(() => alerting.alerts({ status: statusFilter || undefined }), [statusFilter]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
      rules.reload();
      alerts.reload();
    }
  }

  const ruleName = (id: string) => rules.data?.find((rule) => rule.id === id)?.name ?? id;

  return (
    <section>
      <div className="page-head">
        <h1>Alerts</h1>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void run(async () => setEvaluation(await alerting.evaluate()))}>Evaluate now</button>
          <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New rule</button>
        </div>
      </div>
      <p className="muted">When a check goes down the platform opens one incident for that outage, and adds an internal note when it is back. The incident is never closed for you.</p>
      {evaluation && <p role="status">Looked now: {evaluation.opened} alert(s) opened, {evaluation.resolved} resolved, {evaluation.incidentsOpened} incident(s) filed.</p>}
      <ProblemBanner error={actionError} />
      {creating && <NewRuleForm onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); rules.reload(); }} />}

      <h2>Rules</h2>
      <p className="muted">The oldest active rule that covers a check decides the incident.</p>
      <ProblemBanner error={rules.error} />
      {rules.data?.length === 0 && !rules.loading ? <Empty>No rules yet: nothing will be opened.</Empty> : (
        <table aria-label="Rules">
          <thead><tr><th>Rule</th><th>Covers</th><th>Impact</th><th>Urgency</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rules.data?.map((rule: AlertRule) => (
              <tr key={rule.id}>
                <td>{rule.name}</td>
                <td>{rule.checkId ? <code>{rule.checkId}</code> : 'every check'}</td>
                <td>{rule.impact}</td>
                <td>{rule.urgency}</td>
                <td><StatusBadge status={rule.status} /></td>
                <td>
                  {rule.status === 'ACTIVE'
                    ? <button type="button" disabled={busy} onClick={() => void run(() => alerting.controlRule(rule.id, 'pause'))}>Pause</button>
                    : <button type="button" disabled={busy} onClick={() => void run(() => alerting.controlRule(rule.id, 'resume'))}>Resume</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Alerts</h2>
      <div className="filters">
        <select aria-label="Alert status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AlertStatus | '')}>
          <option value="">Open and resolved</option>
          {ALERT_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{alerts.loading ? 'Loading...' : `${alerts.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={alerts.error} />
      {alerts.data?.length === 0 && !alerts.loading ? <Empty>No alerts match.</Empty> : (
        <table aria-label="Alerts">
          <thead><tr><th>Check</th><th>Status</th><th>Opened</th><th>Resolved</th><th>Why</th><th>Incident</th><th>Rule</th></tr></thead>
          <tbody>
            {alerts.data?.map((alert) => (
              <tr key={alert.id}>
                <td>{alert.checkName}</td>
                <td><StatusBadge status={alert.status} /></td>
                <td>{new Date(alert.openedAt).toLocaleString()}</td>
                <td>{alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleString() : <span className="muted">-</span>}</td>
                <td>{alert.lastError ?? <span className="muted">-</span>}</td>
                <td>{alert.incidentId ? <code>{alert.incidentId}</code> : <span className="field-error">{alert.problem ?? 'not yet'}</span>}</td>
                <td>{ruleName(alert.ruleId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewRuleForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { api } = useSession();
  const checks = useAsync(() => healthApi(api).list({}), []);
  const [name, setName] = useState('');
  const [checkId, setCheckId] = useState('');
  const [impact, setImpact] = useState<Severity>('MEDIUM');
  const [urgency, setUrgency] = useState<Severity>('MEDIUM');
  const [requesterId, setRequesterId] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && requesterId.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await alertingApi(api).createRule({ name: name.trim(), checkId: checkId || undefined, impact, urgency, requesterId: requesterId.trim() });
      onCreated();
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New rule" onSubmit={submit}>
      <h2>New rule</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Covers
        <select value={checkId} onChange={(e) => setCheckId(e.target.value)}>
          <option value="">Every check</option>
          {checks.data?.map((check) => <option key={check.id} value={check.id}>{check.name}</option>)}
        </select>
      </label>
      <label>Impact
        <select value={impact} onChange={(e) => setImpact(e.target.value as Severity)}>{SEVERITIES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>Urgency
        <select value={urgency} onChange={(e) => setUrgency(e.target.value as Severity)}>{SEVERITIES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>Requester the incident is filed for (id)<input value={requesterId} onChange={(e) => setRequesterId(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create rule'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

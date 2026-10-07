import { useState, type FormEvent } from 'react';
import { alertingApi, healthApi } from '../api/services';
import { ALERT_STATUSES, SEVERITIES, type Alert, type AlertNotice, type AlertRule, type AlertStatus, type Evaluation, type MaintenanceWindow, type Severity } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** A notice as a person reads it: sent, or tried and why not. */
function noticeLabel(notice: AlertNotice): string {
  return `${notice.notice} ${notice.sentAt ? 'sent' : `failed (${notice.attempts})`}`;
}

/** The value of a datetime-local input, shifted by some minutes from now, in the browser's own time. */
function localInput(minutesFromNow: number): string {
  const moment = new Date(Date.now() + minutesFromNow * 60_000);
  const local = new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AlertsPage() {
  const { api } = useSession();
  const alerting = alertingApi(api);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>('');
  const [creating, setCreating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation>();
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const rules = useAsync(() => alerting.rules(), []);
  const alerts = useAsync(() => alerting.alerts({ status: statusFilter || undefined }), [statusFilter]);
  const windows = useAsync(() => alerting.windows(), []);

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
      windows.reload();
    }
  }

  const ruleName = (id: string) => rules.data?.find((rule) => rule.id === id)?.name ?? id;
  const checkLabel = (id?: string) => (id ? <code>{id}</code> : 'every check');

  return (
    <section>
      <div className="page-head">
        <h1>Alerts</h1>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void run(async () => setEvaluation(await alerting.evaluate()))}>Evaluate now</button>
          <button type="button" onClick={() => setPlanning(true)} disabled={planning}>Plan window</button>
          <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New rule</button>
        </div>
      </div>
      <p className="muted">When a check goes down the platform opens one incident for that outage, and adds an internal note when it is back. A check that goes down again soon after is reopened on the same incident, and the people a rule names are told through a webhook. The incident is never closed for you.</p>
      {evaluation && <p role="status">Looked now: {evaluation.opened} alert(s) opened, {evaluation.resolved} resolved, {evaluation.incidentsOpened} incident(s) filed, {evaluation.reopened} reopened, {evaluation.notified} notice(s) sent.</p>}
      <ProblemBanner error={actionError} />
      {creating && <NewRuleForm onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); rules.reload(); }} />}
      {planning && <NewWindowForm onCancel={() => setPlanning(false)} onCreated={() => { setPlanning(false); windows.reload(); }} />}

      <h2>Rules</h2>
      <p className="muted">The oldest active rule that covers a check decides the incident.</p>
      <ProblemBanner error={rules.error} />
      {rules.data?.length === 0 && !rules.loading ? <Empty>No rules yet: nothing will be opened.</Empty> : (
        <table aria-label="Rules">
          <thead><tr><th>Rule</th><th>Covers</th><th>Impact</th><th>Urgency</th><th>Tells</th><th>Escalates</th><th>Reopens within</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rules.data?.map((rule: AlertRule) => (
              <tr key={rule.id}>
                <td>{rule.name}</td>
                <td>{checkLabel(rule.checkId)}</td>
                <td>{rule.impact}</td>
                <td>{rule.urgency}</td>
                <td>{rule.notifyTarget ? <code>{rule.notifyTarget}</code> : <span className="muted">-</span>}</td>
                <td>{rule.escalateTarget ? <><code>{rule.escalateTarget}</code> after {rule.escalateAfterMinutes} min</> : <span className="muted">-</span>}</td>
                <td>{rule.reopenWithinMinutes > 0 ? `${rule.reopenWithinMinutes} min` : 'never'}</td>
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

      <h2>Maintenance windows</h2>
      <p className="muted">While a window covers a check no alert is opened or reopened and no opened, reopened or escalation notice is sent. A recovery is still recorded.</p>
      <ProblemBanner error={windows.error} />
      {windows.data?.length === 0 && !windows.loading ? <Empty>No maintenance windows.</Empty> : (
        <table aria-label="Maintenance windows">
          <thead><tr><th>Window</th><th>Covers</th><th>From</th><th>Until</th><th>Status</th><th /></tr></thead>
          <tbody>
            {windows.data?.map((window: MaintenanceWindow) => (
              <tr key={window.id}>
                <td>{window.name}</td>
                <td>{checkLabel(window.checkId)}</td>
                <td>{new Date(window.startsAt).toLocaleString()}</td>
                <td>{new Date(window.endsAt).toLocaleString()}</td>
                <td><StatusBadge status={window.status} /></td>
                <td>{window.status === 'ACTIVE' && <button type="button" disabled={busy} onClick={() => void run(() => alerting.cancelWindow(window.id))}>Cancel window</button>}</td>
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
          <thead><tr><th>Check</th><th>Status</th><th>Opened</th><th>Resolved</th><th>Why</th><th>Incident</th><th>Rule</th><th>Notices</th></tr></thead>
          <tbody>
            {alerts.data?.map((alert: Alert) => (
              <tr key={alert.id}>
                <td>{alert.checkName}</td>
                <td><StatusBadge status={alert.status} />{alert.reopenCount > 0 && <span className="muted"> reopened {alert.reopenCount}x</span>}</td>
                <td>{new Date(alert.openedAt).toLocaleString()}</td>
                <td>{alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleString() : <span className="muted">-</span>}</td>
                <td>{alert.lastError ?? <span className="muted">-</span>}</td>
                <td>{alert.incidentId ? <code>{alert.incidentId}</code> : <span className="field-error">{alert.problem ?? 'not yet'}</span>}</td>
                <td>{ruleName(alert.ruleId)}</td>
                <td>{alert.notices.length === 0 ? <span className="muted">-</span> : alert.notices.map((notice) => (
                  <div key={notice.notice} title={notice.lastError}>{noticeLabel(notice)}</div>
                ))}</td>
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
  const [notifyTarget, setNotifyTarget] = useState('');
  const [escalateTarget, setEscalateTarget] = useState('');
  const [escalateAfter, setEscalateAfter] = useState('15');
  const [reopenWithin, setReopenWithin] = useState('30');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && requesterId.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await alertingApi(api).createRule({
        name: name.trim(), checkId: checkId || undefined, impact, urgency, requesterId: requesterId.trim(),
        notifyTarget: notifyTarget.trim() || undefined,
        escalateTarget: escalateTarget.trim() || undefined,
        escalateAfterMinutes: escalateTarget.trim() ? Number(escalateAfter) : undefined,
        reopenWithinMinutes: Number(reopenWithin),
      });
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
      <label>Tell this webhook (variable name)<input value={notifyTarget} placeholder="THINKLAB_ALERT_HOOK_OPS" onChange={(e) => setNotifyTarget(e.target.value)} /></label>
      <label>Escalate to (variable name)<input value={escalateTarget} placeholder="THINKLAB_ALERT_HOOK_ONCALL" onChange={(e) => setEscalateTarget(e.target.value)} /></label>
      {escalateTarget.trim() !== '' && (
        <label>Escalate when unacknowledged after (minutes)<input type="number" min={1} max={1440} value={escalateAfter} onChange={(e) => setEscalateAfter(e.target.value)} /></label>
      )}
      <label>Reopen the alert when down again within (minutes, 0 = never)<input type="number" min={0} max={1440} value={reopenWithin} onChange={(e) => setReopenWithin(e.target.value)} /></label>
      <p className="muted">Name the environment variable that holds the webhook address; the address itself is never typed here or stored.</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create rule'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function NewWindowForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { api } = useSession();
  const checks = useAsync(() => healthApi(api).list({}), []);
  const [name, setName] = useState('');
  const [checkId, setCheckId] = useState('');
  const [startsAt, setStartsAt] = useState(() => localInput(0));
  const [endsAt, setEndsAt] = useState(() => localInput(60));
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && startsAt !== '' && endsAt !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await alertingApi(api).createWindow({ name: name.trim(), checkId: checkId || undefined, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() });
      onCreated();
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="Plan window" onSubmit={submit}>
      <h2>Plan window</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Covers
        <select value={checkId} onChange={(e) => setCheckId(e.target.value)}>
          <option value="">Every check</option>
          {checks.data?.map((check) => <option key={check.id} value={check.id}>{check.name}</option>)}
        </select>
      </label>
      <label>From<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
      <label>Until<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
      <p className="muted">At most 30 days, and it cannot end in the past. A window is cancelled, never edited.</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create window'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

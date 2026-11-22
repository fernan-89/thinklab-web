import { useState, type FormEvent } from 'react';
import { alertingApi, backupApi, capacityApi, cloudInventoryApi, procurementApi, drApi, healthApi, licenseApi, patchApi, vendorApi } from '../api/services';
import { ALERT_CLASSES, ALERT_COMPONENTS, ALERT_STATUSES, DEFAULT_CLASS, RULE_SOURCES, SEVERITIES, classLabel, componentLabel, type Alert, type AlertClass, type AlertComponent, type AlertRule, type AlertStatus, type Evaluation, type MaintenanceWindow, type RuleSource, type Severity } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** The value of a datetime-local input, shifted by some minutes from now, in the browser's own time. */
function localInput(minutesFromNow: number): string {
  const moment = new Date(Date.now() + minutesFromNow * 60_000);
  const local = new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AlertsPage() {
  const { t, locale, label: optionLabel, status: statusLabel } = useI18n();
  const { api } = useSession();
  const alerting = alertingApi(api);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>('');
  const [classFilter, setClassFilter] = useState<AlertClass | ''>('');
  const [componentFilter, setComponentFilter] = useState<AlertComponent | ''>('');
  const [creating, setCreating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation>();
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const rules = useAsync(() => alerting.rules(), []);
  const alerts = useAsync(() => alerting.alerts({ status: statusFilter || undefined, alertClass: classFilter || undefined, component: componentFilter || undefined }), [statusFilter, classFilter, componentFilter]);
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
  const checkLabel = (id?: string) => (id ? <code>{id}</code> : t('alerts.everyCheckLower'));
  /** The class and, when the rule or the alert says one, the part of the estate: "Capacity / Storage". */
  const kind = (alertClass?: AlertClass, component?: AlertComponent) => (alertClass || component
    ? <>{optionLabel(classLabel(alertClass) ?? '') || <span className="muted">-</span>}{component ? <span className="muted"> / {optionLabel(componentLabel(component) ?? '')}</span> : null}</>
    : <span className="muted">-</span>);
  const noun = (source?: RuleSource) => RULE_SOURCES.find((s) => s.value === source)?.noun ?? 'check';
  const coversLabel = (rule: AlertRule) => (rule.checkId
    ? <><code>{rule.checkId}</code>{rule.source && rule.source !== 'HEALTH_CHECK' ? <span className="muted"> ({optionLabel(noun(rule.source))})</span> : null}</>
    : t('alerts.everyNounLower', { noun: optionLabel(noun(rule.source)) }));

  return (
    <section>
      <div className="page-head">
        <h1>{t('nav.alerts')}</h1>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void run(async () => setEvaluation(await alerting.evaluate()))}>{t('alerts.evaluateNow')}</button>
          <button type="button" onClick={() => setPlanning(true)} disabled={planning}>{t('alerts.planWindow')}</button>
          <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('alerts.newRule')}</button>
        </div>
      </div>
      <p className="muted">{t('alerts.intro')}</p>
      {evaluation && <p role="status">{t('alerts.evaluation', { opened: evaluation.opened, resolved: evaluation.resolved, incidents: evaluation.incidentsOpened, reopened: evaluation.reopened, notified: evaluation.notified })}</p>}
      <ProblemBanner error={actionError} />
      {creating && <NewRuleForm onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); rules.reload(); }} />}
      {planning && <NewWindowForm onCancel={() => setPlanning(false)} onCreated={() => { setPlanning(false); windows.reload(); }} />}

      <h2>{t('alerts.rules')}</h2>
      <p className="muted">{t('alerts.rulesNote')}</p>
      <ProblemBanner error={rules.error} />
      {rules.data?.length === 0 && !rules.loading ? <Empty>{t('alerts.noRules')}</Empty> : (
        <table aria-label={t('alerts.rules')}>
          <thead><tr><th>{t('alerts.rule')}</th><th>{t('alerts.covers')}</th><th>{t('alerts.class')}</th><th>{t('itsm.impact')}</th><th>{t('itsm.urgency')}</th><th>{t('alerts.tells')}</th><th>{t('alerts.escalates')}</th><th>{t('alerts.reopensWithin')}</th><th>{t('common.status')}</th><th /></tr></thead>
          <tbody>
            {rules.data?.map((rule: AlertRule) => (
              <tr key={rule.id}>
                <td>{rule.name}</td>
                <td>{coversLabel(rule)}</td>
                <td>{kind(rule.alertClass, rule.component)}</td>
                <td>{rule.impact}</td>
                <td>{rule.urgency}</td>
                <td>{rule.notifyTarget ? <code>{rule.notifyTarget}</code> : <span className="muted">-</span>}</td>
                <td>{rule.escalateTarget ? <><code>{rule.escalateTarget}</code> {t('alerts.afterMinutes', { minutes: rule.escalateAfterMinutes ?? '' })}</> : <span className="muted">-</span>}</td>
                <td>{rule.reopenWithinMinutes > 0 ? t('common.minutes', { count: rule.reopenWithinMinutes }) : t('integrations.never')}</td>
                <td><StatusBadge status={rule.status} /></td>
                <td>
                  {rule.status === 'ACTIVE'
                    ? <button type="button" disabled={busy} onClick={() => void run(() => alerting.controlRule(rule.id, 'pause'))}>{t('ops.pause')}</button>
                    : <button type="button" disabled={busy} onClick={() => void run(() => alerting.controlRule(rule.id, 'resume'))}>{t('ops.resume')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{t('alerts.windows')}</h2>
      <p className="muted">{t('alerts.windowsNote')}</p>
      <ProblemBanner error={windows.error} />
      {windows.data?.length === 0 && !windows.loading ? <Empty>{t('alerts.noWindows')}</Empty> : (
        <table aria-label={t('alerts.windows')}>
          <thead><tr><th>{t('alerts.window')}</th><th>{t('alerts.covers')}</th><th>{t('alerts.from')}</th><th>{t('alerts.until')}</th><th>{t('common.status')}</th><th /></tr></thead>
          <tbody>
            {windows.data?.map((window: MaintenanceWindow) => (
              <tr key={window.id}>
                <td>{window.name}</td>
                <td>{checkLabel(window.checkId)}</td>
                <td>{new Date(window.startsAt).toLocaleString(locale)}</td>
                <td>{new Date(window.endsAt).toLocaleString(locale)}</td>
                <td><StatusBadge status={window.status} /></td>
                <td>{window.status === 'ACTIVE' && <button type="button" disabled={busy} onClick={() => void run(() => alerting.cancelWindow(window.id))}>{t('alerts.cancelWindow')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{t('nav.alerts')}</h2>
      <div className="filters">
        <select aria-label={t('alerts.alertStatus')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AlertStatus | '')}>
          <option value="">{t('alerts.openResolved')}</option>
          {ALERT_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('alerts.alertClass')} value={classFilter} onChange={(e) => setClassFilter(e.target.value as AlertClass | '')}>
          <option value="">{t('alerts.anyClass')}</option>
          {ALERT_CLASSES.map((c) => <option key={c.value} value={c.value}>{optionLabel(c.label)}</option>)}
        </select>
        <select aria-label={t('alerts.alertComponent')} value={componentFilter} onChange={(e) => setComponentFilter(e.target.value as AlertComponent | '')}>
          <option value="">{t('alerts.anyComponent')}</option>
          {ALERT_COMPONENTS.map((c) => <option key={c.value} value={c.value}>{optionLabel(c.label)}</option>)}
        </select>
        <span className="muted">{alerts.loading ? t('common.loading') : t('common.shown', { count: alerts.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={alerts.error} />
      {alerts.data?.length === 0 && !alerts.loading ? <Empty>{t('alerts.noAlerts')}</Empty> : (
        <table aria-label={t('nav.alerts')}>
          <thead><tr><th>{t('health.check')}</th><th>{t('alerts.class')}</th><th>{t('common.status')}</th><th>{t('itsm.opened')}</th><th>{t('alerts.resolved')}</th><th>{t('alerts.why')}</th><th>{t('incidents.one')}</th><th>{t('alerts.rule')}</th><th>{t('alerts.notices')}</th></tr></thead>
          <tbody>
            {alerts.data?.map((alert: Alert) => (
              <tr key={alert.id}>
                <td>{alert.checkName}</td>
                <td>{kind(alert.alertClass, alert.component)}</td>
                <td><StatusBadge status={alert.status} />{alert.reopenCount > 0 && <span className="muted"> {t('alerts.reopenedTimes', { count: alert.reopenCount })}</span>}</td>
                <td>{new Date(alert.openedAt).toLocaleString(locale)}</td>
                <td>{alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleString(locale) : <span className="muted">-</span>}</td>
                <td>{alert.lastError ?? <span className="muted">-</span>}</td>
                <td>{alert.incidentId ? <code>{alert.incidentId}</code> : <span className="field-error">{alert.problem ?? t('health.notYet')}</span>}</td>
                <td>{ruleName(alert.ruleId)}</td>
                <td>{alert.notices.length === 0 ? <span className="muted">-</span> : alert.notices.map((notice) => (
                  <div key={notice.notice} title={notice.lastError}>{notice.notice} {notice.sentAt ? t('alerts.sent') : t('alerts.failed', { attempts: notice.attempts })}</div>
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
  const { t, label: optionLabel, status: statusLabel } = useI18n();
  const { api } = useSession();
  const [source, setSource] = useState<RuleSource>('HEALTH_CHECK');
  const checks = useAsync<{ id: string; name: string }[]>(() => {
    if (source === 'BACKUP') return backupApi(api).list({});
    if (source === 'PATCH') return patchApi(api).list({});
    if (source === 'CAPACITY') return capacityApi(api).list({});
    if (source === 'DR') return drApi(api).list({});
    if (source === 'CLOUD_INVENTORY') return cloudInventoryApi(api).list({});
    if (source === 'PROCUREMENT') return procurementApi(api).list({ status: 'ORDERED' }).then((orders) => orders.map((order) => ({ id: order.id, name: order.reference })));
    if (source === 'LICENSE') return licenseApi(api).list({}).then((licenses) => licenses.map((license) => ({ id: license.id, name: license.product })));
    if (source === 'VENDOR') return vendorApi(api).agreements({}).then((agreements) => agreements.map((agreement) => ({ id: agreement.id, name: agreement.reference })));
    return healthApi(api).list({});
  }, [source]);
  const [name, setName] = useState('');
  const [checkId, setCheckId] = useState('');
  const [impact, setImpact] = useState<Severity>('MEDIUM');
  const [urgency, setUrgency] = useState<Severity>('MEDIUM');
  const [alertClass, setAlertClass] = useState<AlertClass | ''>('');
  const [component, setComponent] = useState<AlertComponent | ''>('');
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
        name: name.trim(), source: source === 'HEALTH_CHECK' ? undefined : source, checkId: checkId || undefined, impact, urgency, requesterId: requesterId.trim(),
        notifyTarget: notifyTarget.trim() || undefined,
        escalateTarget: escalateTarget.trim() || undefined,
        escalateAfterMinutes: escalateTarget.trim() ? Number(escalateAfter) : undefined,
        reopenWithinMinutes: Number(reopenWithin),
        alertClass: alertClass || undefined,
        component: component || undefined,
      });
      onCreated();
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={t('alerts.newRule')} onSubmit={submit}>
      <h2>{t('alerts.newRule')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('alerts.watches')}
        <select value={source} onChange={(e) => { setSource(e.target.value as RuleSource); setCheckId(''); }}>
          {RULE_SOURCES.map((s) => <option key={s.value} value={s.value}>{optionLabel(s.label)}</option>)}
        </select>
      </label>
      <label>{t('alerts.covers')}
        <select value={checkId} onChange={(e) => setCheckId(e.target.value)}>
          <option value="">{t('alerts.everyNoun', { noun: optionLabel(RULE_SOURCES.find((s) => s.value === source)?.noun ?? 'check') })}</option>
          {checks.data?.map((check) => <option key={check.id} value={check.id}>{check.name}</option>)}
        </select>
      </label>
      <label>{t('itsm.impact')}
        <select value={impact} onChange={(e) => setImpact(e.target.value as Severity)}>{SEVERITIES.map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select>
      </label>
      <label>{t('itsm.urgency')}
        <select value={urgency} onChange={(e) => setUrgency(e.target.value as Severity)}>{SEVERITIES.map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select>
      </label>
      <label>{t('alerts.class')}
        <select value={alertClass} onChange={(e) => setAlertClass(e.target.value as AlertClass | '')}>
          <option value="">{t('alerts.sameAsWatched', { class: optionLabel(classLabel(DEFAULT_CLASS[source]) ?? '') })}</option>
          {ALERT_CLASSES.map((c) => <option key={c.value} value={c.value}>{optionLabel(c.label)}</option>)}
        </select>
      </label>
      <label>{t('alerts.component')}
        <select value={component} onChange={(e) => setComponent(e.target.value as AlertComponent | '')}>
          <option value="">{t('alerts.notSaid')}</option>
          {ALERT_COMPONENTS.map((c) => <option key={c.value} value={c.value}>{optionLabel(c.label)}</option>)}
        </select>
      </label>
      <label>{t('alerts.requesterInput')}<input value={requesterId} onChange={(e) => setRequesterId(e.target.value)} /></label>
      <label>{t('alerts.tellInput')}<input value={notifyTarget} placeholder="THINKLAB_ALERT_HOOK_OPS" onChange={(e) => setNotifyTarget(e.target.value)} /></label>
      <label>{t('alerts.escalateInput')}<input value={escalateTarget} placeholder="THINKLAB_ALERT_HOOK_ONCALL" onChange={(e) => setEscalateTarget(e.target.value)} /></label>
      {escalateTarget.trim() !== '' && (
        <label>{t('alerts.escalateAfterInput')}<input type="number" min={1} max={1440} value={escalateAfter} onChange={(e) => setEscalateAfter(e.target.value)} /></label>
      )}
      <label>{t('alerts.reopenInput')}<input type="number" min={0} max={1440} value={reopenWithin} onChange={(e) => setReopenWithin(e.target.value)} /></label>
      <p className="muted">{t('alerts.webhookNote')}</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('alerts.createRule')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function NewWindowForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { t } = useI18n();
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
    <form className="card form" aria-label={t('alerts.planWindow')} onSubmit={submit}>
      <h2>{t('alerts.planWindow')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('alerts.covers')}
        <select value={checkId} onChange={(e) => setCheckId(e.target.value)}>
          <option value="">{t('alerts.everyCheck')}</option>
          {checks.data?.map((check) => <option key={check.id} value={check.id}>{check.name}</option>)}
        </select>
      </label>
      <label>{t('alerts.from')}<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
      <label>{t('alerts.until')}<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
      <p className="muted">{t('alerts.windowNote')}</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('alerts.createWindow')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

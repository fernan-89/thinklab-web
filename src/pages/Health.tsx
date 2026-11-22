import { useState, type FormEvent } from 'react';
import { healthApi } from '../api/services';
import { CHECK_STATUSES, CHECK_TYPES, HEALTHS, type AuditEntry, type CheckStatus, type CheckType, type Health, type HealthCheck, type ProbeResult } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const optionalNumber = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value));

export function HealthPage() {
  const { t, status: statusLabel } = useI18n();
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
        <h1>{t('nav.health')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('health.new')}</button>
      </div>
      <p className="muted">{t('health.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {([['Up', summary.data?.up], ['Down', summary.data?.down], [t('health.notKnownYet'), summary.data?.unknown], ['Paused', summary.data?.paused], ['Total', summary.data?.total]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={summary.error} />
      {creating && <NewCheckForm onCancel={() => setCreating(false)} onCreated={(check) => { setCreating(false); setSelectedId(check.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label={t('nav.health')} value={healthFilter} onChange={(e) => setHealthFilter(e.target.value as Health | '')}>
          <option value="">{t('health.any')}</option>
          {HEALTHS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('common.status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CheckStatus | '')}>
          <option value="">{t('ops.activePaused')}</option>
          {CHECK_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('health.noChecks')}</Empty> : (
          <table aria-label={t('health.checks')}>
            <thead><tr><th>{t('health.check')}</th><th>{t('health.type')}</th><th>{t('health.target')}</th><th>{t('nav.health')}</th><th>{t('health.lastProbe')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {list.data?.map((check) => (
                <tr key={check.id} className={check.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(check.id)}>{check.name}</button></td>
                  <td>{check.type}</td>
                  <td><code>{check.target}</code></td>
                  <td><StatusBadge status={check.health} /></td>
                  <td>{check.lastCheckedAt ? <>{new Date(check.lastCheckedAt).toLocaleTimeString()} ({check.lastLatencyMillis ?? '-'} ms){check.lastError ? <span className="field-error"> {check.lastError}</span> : null}</> : <span className="muted">{t('health.notYet')}</span>}</td>
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
  const { t } = useI18n();
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
    <form className="card form" aria-label={t('health.new')} onSubmit={submit}>
      <h2>{t('health.new')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('health.type')}
        <select value={type} onChange={(e) => setType(e.target.value as CheckType)}>{CHECK_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>{type === 'HTTP' ? t('health.addressInput') : t('health.hostPort')}
        <input value={target} maxLength={300} placeholder={type === 'HTTP' ? 'https://intranet.acme.test/health' : 'db.internal:5432'} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <label>{t('health.everyInput')}<input inputMode="numeric" value={interval} onChange={(e) => setIntervalValue(e.target.value)} /></label>
      <label>{t('health.timeoutInput')}<input inputMode="numeric" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} /></label>
      {type === 'HTTP' && <label>{t('health.expectedInput')}<input inputMode="numeric" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>}
      <label>{t('health.failuresInput')}<input inputMode="numeric" value={failures} onChange={(e) => setFailures(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('health.starting') : t('health.start')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function CheckDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
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
    <aside className="detail" aria-label={t('health.detail')}>
      <div className="detail-head">
        <h2>{check?.name ?? t('health.check')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {check && (
        <>
          <p><StatusBadge status={check.health} /> <StatusBadge status={check.status} /></p>
          <dl>
            <dt>{t('health.target')}</dt><dd><code>{check.target}</code></dd>
            <dt>{t('health.probed')}</dt><dd>{t('health.probedEvery', { seconds: check.intervalSeconds, millis: check.timeoutMillis })}</dd>
            <dt>{t('health.downAfter')}</dt><dd>{t('health.thresholds', { down: check.failureThreshold, up: check.successThreshold })}</dd>
            {check.expectedStatus && <><dt>{t('health.expected')}</dt><dd>{check.expectedStatus}</dd></>}
            {check.consecutiveFailures > 0 && <><dt>{t('health.failingFor')}</dt><dd>{t('health.failingProbes', { count: check.consecutiveFailures })}</dd></>}
            {check.lastStateChangeAt && <><dt>{t('health.lastChange')}</dt><dd>{new Date(check.lastStateChangeAt).toLocaleString(locale)}</dd></>}
          </dl>
          <div className="actions" aria-label={t('itsm.actions')}>
            <button type="button" disabled={busy} onClick={() => void run(() => health.run(id))}>{t('health.probeNow')}</button>
            {check.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => health.control(id, 'pause'))}>{t('ops.pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => health.control(id, 'resume'))}>{t('ops.resume')}</button>}
          </div>
          <h3>{t('health.recentProbes')}</h3>
          {detail.data?.results.length === 0 ? <Empty>{t('health.noProbes')}</Empty> : (
            <table aria-label={t('health.recentProbes')}>
              <thead><tr><th>{t('audit.col.when')}</th><th>{t('ops.result')}</th><th>{t('common.status')}</th><th>{t('health.latency')}</th></tr></thead>
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

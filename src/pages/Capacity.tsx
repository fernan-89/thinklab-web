import { useState, type FormEvent } from 'react';
import { capacityApi } from '../api/services';
import {
  CAPACITY_FORECASTS, CAPACITY_LEVELS, CAPACITY_METRICS, POLICY_STATUSES,
  type AuditEntry, type CapacityForecast, type CapacityLevel, type CapacityMetric, type CapacityPolicy, type CapacitySample, type PolicyStatus,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : undefined);
const percent = (value?: number) => (value === undefined ? undefined : `${value.toFixed(1)}%`);

/** Where the trend leads, in words a person can read. */
function runsOut(policy: CapacityPolicy, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  switch (policy.forecast) {
    case 'WITHIN_HORIZON':
    case 'BEYOND_HORIZON':
      return policy.daysToLimit === 0 ? t('capacity.now') : t('capacity.inDays', { days: policy.daysToLimit?.toFixed(1) ?? '' });
    case 'STABLE':
      return t('capacity.notGrowing');
    case 'NOT_ENOUGH_DATA':
      return t('capacity.notEnough');
    default:
      return '-';
  }
}

export function CapacityPage() {
  const { t, status: statusLabel } = useI18n();
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
        <h1>{t('nav.capacity')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('ops.newPolicy')}</button>
      </div>
      <p className="muted">{t('capacity.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {([['Critical', count('CRITICAL')], ['Warning', count('WARNING')], ['OK', count('OK')], [t('capacity.noData'), count('NO_DATA')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewPolicyForm onCancel={() => setCreating(false)} onCreated={(policy) => { setCreating(false); setSelectedId(policy.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label={t('ops.level')} value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as CapacityLevel | '')}>
          <option value="">{t('capacity.anyLevel')}</option>
          {CAPACITY_LEVELS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('capacity.forecast')} value={forecastFilter} onChange={(e) => setForecastFilter(e.target.value as CapacityForecast | '')}>
          <option value="">{t('capacity.anyForecast')}</option>
          {CAPACITY_FORECASTS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('ops.metric')} value={metricFilter} onChange={(e) => setMetricFilter(e.target.value as CapacityMetric | '')}>
          <option value="">{t('capacity.anyMetric')}</option>
          {CAPACITY_METRICS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('common.status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PolicyStatus | '')}>
          <option value="">{t('ops.activePaused')}</option>
          {POLICY_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('ops.noPolicies')}</Empty> : (
          <table aria-label={t('ops.policies')}>
            <thead><tr><th>{t('ops.policy')}</th><th>{t('ops.metric')}</th><th>{t('ops.level')}</th><th>{t('capacity.used')}</th><th>{t('capacity.runsOut')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {list.data?.map((policy) => (
                <tr key={policy.id} className={policy.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(policy.id)}>{policy.name}</button></td>
                  <td>{policy.metric}</td>
                  <td><StatusBadge status={policy.level} />{policy.stale && <span className="stale-note"> {t('capacity.noRecentSample')}</span>}</td>
                  <td>{percent(policy.utilisationPercent) ?? <span className="muted">-</span>}</td>
                  <td>{runsOut(policy, t)}</td>
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
  const { t, status: statusLabel } = useI18n();
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
    <form className="card form" aria-label={t('ops.newPolicy')} onSubmit={submit}>
      <h2>{t('ops.newPolicy')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('capacity.assetInput')}<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>{t('ops.metric')}
        <select value={metric} onChange={(e) => setMetric(e.target.value as CapacityMetric)}>{CAPACITY_METRICS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
      </label>
      <label>{t('capacity.limitInput')}<input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
      <label>{t('capacity.warnInput')}<input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
      <label>{t('capacity.criticalInput')}<input inputMode="numeric" value={critical} onChange={(e) => setCritical(e.target.value)} /></label>
      <label>{t('capacity.trendInput')}<input inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} /></label>
      <label>{t('capacity.runOutInput')}<input inputMode="numeric" value={horizonDays} onChange={(e) => setHorizonDays(e.target.value)} /></label>
      <label>{t('capacity.reportsInput')}<input inputMode="numeric" value={reportEvery} onChange={(e) => setReportEvery(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('ops.createPolicy')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function PolicyDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale, status: statusLabel } = useI18n();
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
    <aside className="detail" aria-label={t('ops.policyDetail')}>
      <div className="detail-head">
        <h2>{policy?.name ?? t('ops.policy')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {policy && (
        <>
          <p><StatusBadge status={policy.level} /> <StatusBadge status={policy.status} />{policy.forecast && <> <StatusBadge status={policy.forecast} /></>}</p>
          <dl>
            <dt>{t('capacity.watch')}</dt><dd>{t('capacity.watching', { metric: statusLabel(policy.metric), limit: policy.limit, warn: policy.warnPercent, critical: policy.criticalPercent })}</dd>
            <dt>{t('ops.asset')}</dt><dd><code>{policy.assetId}</code></dd>
            {policy.lastValue !== undefined && <><dt>{t('capacity.latest')}</dt><dd>{policy.lastValue} ({percent(policy.utilisationPercent)}) at {when(policy.lastMeasuredAt, locale)}{policy.stale ? ', older than twice the expected interval' : ''}</dd></>}
            <dt>{t('capacity.trend')}</dt><dd>{t('capacity.trendText', { days: policy.windowDays, runsOut: runsOut(policy, t), around: policy.projectedExhaustionAt ? t('capacity.around', { when: when(policy.projectedExhaustionAt, locale) ?? '' }) : '' })}</dd>
            <dt>{t('capacity.reports')}</dt><dd>{t('capacity.reportsText', { hours: policy.reportEveryHours, days: policy.horizonDays })}</dd>
          </dl>
          <div className="actions" aria-label={t('itsm.actions')}>
            {policy.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => capacity.control(id, 'pause'))}>{t('ops.pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => capacity.control(id, 'resume'))}>{t('ops.resume')}</button>}
          </div>
          <h3>{t('capacity.recentSamples')}</h3>
          {detail.data?.samples.length === 0 ? <Empty>{t('capacity.noSamples')}</Empty> : (
            <table aria-label={t('capacity.recentSamples')}>
              <thead><tr><th>{t('capacity.taken')}</th><th>{t('capacity.value')}</th><th>{t('ops.by')}</th></tr></thead>
              <tbody>
                {detail.data?.samples.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.measuredAt).toLocaleString(locale)}</td>
                    <td>{entry.value}</td>
                    <td>{entry.reportedBy}</td>
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

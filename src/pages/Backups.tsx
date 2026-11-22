import { useState, type FormEvent } from 'react';
import { backupApi } from '../api/services';
import { POLICY_STATUSES, PROTECTIONS, type AuditEntry, type BackupPolicy, type BackupRun, type PolicyStatus, type Protection } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const optionalNumber = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value));
const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : undefined);

export function BackupsPage() {
  const { t, locale, status: statusLabel } = useI18n();
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
        <h1>{t('nav.backups')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('ops.newPolicy')}</button>
      </div>
      <p className="muted">{t('backups.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {([['Protected', count('OK')], [t('backups.noBackupYet'), count('NEVER')], [t('backups.pastRpo'), count('RPO_BREACHED')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewPolicyForm onCancel={() => setCreating(false)} onCreated={(policy) => { setCreating(false); setSelectedId(policy.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label={t('backups.protection')} value={protectionFilter} onChange={(e) => setProtectionFilter(e.target.value as Protection | '')}>
          <option value="">{t('backups.anyProtection')}</option>
          {PROTECTIONS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
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
            <thead><tr><th>{t('ops.policy')}</th><th>{t('backups.protection')}</th><th>{t('backups.lastBackup')}</th><th>{t('backups.protectedUntil')}</th><th>{t('ops.restoreTest')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {list.data?.map((policy) => (
                <tr key={policy.id} className={policy.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(policy.id)}>{policy.name}</button></td>
                  <td><StatusBadge status={policy.protection} /></td>
                  <td>{when(policy.lastSuccessAt, locale) ?? <span className="muted">{t('ops.noneYet')}</span>}</td>
                  <td>{when(policy.protectedUntil, locale) ?? <span className="muted">-</span>}</td>
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
  const { t } = useI18n();
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
    <form className="card form" aria-label={t('ops.newPolicy')} onSubmit={submit}>
      <h2>{t('ops.newPolicy')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('backups.assetInput')}<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>{t('backups.everyInput')}<input inputMode="numeric" value={frequency} onChange={(e) => setFrequency(e.target.value)} /></label>
      <label>{t('backups.rpoInput')}<input inputMode="numeric" value={rpo} onChange={(e) => setRpo(e.target.value)} /></label>
      <label>{t('ops.longestRecovery')}<input inputMode="numeric" value={rto} onChange={(e) => setRto(e.target.value)} /></label>
      <label>{t('backups.keepInput')}<input inputMode="numeric" value={retention} onChange={(e) => setRetention(e.target.value)} /></label>
      <label>{t('backups.proveInput')}<input inputMode="numeric" value={restoreEvery} onChange={(e) => setRestoreEvery(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('ops.createPolicy')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function PolicyDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale, enumValue, status: statusLabel } = useI18n();
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
    <aside className="detail" aria-label={t('ops.policyDetail')}>
      <div className="detail-head">
        <h2>{policy?.name ?? t('ops.policy')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {policy && (
        <>
          <p><StatusBadge status={policy.protection} /> <StatusBadge status={policy.status} /></p>
          <dl>
            <dt>{t('ops.promise')}</dt><dd>{t('backups.promise', { frequency: policy.frequencyHours, rpo: policy.rpoHours, rto: policy.rtoMinutes, days: policy.retentionDays })}</dd>
            <dt>{t('ops.asset')}</dt><dd><code>{policy.assetId}</code></dd>
            {policy.restoreTestEveryDays && <><dt>{t('ops.restoreTest')}</dt><dd>{t('backups.restoreEvery', { days: policy.restoreTestEveryDays })}: <StatusBadge status={policy.restoreTest} />{policy.restoreTestDueAt ? ` ${t('backups.due', { when: when(policy.restoreTestDueAt, locale) ?? '' })}` : ''}</dd></>}
            {policy.lastRestoreMinutes !== undefined && <><dt>{t('backups.lastRestoreTook')}</dt><dd>{t(policy.rtoMet ? 'ops.minutesWithin' : 'ops.minutesOver', { minutes: policy.lastRestoreMinutes })}</dd></>}
            {policy.lastRunAt && <><dt>{t('backups.lastRun')}</dt><dd>{when(policy.lastRunAt, locale)}</dd></>}
          </dl>
          <div className="actions" aria-label={t('itsm.actions')}>
            {policy.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => backups.control(id, 'pause'))}>{t('ops.pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => backups.control(id, 'resume'))}>{t('ops.resume')}</button>}
          </div>
          <h3>{t('backups.recentRuns')}</h3>
          {detail.data?.runs.length === 0 ? <Empty>{t('backups.noRuns')}</Empty> : (
            <table aria-label={t('backups.recentRuns')}>
              <thead><tr><th>{t('ops.started')}</th><th>{t('ops.kind')}</th><th>{t('ops.result')}</th><th>{t('backups.took')}</th><th>{t('ops.by')}</th></tr></thead>
              <tbody>
                {detail.data?.runs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.startedAt).toLocaleString(locale)}</td>
                    <td>{entry.kind === 'BACKUP' ? t('backups.kindBackup') : t('backups.kindRestoreTest')}</td>
                    <td>{entry.outcome === 'SUCCEEDED' ? statusLabel('succeeded') : <span className="field-error">{entry.failureReason ? enumValue(entry.failureReason) : ''}</span>}</td>
                    <td>{t('common.minutes', { count: entry.durationMinutes })}</td>
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

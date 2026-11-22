import { useState, type FormEvent } from 'react';
import { patchApi } from '../api/services';
import {
  FINDING_STATUSES, PATCH_COMPLIANCES, POLICY_STATUSES, WAIVER_REASONS, type FindingStatus, type PatchCompliance, type PatchFinding, type PatchPolicy,
  type PolicyStatus, type WaiverReason, type AuditEntry,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : undefined);
const DAY_MS = 24 * 3600 * 1000;

export function PatchesPage() {
  const { t, status: statusLabel } = useI18n();
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
        <h1>{t('nav.patches')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('ops.newPolicy')}</button>
      </div>
      <p className="muted">{t('patches.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {([['Compliant', count('COMPLIANT')], [t('patches.overdue'), count('OVERDUE')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewPolicyForm onCancel={() => setCreating(false)} onCreated={(policy) => { setCreating(false); setSelectedId(policy.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label={t('patches.compliance')} value={complianceFilter} onChange={(e) => setComplianceFilter(e.target.value as PatchCompliance | '')}>
          <option value="">{t('patches.anyCompliance')}</option>
          {PATCH_COMPLIANCES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
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
            <thead><tr><th>{t('ops.policy')}</th><th>{t('patches.compliance')}</th><th>{t('ops.open')}</th><th>{t('patches.overdue')}</th><th>{t('patches.waived')}</th><th>{t('patches.days')}</th><th>{t('common.status')}</th></tr></thead>
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
  const { t } = useI18n();
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
    <form className="card form" aria-label={t('ops.newPolicy')} onSubmit={submit}>
      <h2>{t('ops.newPolicy')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('patches.assetInput')}<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>{t('patches.criticalInput')}<input inputMode="numeric" value={critical} onChange={(e) => setCritical(e.target.value)} /></label>
      <label>{t('patches.highInput')}<input inputMode="numeric" value={high} onChange={(e) => setHigh(e.target.value)} /></label>
      <label>{t('patches.mediumInput')}<input inputMode="numeric" value={medium} onChange={(e) => setMedium(e.target.value)} /></label>
      <label>{t('patches.lowInput')}<input inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} /></label>
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
    <aside className="detail" aria-label={t('ops.policyDetail')}>
      <div className="detail-head">
        <h2>{policy?.name ?? t('ops.policy')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {policy && (
        <>
          <p><StatusBadge status={policy.compliance} /> <StatusBadge status={policy.status} /></p>
          <dl>
            <dt>{t('ops.promise')}</dt><dd>{t('patches.promise', { critical: policy.criticalDays, high: policy.highDays, medium: policy.mediumDays, low: policy.lowDays })}</dd>
            <dt>{t('ops.asset')}</dt><dd><code>{policy.assetId}</code></dd>
            <dt>{t('ops.open')}</dt><dd>{t('patches.counts', { open: policy.openFindings, overdue: policy.overdueFindings, waived: policy.waivedFindings })}</dd>
            {policy.oldestOverdueDueAt && <><dt>{t('patches.oldestOverdue')}</dt><dd>{when(policy.oldestOverdueDueAt, locale)}</dd></>}
          </dl>
          <div className="actions" aria-label={t('itsm.actions')}>
            {policy.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => patches.control(id, 'pause'))}>{t('ops.pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => patches.control(id, 'resume'))}>{t('ops.resume')}</button>}
          </div>
          <h3>{t('nav.patches')}</h3>
          <div className="filters">
            <select aria-label={t('patches.patchStatus')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FindingStatus | '')}>
              <option value="">{t('patches.anyStatus')}</option>
              {FINDING_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
            </select>
          </div>
          {detail.data?.findings.length === 0 ? <Empty>{t('patches.noPatches')}</Empty> : (
            <table aria-label={t('nav.patches')}>
              <thead><tr><th>{t('patches.patch')}</th><th>{t('patches.severity')}</th><th>{t('patches.due')}</th><th>{t('common.status')}</th><th /></tr></thead>
              <tbody>
                {detail.data?.findings.map((finding) => (
                  <tr key={finding.id}>
                    <td><code>{finding.patchRef}</code></td>
                    <td><StatusBadge status={finding.severity} /></td>
                    <td>{when(finding.dueAt, locale) ?? '-'}{finding.overdue && <span className="field-error"> {t('patches.overdueLower')}</span>}</td>
                    <td>
                      <StatusBadge status={finding.status} />
                      {finding.status === 'WAIVED' && <div className="muted small">{finding.waiverReason ? statusLabel(finding.waiverReason) : ''} {t('patches.until', { when: when(finding.waivedUntil, locale) ?? '' })}</div>}
                    </td>
                    <td>
                      {finding.status === 'PENDING' && <button type="button" className="link" disabled={busy} onClick={() => setWaiving(finding.id)}>{t('patches.waive')}</button>}
                      {finding.status === 'WAIVED' && <button type="button" className="link" disabled={busy} onClick={() => void run(() => patches.unwaive(finding.id))}>{t('patches.withdraw')}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {waiving && (
            <form className="card form" aria-label={t('patches.waivePatch')} onSubmit={(event) => {
              event.preventDefault();
              const target = waiving;
              setWaiving(undefined);
              void run(() => patches.waive(target, reason, new Date(Date.now() + Number(days) * DAY_MS).toISOString()));
            }}>
              <h3>{t('patches.waiveThis')}</h3>
              <label>{t('patches.reason')}
                <select value={reason} onChange={(e) => setReason(e.target.value as WaiverReason)}>{WAIVER_REASONS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
              </label>
              <label>{t('patches.daysInput')}<input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
              <div className="actions">
                <button type="submit" className="primary" disabled={days.trim() === ''}>{t('patches.waive')}</button>
                <button type="button" onClick={() => setWaiving(undefined)}>{t('common.cancel')}</button>
              </div>
            </form>
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

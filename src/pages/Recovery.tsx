import { useState, type FormEvent } from 'react';
import { drApi } from '../api/services';
import {
  EXERCISE_FAILURE_REASONS, EXERCISE_KINDS, EXERCISE_OUTCOMES, POLICY_STATUSES, READINESSES, RECOVERY_STRATEGIES,
  type AuditEntry, type ExerciseFailureReason, type ExerciseKind, type ExerciseOutcome, type PolicyStatus, type Readiness, type RecoveryExercise, type RecoveryPlan,
  type RecoveryStrategy,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const optionalNumber = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value));
const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : undefined);
const strategyEnglish = (value: RecoveryStrategy) => RECOVERY_STRATEGIES.find((s) => s.value === value)?.label ?? value;
const kindEnglish = (value: ExerciseKind) => EXERCISE_KINDS.find((k) => k.value === value)?.label ?? value;

/** The value of a datetime-local input, shifted by some minutes from now, in the browser's own time. */
function localInput(minutesFromNow: number): string {
  const moment = new Date(Date.now() + minutesFromNow * 60_000);
  const local = new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function RecoveryPage() {
  const { t, locale, status: statusLabel, label: optionLabel } = useI18n();
  const { api } = useSession();
  const dr = drApi(api);
  const [readinessFilter, setReadinessFilter] = useState<Readiness | ''>('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => dr.list({}), []);
  const list = useAsync(() => dr.list({ readiness: readinessFilter || undefined, status: statusFilter || undefined }), [readinessFilter, statusFilter]);
  const reloadAll = () => { list.reload(); everything.reload(); };
  const count = (readiness: Readiness) => everything.data?.filter((plan) => plan.readiness === readiness).length;

  return (
    <section>
      <div className="page-head">
        <h1>{t('nav.recovery')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('recovery.new')}</button>
      </div>
      <p className="muted">{t('recovery.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {([['Ready', count('READY')], [t('recovery.neverTested'), count('NEVER_TESTED')], [t('recovery.testOverdue'), count('TEST_OVERDUE')], [t('recovery.objectiveMissed'), count('OBJECTIVE_MISSED')],
          [t('recovery.lastFailed'), count('LAST_EXERCISE_FAILED')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewPlanForm onCancel={() => setCreating(false)} onCreated={(plan) => { setCreating(false); setSelectedId(plan.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label={t('recovery.readiness')} value={readinessFilter} onChange={(e) => setReadinessFilter(e.target.value as Readiness | '')}>
          <option value="">{t('recovery.anyReadiness')}</option>
          {READINESSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('common.status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PolicyStatus | '')}>
          <option value="">{t('ops.activePaused')}</option>
          {POLICY_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('recovery.noPlans')}</Empty> : (
          <table aria-label={t('recovery.plans')}>
            <thead><tr><th>{t('recovery.plan')}</th><th>{t('recovery.strategy')}</th><th>{t('recovery.readiness')}</th><th>{t('recovery.lastExercise')}</th><th>{t('recovery.nextDue')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {list.data?.map((plan) => (
                <tr key={plan.id} className={plan.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(plan.id)}>{plan.name}</button></td>
                  <td>{optionLabel(strategyEnglish(plan.strategy)).split(' (')[0]}</td>
                  <td><StatusBadge status={plan.readiness} /></td>
                  <td>{when(plan.lastExerciseAt, locale) ?? <span className="muted">{t('ops.noneYet')}</span>}</td>
                  <td>{when(plan.nextExerciseDueAt, locale) ?? <span className="muted">-</span>}</td>
                  <td><StatusBadge status={plan.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <PlanDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={reloadAll} />}
      </div>
    </section>
  );
}

function NewPlanForm({ onCreated, onCancel }: { onCreated: (plan: RecoveryPlan) => void; onCancel: () => void }) {
  const { t, label: optionLabel } = useI18n();
  const { api } = useSession();
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [strategy, setStrategy] = useState<RecoveryStrategy>('WARM_STANDBY');
  const [rto, setRto] = useState('120');
  const [rpo, setRpo] = useState('30');
  const [every, setEvery] = useState('90');
  const [runbookRef, setRunbookRef] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && assetId.trim() !== '' && [rto, rpo, every].every((value) => value.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await drApi(api).create({
        name: name.trim(), assetId: assetId.trim(), strategy, rtoMinutes: Number(rto), rpoMinutes: Number(rpo), testEveryDays: Number(every),
        runbookRef: runbookRef.trim() === '' ? undefined : runbookRef.trim(),
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={t('recovery.new')} onSubmit={submit}>
      <h2>{t('recovery.new')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('recovery.assetInput')}<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>{t('recovery.strategy')}
        <select value={strategy} onChange={(e) => setStrategy(e.target.value as RecoveryStrategy)}>
          {RECOVERY_STRATEGIES.map((s) => <option key={s.value} value={s.value}>{optionLabel(s.label)}</option>)}
        </select>
      </label>
      <label>{t('ops.longestRecovery')}<input inputMode="numeric" value={rto} onChange={(e) => setRto(e.target.value)} /></label>
      <label>{t('recovery.rpoInput')}<input inputMode="numeric" value={rpo} onChange={(e) => setRpo(e.target.value)} /></label>
      <label>{t('recovery.proveInput')}<input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} /></label>
      <label>{t('recovery.runbookInput')}<input value={runbookRef} maxLength={64} onChange={(e) => setRunbookRef(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('recovery.create')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function PlanDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale, label: optionLabel, enumValue, status: statusLabel } = useI18n();
  const { api } = useSession();
  const dr = drApi(api);
  const detail = useAsync<{ plan: RecoveryPlan; exercises: RecoveryExercise[]; trail: AuditEntry[] }>(async () => {
    const [plan, exercises, trail] = await Promise.all([dr.retrieve(id), dr.exercises({ planId: id }), dr.auditLog(id)]);
    return { plan, exercises, trail };
  }, [id]);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const plan = detail.data?.plan;

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
    <aside className="detail" aria-label={t('recovery.detail')}>
      <div className="detail-head">
        <h2>{plan?.name ?? t('recovery.plan')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {plan && (
        <>
          <p><StatusBadge status={plan.readiness} /> <StatusBadge status={plan.status} /></p>
          <dl>
            <dt>{t('ops.promise')}</dt><dd>{t('recovery.promise', { strategy: optionLabel(strategyEnglish(plan.strategy)).split(' (')[0].toLowerCase(), rto: plan.rtoMinutes, rpo: plan.rpoMinutes, days: plan.testEveryDays })}</dd>
            <dt>{t('ops.asset')}</dt><dd><code>{plan.assetId}</code></dd>
            {plan.runbookRef && <><dt>{t('recovery.runbook')}</dt><dd><code>{plan.runbookRef}</code></dd></>}
            {plan.nextExerciseDueAt && <><dt>{t('recovery.nextExerciseDue')}</dt><dd>{when(plan.nextExerciseDueAt, locale)}</dd></>}
            {plan.lastMeasuredMinutes !== undefined
              ? <><dt>{t('recovery.lastMeasured')}</dt><dd>{t(plan.rtoMet ? 'ops.minutesWithin' : 'ops.minutesOver', { minutes: plan.lastMeasuredMinutes ?? '' })}{plan.lastMeasuredDataLossMinutes !== undefined ? `; ${t(plan.rpoMet ? 'recovery.dataLostWithin' : 'recovery.dataLostOver', { minutes: plan.lastMeasuredDataLossMinutes })}` : ''}</dd></>
              : <><dt>{t('recovery.objectives')}</dt><dd><span className="muted">{t('recovery.notMeasured')}</span></dd></>}
            {plan.lastExerciseAt && <><dt>{t('recovery.lastExercise')}</dt><dd>{when(plan.lastExerciseAt, locale)}, {plan.lastOutcome?.toLowerCase()}</dd></>}
          </dl>
          <div className="actions" aria-label={t('itsm.actions')}>
            <button type="button" disabled={busy} onClick={() => setReporting(true)}>{t('recovery.report')}</button>
            {plan.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => dr.control(id, 'pause'))}>{t('ops.pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => dr.control(id, 'resume'))}>{t('ops.resume')}</button>}
          </div>
          {reporting && <ReportExerciseForm planId={id} onCancel={() => setReporting(false)} onReported={() => { setReporting(false); detail.reload(); onChanged(); }} />}
          <h3>{t('recovery.recentExercises')}</h3>
          {detail.data?.exercises.length === 0 ? <Empty>{t('recovery.noExercises')}</Empty> : (
            <table aria-label={t('recovery.recentExercises')}>
              <thead><tr><th>{t('ops.started')}</th><th>{t('ops.kind')}</th><th>{t('ops.result')}</th><th>{t('backups.took')}</th><th>{t('recovery.dataLost')}</th><th>{t('ops.by')}</th></tr></thead>
              <tbody>
                {detail.data?.exercises.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.startedAt).toLocaleString(locale)}</td>
                    <td>{optionLabel(kindEnglish(entry.kind))}</td>
                    <td>{entry.outcome === 'SUCCEEDED' ? statusLabel('succeeded') : <span className="field-error">{statusLabel(entry.outcome).toLowerCase()}: {entry.failureReason ? enumValue(entry.failureReason) : ''}</span>}</td>
                    <td>{t('common.minutes', { count: entry.durationMinutes })}</td>
                    <td>{entry.dataLossMinutes !== undefined ? t('common.minutes', { count: entry.dataLossMinutes }) : <span className="muted">-</span>}</td>
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

function ReportExerciseForm({ planId, onReported, onCancel }: { planId: string; onReported: () => void; onCancel: () => void }) {
  const { t, label: optionLabel, status: statusLabel } = useI18n();
  const { api } = useSession();
  const [kind, setKind] = useState<ExerciseKind>('FAILOVER');
  const [outcome, setOutcome] = useState<ExerciseOutcome>('SUCCEEDED');
  const [startedAt, setStartedAt] = useState(() => localInput(-60));
  const [finishedAt, setFinishedAt] = useState(() => localInput(-1));
  const [loss, setLoss] = useState('');
  const [reason, setReason] = useState<ExerciseFailureReason>('RUNBOOK_OUTDATED');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const failed = outcome !== 'SUCCEEDED';
  const ready = startedAt !== '' && finishedAt !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await drApi(api).report({
        planId, kind, outcome, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date(finishedAt).toISOString(),
        dataLossMinutes: optionalNumber(loss), failureReason: failed ? reason : undefined,
      });
      onReported();
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={t('recovery.report')} onSubmit={submit}>
      <h3>{t('recovery.report')}</h3>
      <label>{t('ops.kind')}
        <select value={kind} onChange={(e) => setKind(e.target.value as ExerciseKind)}>{EXERCISE_KINDS.map((k) => <option key={k.value} value={k.value}>{optionLabel(k.label)}</option>)}</select>
      </label>
      <label>{t('recovery.outcome')}
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as ExerciseOutcome)}>{EXERCISE_OUTCOMES.map((o) => <option key={o} value={o}>{statusLabel(o).toLowerCase()}</option>)}</select>
      </label>
      {failed && (
        <label>{t('recovery.whatWrong')}
          <select value={reason} onChange={(e) => setReason(e.target.value as ExerciseFailureReason)}>{EXERCISE_FAILURE_REASONS.map((r) => <option key={r} value={r}>{statusLabel(r).toLowerCase()}</option>)}</select>
        </label>
      )}
      <label>{t('ops.started')}<input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></label>
      <label>{t('recovery.finished')}<input type="datetime-local" value={finishedAt} onChange={(e) => setFinishedAt(e.target.value)} /></label>
      <label>{t('recovery.dataLostInput')}<input inputMode="numeric" value={loss} onChange={(e) => setLoss(e.target.value)} /></label>
      <p className="muted">{t('recovery.durationNote')}</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('recovery.reportSubmit')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

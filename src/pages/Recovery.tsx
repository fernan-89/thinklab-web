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

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const optionalNumber = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value));
const when = (value?: string) => (value ? new Date(value).toLocaleString() : undefined);
const strategyLabel = (value: RecoveryStrategy) => RECOVERY_STRATEGIES.find((s) => s.value === value)?.label.split(' (')[0] ?? value;
const kindLabel = (value: ExerciseKind) => EXERCISE_KINDS.find((k) => k.value === value)?.label ?? value;

/** The value of a datetime-local input, shifted by some minutes from now, in the browser's own time. */
function localInput(minutesFromNow: number): string {
  const moment = new Date(Date.now() + minutesFromNow * 60_000);
  const local = new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function RecoveryPage() {
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
        <h1>Recovery</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New plan</button>
      </div>
      <p className="muted">How each asset is meant to come back from a disaster, and whether that has been proved lately. People and tools report each exercise here; nothing on this page runs one.</p>
      <div className="tiles" aria-label="Summary">
        {([['Ready', count('READY')], ['Never tested', count('NEVER_TESTED')], ['Test overdue', count('TEST_OVERDUE')], ['Objective missed', count('OBJECTIVE_MISSED')],
          ['Last exercise failed', count('LAST_EXERCISE_FAILED')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewPlanForm onCancel={() => setCreating(false)} onCreated={(plan) => { setCreating(false); setSelectedId(plan.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Readiness" value={readinessFilter} onChange={(e) => setReadinessFilter(e.target.value as Readiness | '')}>
          <option value="">Any readiness</option>
          {READINESSES.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </select>
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PolicyStatus | '')}>
          <option value="">Active and paused</option>
          {POLICY_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No plans match.</Empty> : (
          <table aria-label="Plans">
            <thead><tr><th>Plan</th><th>Strategy</th><th>Readiness</th><th>Last exercise</th><th>Next due</th><th>Status</th></tr></thead>
            <tbody>
              {list.data?.map((plan) => (
                <tr key={plan.id} className={plan.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(plan.id)}>{plan.name}</button></td>
                  <td>{strategyLabel(plan.strategy)}</td>
                  <td><StatusBadge status={plan.readiness} /></td>
                  <td>{when(plan.lastExerciseAt) ?? <span className="muted">none yet</span>}</td>
                  <td>{when(plan.nextExerciseDueAt) ?? <span className="muted">-</span>}</td>
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
    <form className="card form" aria-label="New plan" onSubmit={submit}>
      <h2>New plan</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Asset it recovers (identifier)<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>Strategy
        <select value={strategy} onChange={(e) => setStrategy(e.target.value as RecoveryStrategy)}>
          {RECOVERY_STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label>Longest recovery (minutes)<input inputMode="numeric" value={rto} onChange={(e) => setRto(e.target.value)} /></label>
      <label>Most data that may be lost (minutes; a plan that restores from a backup cannot promise zero)<input inputMode="numeric" value={rpo} onChange={(e) => setRpo(e.target.value)} /></label>
      <label>Prove it every (days)<input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} /></label>
      <label>Runbook (an identifier such as KB-1042, optional)<input value={runbookRef} maxLength={64} onChange={(e) => setRunbookRef(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create plan'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function PlanDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
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
    <aside className="detail" aria-label="Plan detail">
      <div className="detail-head">
        <h2>{plan?.name ?? 'Plan'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {plan && (
        <>
          <p><StatusBadge status={plan.readiness} /> <StatusBadge status={plan.status} /></p>
          <dl>
            <dt>Promise</dt><dd>{strategyLabel(plan.strategy).toLowerCase()}, recovered within {plan.rtoMinutes} min, at most {plan.rpoMinutes} min of data lost, proved every {plan.testEveryDays} days</dd>
            <dt>Asset</dt><dd><code>{plan.assetId}</code></dd>
            {plan.runbookRef && <><dt>Runbook</dt><dd><code>{plan.runbookRef}</code></dd></>}
            {plan.nextExerciseDueAt && <><dt>Next exercise due</dt><dd>{when(plan.nextExerciseDueAt)}</dd></>}
            {plan.lastMeasuredMinutes !== undefined
              ? <><dt>Last measured recovery</dt><dd>{plan.lastMeasuredMinutes} min, {plan.rtoMet ? 'within' : 'over'} the objective{plan.lastMeasuredDataLossMinutes !== undefined ? `; ${plan.lastMeasuredDataLossMinutes} min of data lost, ${plan.rpoMet ? 'within' : 'over'} the objective` : ''}</dd></>
              : <><dt>Objectives</dt><dd><span className="muted">not measured yet: only a failover or a full recovery measures them</span></dd></>}
            {plan.lastExerciseAt && <><dt>Last exercise</dt><dd>{when(plan.lastExerciseAt)}, {plan.lastOutcome?.toLowerCase()}</dd></>}
          </dl>
          <div className="actions" aria-label="Actions">
            <button type="button" disabled={busy} onClick={() => setReporting(true)}>Report an exercise</button>
            {plan.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => dr.control(id, 'pause'))}>Pause</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => dr.control(id, 'resume'))}>Resume</button>}
          </div>
          {reporting && <ReportExerciseForm planId={id} onCancel={() => setReporting(false)} onReported={() => { setReporting(false); detail.reload(); onChanged(); }} />}
          <h3>Recent exercises</h3>
          {detail.data?.exercises.length === 0 ? <Empty>No exercises reported yet.</Empty> : (
            <table aria-label="Recent exercises">
              <thead><tr><th>Started</th><th>Kind</th><th>Result</th><th>Took</th><th>Data lost</th><th>By</th></tr></thead>
              <tbody>
                {detail.data?.exercises.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.startedAt).toLocaleString()}</td>
                    <td>{kindLabel(entry.kind)}</td>
                    <td>{entry.outcome === 'SUCCEEDED' ? 'succeeded' : <span className="field-error">{entry.outcome.toLowerCase()}: {entry.failureReason}</span>}</td>
                    <td>{entry.durationMinutes} min</td>
                    <td>{entry.dataLossMinutes !== undefined ? `${entry.dataLossMinutes} min` : <span className="muted">-</span>}</td>
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

function ReportExerciseForm({ planId, onReported, onCancel }: { planId: string; onReported: () => void; onCancel: () => void }) {
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
    <form className="card form" aria-label="Report an exercise" onSubmit={submit}>
      <h3>Report an exercise</h3>
      <label>Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as ExerciseKind)}>{EXERCISE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
      </label>
      <label>Outcome
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as ExerciseOutcome)}>{EXERCISE_OUTCOMES.map((o) => <option key={o} value={o}>{o.toLowerCase()}</option>)}</select>
      </label>
      {failed && (
        <label>What went wrong
          <select value={reason} onChange={(e) => setReason(e.target.value as ExerciseFailureReason)}>{EXERCISE_FAILURE_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>)}</select>
        </label>
      )}
      <label>Started<input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></label>
      <label>Finished<input type="datetime-local" value={finishedAt} onChange={(e) => setFinishedAt(e.target.value)} /></label>
      <label>Data lost (minutes, if known)<input inputMode="numeric" value={loss} onChange={(e) => setLoss(e.target.value)} /></label>
      <p className="muted">How long it took is the time between the two moments. A walk through the runbook counts as a pass but does not measure the recovery time.</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Report'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

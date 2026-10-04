import { useState, type FormEvent } from 'react';
import { PROBLEM_ACTIONS, problemApi, type ProblemAction } from '../api/services';
import { PROBLEM_PRIORITIES, PROBLEM_STATUSES, type AuditEntry, type Problem, type ProblemPriority, type ProblemStatus } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { isId, parseIds } from './Incidents';

const short = (id: string) => id.slice(0, 8);
const OPEN: ProblemStatus[] = ['NEW', 'UNDER_INVESTIGATION', 'KNOWN_ERROR'];

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

export function ProblemsPage() {
  const { api, session } = useSession();
  const problems = problemApi(api);
  const me = session?.executor ?? '';
  const [status, setStatus] = useState<ProblemStatus | ''>('');
  const [priority, setPriority] = useState<ProblemPriority | ''>('');
  const [incident, setIncident] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [mine, setMine] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const incidentFilter = incident.trim();
  const list = useAsync(
    () => problems.list({
      status: status || undefined, priority: priority || undefined, openOnly: openOnly && status === '',
      assigneeId: mine && isId(me) ? me : undefined, incidentId: isId(incidentFilter) ? incidentFilter : undefined,
    }),
    [status, priority, openOnly, mine, me, incidentFilter],
  );

  return (
    <section>
      <div className="page-head">
        <h1>Problems</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New problem</button>
      </div>
      <p className="muted">The cause behind one or more incidents. A known error is understood and has a workaround, but no permanent fix yet.</p>
      {creating && (
        <NewProblemForm
          onCancel={() => setCreating(false)}
          onCreated={(problem) => { setCreating(false); setSelectedId(problem.id); list.reload(); }}
        />
      )}
      <div className="filters">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as ProblemStatus | '')}>
          <option value="">All statuses</option>
          {PROBLEM_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as ProblemPriority | '')}>
          <option value="">All priorities</option>
          {PROBLEM_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input type="search" aria-label="Explains incident" placeholder="Explains incident (id)" value={incident} onChange={(e) => setIncident(e.target.value)} />
        <label className="check"><input type="checkbox" checked={openOnly && status === ''} disabled={status !== ''} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only</label>
        <label className="check"><input type="checkbox" checked={mine} disabled={!isId(me)} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No problems match.</Empty> : (
          <table>
            <thead><tr><th>Problem</th><th>Priority</th><th>Status</th><th>Incidents</th><th>Assignee</th><th>Opened</th></tr></thead>
            <tbody>
              {list.data?.map((problem) => (
                <tr key={problem.id} className={problem.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(problem.id)}>{problem.title}</button></td>
                  <td><StatusBadge status={problem.priority} /></td>
                  <td><StatusBadge status={problem.status} /></td>
                  <td>{problem.relatedIncidentIds.length}</td>
                  <td>{problem.assigneeId ? <code>{short(problem.assigneeId)}</code> : <span className="muted">unassigned</span>}</td>
                  <td>{new Date(problem.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <ProblemDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={list.reload} />}
      </div>
    </section>
  );
}

function NewProblemForm({ onCreated, onCancel }: { onCreated: (problem: Problem) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ProblemPriority>('P3');
  const [incidents, setIncidents] = useState('');
  const [changes, setChanges] = useState('');
  const [assets, setAssets] = useState('');
  const [localError, setLocalError] = useState<string>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = title.trim() !== '' && description.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedIncidents = parseIds(incidents);
    const parsedChanges = parseIds(changes);
    const parsedAssets = parseIds(assets);
    const failure = parsedIncidents.error ?? parsedChanges.error ?? parsedAssets.error;
    setLocalError(failure);
    if (!ready || failure || !parsedIncidents.ids || !parsedChanges.ids || !parsedAssets.ids) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await problemApi(api).create({
        title: title.trim(), description: description.trim(), priority,
        relatedIncidentIds: parsedIncidents.ids, relatedChangeIds: parsedChanges.ids, affectedAssetIds: parsedAssets.ids,
      }));
    } catch (problem) {
      setError(toError(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New problem" onSubmit={submit}>
      <h2>New problem</h2>
      <label>Title<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Description (no personal data)<textarea value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value as ProblemPriority)}>{PROBLEM_PRIORITIES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>Incidents it explains (ids, optional, separate with spaces or commas)<textarea value={incidents} onChange={(e) => setIncidents(e.target.value)} /></label>
      <label>Changes related to it (ids, optional)<textarea value={changes} onChange={(e) => setChanges(e.target.value)} /></label>
      <label>Affected assets (ids, optional)<textarea value={assets} onChange={(e) => setAssets(e.target.value)} /></label>
      {localError && <p className="field-error" role="alert">{localError}</p>}
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Opening...' : 'Open problem'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

type Pending = 'analysis' | 'resolve' | 'reopen' | 'priority' | undefined;

function IdList({ ids }: { ids: string[] }) {
  return ids.length === 0 ? <>none</> : <>{ids.map((id) => <code key={id}>{short(id)} </code>)}</>;
}

function ProblemDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const problems = problemApi(api);
  const detail = useAsync<{ problem: Problem; trail: AuditEntry[] }>(async () => {
    const [problem, trail] = await Promise.all([problems.retrieve(id), problems.auditLog(id)]);
    return { problem, trail };
  }, [id]);
  const [pending, setPending] = useState<Pending>();
  const [rootCause, setRootCause] = useState('');
  const [workaround, setWorkaround] = useState('');
  const [text, setText] = useState('');
  const [newPriority, setNewPriority] = useState<ProblemPriority>('P3');
  const [assignee, setAssignee] = useState('');
  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const problem = detail.data?.problem;
  const isOpen = problem !== undefined && OPEN.includes(problem.status);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      setPending(undefined);
      setText('');
      setAssignee('');
      setComment('');
      detail.reload();
      onChanged();
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  function begin(next: Pending) {
    setPending(next);
    if (next === 'analysis' && problem) {
      setRootCause(problem.rootCause ?? '');
      setWorkaround(problem.workaround ?? '');
    }
    if (next === 'priority' && problem) setNewPriority(problem.priority);
  }

  function submitPending(event: FormEvent) {
    event.preventDefault();
    if (!problem) return;
    if (pending === 'analysis') {
      void run(() => problems.analysis(id, { rootCause: rootCause.trim() || undefined, workaround: workaround.trim() || undefined }));
    } else if (pending === 'resolve') void run(() => problems.resolve(id, text.trim()));
    else if (pending === 'reopen') void run(() => problems.reopen(id, text.trim()));
    else if (pending === 'priority') {
      void run(() => problems.update(id, {
        title: problem.title, description: problem.description, priority: newPriority, relatedIncidentIds: problem.relatedIncidentIds,
        relatedChangeIds: problem.relatedChangeIds, affectedAssetIds: problem.affectedAssetIds,
      }));
    }
  }

  const pendingReady = pending === 'analysis' ? rootCause.trim() !== '' || workaround.trim() !== '' : pending === 'priority' ? true : text.trim() !== '';

  return (
    <aside className="detail" aria-label="Problem detail">
      <div className="detail-head">
        <h2>{problem?.title ?? 'Problem'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={detail.error ?? actionError} />
      {problem && (
        <>
          <p>
            <StatusBadge status={problem.priority} /> <StatusBadge status={problem.status} />
            {problem.reopenCount > 0 && <span className="muted"> reopened {problem.reopenCount} time{problem.reopenCount === 1 ? '' : 's'}</span>}
          </p>
          <p>{problem.description}</p>
          <dl>
            <dt>Assignee</dt><dd>{problem.assigneeId ? <code>{short(problem.assigneeId)}</code> : 'unassigned'}</dd>
            <dt>Incidents it explains</dt><dd><IdList ids={problem.relatedIncidentIds} /></dd>
            <dt>Related changes</dt><dd><IdList ids={problem.relatedChangeIds} /></dd>
            <dt>Affected assets</dt><dd><IdList ids={problem.affectedAssetIds} /></dd>
            <dt>Root cause</dt><dd>{problem.rootCause ?? <span className="muted">not known yet</span>}</dd>
            <dt>Workaround</dt><dd>{problem.workaround ?? <span className="muted">none yet</span>}</dd>
            {problem.resolution && <><dt>Resolution</dt><dd>{problem.resolution}</dd></>}
          </dl>

          <div className="actions" aria-label="Actions">
            {PROBLEM_ACTIONS[problem.status].map(({ action, label }) => (
              <button key={action} type="button" disabled={busy} onClick={() => void run(() => problems.control(id, action as ProblemAction))}>{label}</button>
            ))}
            {(problem.status === 'UNDER_INVESTIGATION' || problem.status === 'KNOWN_ERROR') && (
              <>
                <button type="button" disabled={busy} onClick={() => begin('analysis')}>Record analysis</button>
                <button type="button" disabled={busy} onClick={() => begin('resolve')}>Resolve</button>
              </>
            )}
            {problem.status === 'RESOLVED' && <button type="button" disabled={busy} onClick={() => begin('reopen')}>Reopen</button>}
            {isOpen && <button type="button" disabled={busy} onClick={() => begin('priority')}>Change priority</button>}
          </div>

          {pending && (
            <form className="form" aria-label="Problem action" onSubmit={submitPending}>
              {pending === 'analysis' && (
                <>
                  <label>Root cause<textarea value={rootCause} maxLength={4000} onChange={(e) => setRootCause(e.target.value)} /></label>
                  <label>Workaround<textarea value={workaround} maxLength={4000} onChange={(e) => setWorkaround(e.target.value)} /></label>
                </>
              )}
              {(pending === 'resolve' || pending === 'reopen') && (
                <label>{pending === 'resolve' ? 'Permanent fix' : 'Why is it reopened?'}
                  <textarea value={text} maxLength={pending === 'resolve' ? 4000 : 500} onChange={(e) => setText(e.target.value)} />
                </label>
              )}
              {pending === 'priority' && (
                <label>Priority
                  <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as ProblemPriority)}>{PROBLEM_PRIORITIES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
                </label>
              )}
              <div className="actions">
                <button type="submit" className="primary" disabled={!pendingReady || busy}>Apply</button>
                <button type="button" onClick={() => setPending(undefined)}>Never mind</button>
              </div>
            </form>
          )}

          {isOpen && (
            <form className="form" aria-label="Assign" onSubmit={(e) => { e.preventDefault(); if (isId(assignee.trim())) void run(() => problems.assign(id, assignee.trim())); }}>
              <label>Assignee (user id)<input value={assignee} onChange={(e) => setAssignee(e.target.value)} /></label>
              <button type="submit" disabled={!isId(assignee.trim()) || busy}>Assign</button>
            </form>
          )}

          <h3>Comments</h3>
          {problem.comments.length === 0 ? <Empty>No comments yet.</Empty> : (
            <ul>
              {problem.comments.map((entry) => (
                <li key={entry.commentId}>
                  {entry.text}
                  <div className="muted small">{short(entry.author)} - {new Date(entry.createdAt).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
          {problem.status !== 'CLOSED' && problem.status !== 'CANCELLED' && (
            <form className="form" aria-label="Add comment" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) void run(() => problems.comment(id, comment.trim())); }}>
              <label>Comment (no personal data)<textarea value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} /></label>
              <button type="submit" disabled={comment.trim() === '' || busy}>Add comment</button>
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

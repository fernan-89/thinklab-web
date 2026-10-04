import { useState, type FormEvent } from 'react';
import { ProblemError } from '../api/client';
import { INCIDENT_ACTIONS, incidentApi, type IncidentAction } from '../api/services';
import {
  INCIDENT_LEVELS, INCIDENT_PRIORITIES, INCIDENT_STATUSES,
  type AuditEntry, type Incident, type IncidentImpact, type IncidentPriority, type IncidentSla, type IncidentStatus,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (value: string) => UUID.test(value);
const short = (id: string) => id.slice(0, 8);
const OPEN: IncidentStatus[] = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ON_HOLD'];

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** Ids typed or pasted as a list (spaces, commas, new lines); anything that is not an id is reported by name. */
export function parseIds(text: string): { ids?: string[]; error?: string } {
  const ids = text.split(/[\s,;]+/).filter(Boolean);
  const bad = ids.find((id) => !isId(id));
  return bad ? { error: `"${bad}" is not an id.` } : { ids };
}

/** The ITIL matrix the service uses (ADR-030), only to preview the priority while the form is filled in: the service derives the real one. */
export function previewPriority(impact: IncidentImpact, urgency: IncidentImpact): IncidentPriority {
  const score = INCIDENT_LEVELS.indexOf(impact) + INCIDENT_LEVELS.indexOf(urgency);
  return (['P4', 'P4', 'P3', 'P2', 'P1'] as IncidentPriority[])[score];
}

function Sla({ label, sla }: { label: string; sla?: IncidentSla }) {
  if (!sla) return null;
  return <span className="sla" title={`${label} due ${new Date(sla.dueAt).toLocaleString()}`}>{label} <StatusBadge status={sla.state} /></span>;
}

export function IncidentsPage() {
  const { api, session } = useSession();
  const incidents = incidentApi(api);
  const me = session?.executor ?? '';
  const [status, setStatus] = useState<IncidentStatus | ''>('');
  const [priority, setPriority] = useState<IncidentPriority | ''>('');
  const [openOnly, setOpenOnly] = useState(true);
  const [mine, setMine] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const list = useAsync(
    () => incidents.list({ status: status || undefined, priority: priority || undefined, openOnly: openOnly && status === '', assigneeId: mine && isId(me) ? me : undefined }),
    [status, priority, openOnly, mine, me],
  );

  return (
    <section>
      <div className="page-head">
        <h1>Incidents</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New incident</button>
      </div>
      <p className="muted">Something is broken or degraded. Priority comes from impact and urgency, and each incident runs against response and resolution targets.</p>
      {creating && (
        <NewIncidentForm
          me={me}
          onCancel={() => setCreating(false)}
          onCreated={(incident) => { setCreating(false); setSelectedId(incident.id); list.reload(); }}
        />
      )}
      <div className="filters">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus | '')}>
          <option value="">All statuses</option>
          {INCIDENT_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as IncidentPriority | '')}>
          <option value="">All priorities</option>
          {INCIDENT_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={openOnly && status === ''} disabled={status !== ''} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only</label>
        <label className="check"><input type="checkbox" checked={mine} disabled={!isId(me)} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No incidents match.</Empty> : (
          <table>
            <thead><tr><th>Incident</th><th>Priority</th><th>Status</th><th>SLA</th><th>Assignee</th><th>Opened</th></tr></thead>
            <tbody>
              {list.data?.map((incident) => (
                <tr key={incident.id} className={incident.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(incident.id)}>{incident.title}</button></td>
                  <td><StatusBadge status={incident.priority} /></td>
                  <td><StatusBadge status={incident.status} /></td>
                  <td><Sla label="Response" sla={incident.response} /> <Sla label="Resolution" sla={incident.resolution} /></td>
                  <td>{incident.assigneeId ? <code>{short(incident.assigneeId)}</code> : <span className="muted">unassigned</span>}</td>
                  <td>{new Date(incident.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <IncidentDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={list.reload} />}
      </div>
    </section>
  );
}

function NewIncidentForm({ me, onCreated, onCancel }: { me: string; onCreated: (incident: Incident) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState<IncidentImpact>('MEDIUM');
  const [urgency, setUrgency] = useState<IncidentImpact>('MEDIUM');
  const [assets, setAssets] = useState('');
  const [requester, setRequester] = useState(isId(me) ? me : '');
  const [localError, setLocalError] = useState<string>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = title.trim() !== '' && description.trim() !== '' && isId(requester.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseIds(assets);
    setLocalError(parsed.error);
    if (!ready || !parsed.ids) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await incidentApi(api).create({
        title: title.trim(), description: description.trim(), impact, urgency, affectedAssetIds: parsed.ids, requesterId: requester.trim(),
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New incident" onSubmit={submit}>
      <h2>New incident</h2>
      <label>Title<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Description (no personal data)<textarea value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Impact
        <select value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)}>{INCIDENT_LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>Urgency
        <select value={urgency} onChange={(e) => setUrgency(e.target.value as IncidentImpact)}>{INCIDENT_LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <p className="muted" role="status">Priority will be <strong>{previewPriority(impact, urgency)}</strong> (derived from impact and urgency).</p>
      <label>Affected asset ids (optional, separate with spaces or commas)<textarea value={assets} onChange={(e) => setAssets(e.target.value)} /></label>
      <label>Reported by (user id)<input value={requester} onChange={(e) => setRequester(e.target.value)} /></label>
      {localError && <p className="field-error" role="alert">{localError}</p>}
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Opening...' : 'Open incident'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

type Pending = 'hold' | 'resolve' | 'reopen' | 'priority' | undefined;

function IncidentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const incidents = incidentApi(api);
  const detail = useAsync<{ incident: Incident; trail: AuditEntry[] | undefined }>(async () => {
    const incident = await incidents.retrieve(id);
    // The audit trail is a staff view: a requester is refused (403) and simply does not get the section.
    const trail = await incidents.auditLog(id).catch((failure: unknown) => {
      if (failure instanceof ProblemError && failure.status === 403) return undefined;
      throw failure;
    });
    return { incident, trail };
  }, [id]);
  const [pending, setPending] = useState<Pending>();
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [impact, setImpact] = useState<IncidentImpact>('MEDIUM');
  const [urgency, setUrgency] = useState<IncidentImpact>('MEDIUM');
  const [assignee, setAssignee] = useState('');
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const incident = detail.data?.incident;
  const isOpen = incident !== undefined && OPEN.includes(incident.status);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      setPending(undefined);
      setReason('');
      setCode('');
      setNotes('');
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
    if (next === 'priority' && incident) {
      setImpact(incident.impact);
      setUrgency(incident.urgency);
    }
  }

  function submitPending(event: FormEvent) {
    event.preventDefault();
    if (!incident) return;
    if (pending === 'hold') void run(() => incidents.hold(id, reason.trim()));
    else if (pending === 'reopen') void run(() => incidents.reopen(id, reason.trim()));
    else if (pending === 'resolve') void run(() => incidents.resolve(id, code.trim(), notes.trim()));
    else if (pending === 'priority') {
      void run(() => incidents.update(id, {
        title: incident.title, description: incident.description, impact, urgency,
        affectedAssetIds: incident.affectedAssetIds, relatedChangeIds: incident.relatedChangeIds,
      }));
    }
  }

  const pendingReady = pending === 'resolve' ? code.trim() !== '' && notes.trim() !== '' : pending === 'priority' ? true : reason.trim() !== '';

  return (
    <aside className="detail" aria-label="Incident detail">
      <div className="detail-head">
        <h2>{incident?.title ?? 'Incident'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={detail.error ?? actionError} />
      {incident && (
        <>
          <p>
            <StatusBadge status={incident.priority} /> <StatusBadge status={incident.status} />
            {incident.reopenCount > 0 && <span className="muted"> reopened {incident.reopenCount} time{incident.reopenCount === 1 ? '' : 's'}</span>}
          </p>
          <p><Sla label="Response" sla={incident.response} /> <Sla label="Resolution" sla={incident.resolution} /></p>
          <p>{incident.description}</p>
          <dl>
            <dt>Impact / urgency</dt><dd>{incident.impact} / {incident.urgency}</dd>
            <dt>Reported by</dt><dd><code>{short(incident.requesterId)}</code></dd>
            <dt>Assignee</dt><dd>{incident.assigneeId ? <code>{short(incident.assigneeId)}</code> : 'unassigned'}</dd>
            <dt>Affected assets</dt><dd>{incident.affectedAssetIds.length === 0 ? 'none' : incident.affectedAssetIds.map((asset) => <code key={asset}>{short(asset)} </code>)}</dd>
            {incident.holdReason && <><dt>On hold because</dt><dd>{incident.holdReason}</dd></>}
            {incident.resolutionCode && <><dt>Resolution</dt><dd><code>{incident.resolutionCode}</code> - {incident.resolutionNotes}</dd></>}
          </dl>

          <div className="actions" aria-label="Actions">
            {INCIDENT_ACTIONS[incident.status].map(({ action, label }) => (
              <button key={action} type="button" disabled={busy} onClick={() => void run(() => incidents.control(id, action as IncidentAction))}>{label}</button>
            ))}
            {incident.status === 'IN_PROGRESS' && <button type="button" disabled={busy} onClick={() => begin('hold')}>Put on hold</button>}
            {(incident.status === 'ACKNOWLEDGED' || incident.status === 'IN_PROGRESS') && <button type="button" disabled={busy} onClick={() => begin('resolve')}>Resolve</button>}
            {incident.status === 'RESOLVED' && <button type="button" disabled={busy} onClick={() => begin('reopen')}>Reopen</button>}
            {isOpen && <button type="button" disabled={busy} onClick={() => begin('priority')}>Change impact or urgency</button>}
          </div>

          {pending && (
            <form className="form" aria-label="Incident action" onSubmit={submitPending}>
              {(pending === 'hold' || pending === 'reopen') && (
                <label>{pending === 'hold' ? 'Why is it on hold?' : 'Why is it reopened?'}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
              )}
              {pending === 'resolve' && (
                <>
                  <label>Resolution code<input value={code} maxLength={100} onChange={(e) => setCode(e.target.value)} /></label>
                  <label>Resolution notes<textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} /></label>
                </>
              )}
              {pending === 'priority' && (
                <>
                  <label>Impact<select value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)}>{INCIDENT_LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
                  <label>Urgency<select value={urgency} onChange={(e) => setUrgency(e.target.value as IncidentImpact)}>{INCIDENT_LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
                  <p className="muted" role="status">Priority would become <strong>{previewPriority(impact, urgency)}</strong>.</p>
                </>
              )}
              <div className="actions">
                <button type="submit" className="primary" disabled={!pendingReady || busy}>Apply</button>
                <button type="button" onClick={() => setPending(undefined)}>Never mind</button>
              </div>
            </form>
          )}

          {isOpen && (
            <form className="form" aria-label="Assign" onSubmit={(e) => { e.preventDefault(); if (isId(assignee.trim())) void run(() => incidents.assign(id, assignee.trim())); }}>
              <label>Assignee (user id)<input value={assignee} onChange={(e) => setAssignee(e.target.value)} /></label>
              <button type="submit" disabled={!isId(assignee.trim()) || busy}>Assign</button>
            </form>
          )}

          <h3>Comments</h3>
          {incident.comments.length === 0 ? <Empty>No comments yet.</Empty> : (
            <ul>
              {incident.comments.map((entry) => (
                <li key={entry.commentId}>
                  {entry.internal && <span className="badge badge-on_hold">internal</span>} {entry.text}
                  <div className="muted small">{short(entry.author)} - {new Date(entry.createdAt).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
          {incident.status !== 'CLOSED' && incident.status !== 'CANCELLED' && (
            <form className="form" aria-label="Add comment" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) void run(() => incidents.comment(id, comment.trim(), internal)); }}>
              <label>Comment (no personal data)<textarea value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} /></label>
              <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (staff only)</label>
              <button type="submit" disabled={comment.trim() === '' || busy}>Add comment</button>
            </form>
          )}

          {detail.data?.trail && (
            <>
              <h3>History</h3>
              <ol className="audit">
                {detail.data.trail.map((entry) => (
                  <li key={`${entry.occurredAt}-${entry.action}`}>
                    <strong>{entry.action}</strong> by {entry.executor}
                    <div className="muted small">{new Date(entry.occurredAt).toLocaleString()}{entry.detail ? ` - ${entry.detail}` : ''}</div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </aside>
  );
}

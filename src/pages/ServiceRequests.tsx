import { useState, type FormEvent } from 'react';
import { ProblemError } from '../api/client';
import { REQUEST_ACTIONS, serviceRequestApi, type CatalogItemInput, type RequestAction } from '../api/services';
import {
  CATALOG_STATUSES, REQUEST_STATUSES,
  type AuditEntry, type CatalogField, type CatalogItem, type CatalogItemStatus, type RequestSla, type RequestStatus, type ServiceRequest,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (value: string) => UUID.test(value);
const short = (id: string) => id.slice(0, 8);
const OPEN: RequestStatus[] = ['SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'IN_FULFILMENT'];

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/**
 * The questions of an item typed one per line as {@code key | label | required}; the third part is optional ("required" or "optional",
 * optional by default). Anything the service would refuse is reported here by line.
 */
export function parseFields(text: string): { fields?: CatalogField[]; error?: string } {
  const fields: CatalogField[] = [];
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const [key = '', label = '', flag = ''] = line.split('|').map((part) => part.trim());
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) return { error: `Line ${index + 1}: a key is a letter followed by up to 39 letters, digits or underscores.` };
    if (label === '') return { error: `Line ${index + 1}: a question needs a label.` };
    if (fields.some((field) => field.key === key)) return { error: `Line ${index + 1}: the key "${key}" is already used.` };
    fields.push({ key, label, required: flag.toLowerCase() === 'required' });
  }
  return { fields };
}

export const fieldsToText = (fields: CatalogField[]) => fields.map((field) => `${field.key} | ${field.label} | ${field.required ? 'required' : 'optional'}`).join('\n');

function Sla({ sla }: { sla?: RequestSla }) {
  if (!sla) return null;
  return <span className="sla" title={`Fulfilment due ${new Date(sla.dueAt).toLocaleString()}`}>Fulfilment <StatusBadge status={sla.state} /></span>;
}

type Tab = 'requests' | 'catalog';

export function ServiceRequestsPage() {
  const [tab, setTab] = useState<Tab>('requests');
  return (
    <section>
      <div className="page-head">
        <h1>Service requests</h1>
      </div>
      <div className="tabs" role="tablist" aria-label="Service requests">
        <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'primary' : undefined} onClick={() => setTab('requests')}>Requests</button>
        <button type="button" role="tab" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'primary' : undefined} onClick={() => setTab('catalog')}>Catalog</button>
      </div>
      {tab === 'requests' ? <RequestsTab /> : <CatalogTab />}
    </section>
  );
}

// ---------------------------------------------------------------- requests

function RequestsTab() {
  const { api, session } = useSession();
  const requests = serviceRequestApi(api);
  const me = session?.executor ?? '';
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const [openOnly, setOpenOnly] = useState(true);
  const [mine, setMine] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const list = useAsync(
    () => requests.list({ status: status || undefined, openOnly: openOnly && status === '', assigneeId: mine && isId(me) ? me : undefined }),
    [status, openOnly, mine, me],
  );

  return (
    <>
      <div className="page-head">
        <p className="muted">Something a person asks IT for from the catalog. Each one runs against a fulfilment target; some wait for approval first.</p>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New request</button>
      </div>
      {creating && (
        <NewRequestForm
          me={me}
          onCancel={() => setCreating(false)}
          onCreated={(request) => { setCreating(false); setSelectedId(request.id); list.reload(); }}
        />
      )}
      <div className="filters">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | '')}>
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={openOnly && status === ''} disabled={status !== ''} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only</label>
        <label className="check"><input type="checkbox" checked={mine} disabled={!isId(me)} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No requests match.</Empty> : (
          <table>
            <thead><tr><th>Request</th><th>Status</th><th>SLA</th><th>Assignee</th><th>Opened</th></tr></thead>
            <tbody>
              {list.data?.map((request) => (
                <tr key={request.id} className={request.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(request.id)}>{request.catalogItemName}</button> <code>{request.catalogItemCode}</code></td>
                  <td><StatusBadge status={request.status} /></td>
                  <td><Sla sla={request.fulfilment} /></td>
                  <td>{request.assigneeId ? <code>{short(request.assigneeId)}</code> : <span className="muted">unassigned</span>}</td>
                  <td>{new Date(request.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <RequestDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={list.reload} />}
      </div>
    </>
  );
}

function NewRequestForm({ me, onCreated, onCancel }: { me: string; onCreated: (request: ServiceRequest) => void; onCancel: () => void }) {
  const { api } = useSession();
  const requests = serviceRequestApi(api);
  const catalog = useAsync(() => requests.catalog.list('PUBLISHED'), []);
  const [itemId, setItemId] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [requester, setRequester] = useState(isId(me) ? me : '');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const item = catalog.data?.find((candidate) => candidate.id === itemId);
  const missing = item?.fields.some((field) => field.required && (answers[field.key] ?? '').trim() === '') ?? true;
  const ready = item !== undefined && !missing && isId(requester.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!item || !ready) return;
    const given = Object.fromEntries(Object.entries(answers).filter(([key, value]) => value.trim() !== '' && item.fields.some((field) => field.key === key)).map(([key, value]) => [key, value.trim()]));
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await requests.create({ catalogItemId: item.id, answers: given, requesterId: requester.trim() }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New request" onSubmit={submit}>
      <h2>New request</h2>
      <ProblemBanner error={catalog.error} />
      <label>What do you need?
        <select value={itemId} onChange={(e) => { setItemId(e.target.value); setAnswers({}); }}>
          <option value="">Choose from the catalog...</option>
          {catalog.data?.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      {item && (
        <>
          <p className="muted">
            Target {item.fulfilmentTargetHours} h{item.approvalPolicyId ? '; it needs approval first.' : '; no approval needed.'}
            {item.description ? ` ${item.description}` : ''}
          </p>
          {item.fields.map((field) => (
            <label key={field.key}>{field.label}{field.required ? '' : ' (optional)'}
              <input value={answers[field.key] ?? ''} maxLength={500} onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.value })} />
            </label>
          ))}
        </>
      )}
      <label>For (user id)<input value={requester} onChange={(e) => setRequester(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Sending...' : 'Send request'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

type Pending = 'fulfil' | 'approve' | 'reject' | 'return' | undefined;

function RequestDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const requests = serviceRequestApi(api);
  const detail = useAsync<{ request: ServiceRequest; trail: AuditEntry[] | undefined }>(async () => {
    const request = await requests.retrieve(id);
    // The audit trail is a staff view: a requester is refused (403) and simply does not get the section.
    const trail = await requests.auditLog(id).catch((failure: unknown) => {
      if (failure instanceof ProblemError && failure.status === 403) return undefined;
      throw failure;
    });
    return { request, trail };
  }, [id]);
  const [pending, setPending] = useState<Pending>();
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState('');
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);

  const request = detail.data?.request;

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

  function submitPending(event: FormEvent) {
    event.preventDefault();
    if (pending === 'fulfil') void run(() => requests.fulfil(id, text.trim()));
    else if (pending === 'approve') void run(() => requests.decide(id, 'APPROVE', text.trim()));
    else if (pending === 'reject') void run(() => requests.decide(id, 'REJECT', text.trim()));
    else if (pending === 'return') void run(() => requests.decide(id, 'RETURN', text.trim()));
  }

  return (
    <aside className="detail" aria-label="Request detail">
      <div className="detail-head">
        <h2>{request?.catalogItemName ?? 'Request'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={detail.error ?? actionError} />
      {request && (
        <>
          <p><StatusBadge status={request.status} /> <Sla sla={request.fulfilment} /></p>
          {request.status === 'RETURNED' && request.returnReason && (
            <div className="banner" role="status"><strong>Sent back for changes:</strong> {request.returnReason}</div>
          )}
          <dl>
            <dt>Item</dt><dd><code>{request.catalogItemCode}</code></dd>
            <dt>For</dt><dd><code>{short(request.requesterId)}</code></dd>
            <dt>Assignee</dt><dd>{request.assigneeId ? <code>{short(request.assigneeId)}</code> : 'unassigned'}</dd>
            {Object.entries(request.answers).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
            {request.fulfilmentNotes && <><dt>Delivered</dt><dd>{request.fulfilmentNotes}</dd></>}
          </dl>

          <div className="actions" aria-label="Actions">
            {request.status === 'PENDING_APPROVAL' && (
              <>
                <button type="button" disabled={busy} onClick={() => setPending('approve')}>Approve</button>
                <button type="button" disabled={busy} onClick={() => setPending('reject')}>Reject</button>
                <button type="button" disabled={busy} onClick={() => setPending('return')}>Return for changes</button>
              </>
            )}
            {REQUEST_ACTIONS[request.status].map(({ action, label }) => (
              <button key={action} type="button" disabled={busy} onClick={() => void run(() => requests.control(id, action as RequestAction))}>{label}</button>
            ))}
            {request.status === 'IN_FULFILMENT' && <button type="button" disabled={busy} onClick={() => setPending('fulfil')}>Fulfil</button>}
            {request.status === 'RETURNED' && <button type="button" disabled={busy} onClick={() => setResubmitting(true)}>Edit and resubmit</button>}
          </div>

          {resubmitting && request.status === 'RETURNED' && (
            <ResubmitForm
              request={request}
              onCancel={() => setResubmitting(false)}
              onDone={() => { setResubmitting(false); detail.reload(); onChanged(); }}
            />
          )}

          {pending && (
            <form className="form" aria-label="Request action" onSubmit={submitPending}>
              <label>{pending === 'fulfil' ? 'What was delivered?' : pending === 'return' ? 'What should the requester fix?' : 'Comment (optional)'}
                <textarea value={text} maxLength={pending === 'fulfil' ? 4000 : 500} onChange={(e) => setText(e.target.value)} />
              </label>
              <div className="actions">
                <button type="submit" className="primary" disabled={busy || ((pending === 'fulfil' || pending === 'return') && text.trim() === '')}>
                  {pending === 'fulfil' ? 'Fulfil' : pending === 'approve' ? 'Approve' : pending === 'return' ? 'Return' : 'Reject'}
                </button>
                <button type="button" onClick={() => setPending(undefined)}>Never mind</button>
              </div>
            </form>
          )}

          {OPEN.includes(request.status) && (
            <form className="form" aria-label="Assign" onSubmit={(e) => { e.preventDefault(); if (isId(assignee.trim())) void run(() => requests.assign(id, assignee.trim())); }}>
              <label>Assignee (user id)<input value={assignee} onChange={(e) => setAssignee(e.target.value)} /></label>
              <button type="submit" disabled={!isId(assignee.trim()) || busy}>Assign</button>
            </form>
          )}

          <h3>Comments</h3>
          {request.comments.length === 0 ? <Empty>No comments yet.</Empty> : (
            <ul>
              {request.comments.map((entry) => (
                <li key={entry.commentId}>
                  {entry.internal && <span className="badge badge-on_hold">internal</span>} {entry.text}
                  <div className="muted small">{short(entry.author)} - {new Date(entry.createdAt).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
          {request.status !== 'CLOSED' && request.status !== 'CANCELLED' && request.status !== 'REJECTED' && (
            <form className="form" aria-label="Add comment" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) void run(() => requests.comment(id, comment.trim(), internal)); }}>
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

// ---------------------------------------------------------------- catalog

function CatalogTab() {
  const { api } = useSession();
  const requests = serviceRequestApi(api);
  const [status, setStatus] = useState<CatalogItemStatus | ''>('');
  const [editing, setEditing] = useState<CatalogItem | 'new'>();
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const list = useAsync(() => requests.catalog.list(status || undefined), [status]);

  async function control(item: CatalogItem, action: 'publish' | 'retire') {
    setBusy(true);
    setActionError(undefined);
    try {
      await requests.catalog.control(item.id, action);
      list.reload();
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <p className="muted">What can be asked for. An item is editable while it is a draft; once published it is a promise, and retiring it stops new requests only.</p>
        <button type="button" className="primary" onClick={() => setEditing('new')} disabled={editing !== undefined}>New catalog item</button>
      </div>
      {editing && (
        <CatalogForm
          item={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); list.reload(); }}
        />
      )}
      <div className="filters">
        <select aria-label="Catalog status" value={status} onChange={(e) => setStatus(e.target.value as CatalogItemStatus | '')}>
          <option value="">All statuses</option>
          {CATALOG_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error ?? actionError} />
      {list.data?.length === 0 && !list.loading ? <Empty>The catalog is empty.</Empty> : (
        <table>
          <thead><tr><th>Item</th><th>Code</th><th>Status</th><th>Target</th><th>Approval</th><th /></tr></thead>
          <tbody>
            {list.data?.map((item) => (
              <tr key={item.id}>
                <td>{item.name}{item.category ? <span className="muted"> - {item.category}</span> : null}</td>
                <td><code>{item.code}</code></td>
                <td><StatusBadge status={item.status} /></td>
                <td>{item.fulfilmentTargetHours} h</td>
                <td>{item.approvalPolicyId ? <code>{short(item.approvalPolicyId)}</code> : <span className="muted">none</span>}</td>
                <td className="actions">
                  {item.status === 'DRAFT' && <button type="button" disabled={busy || editing !== undefined} onClick={() => setEditing(item)}>Edit {item.code}</button>}
                  {item.status === 'DRAFT' && <button type="button" disabled={busy} onClick={() => void control(item, 'publish')}>Publish {item.code}</button>}
                  {item.status === 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => void control(item, 'retire')}>Retire {item.code}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CatalogForm({ item, onSaved, onCancel }: { item?: CatalogItem; onSaved: () => void; onCancel: () => void }) {
  const { api } = useSession();
  const requests = serviceRequestApi(api);
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [hours, setHours] = useState(String(item?.fulfilmentTargetHours ?? 72));
  const [policy, setPolicy] = useState(item?.approvalPolicyId ?? '');
  const [fields, setFields] = useState(item ? fieldsToText(item.fields) : '');
  const [localError, setLocalError] = useState<string>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const target = Number(hours);
  const ready = name.trim() !== '' && (item !== undefined || /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(code.trim()))
    && Number.isInteger(target) && target >= 1 && target <= 2160 && (policy.trim() === '' || isId(policy.trim()));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseFields(fields);
    setLocalError(parsed.error);
    if (!ready || !parsed.fields) return;
    const body: CatalogItemInput = {
      name: name.trim(), description: description.trim() || undefined, category: category.trim() || undefined,
      fields: parsed.fields, fulfilmentTargetHours: target, approvalPolicyId: policy.trim() || undefined,
    };
    setBusy(true);
    setError(undefined);
    try {
      if (item) await requests.catalog.update(item.id, body);
      else await requests.catalog.create({ ...body, code: code.trim() });
      onSaved();
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={item ? 'Edit catalog item' : 'New catalog item'} onSubmit={submit}>
      <h2>{item ? `Edit ${item.code}` : 'New catalog item'}</h2>
      {!item && <label>Code (letters, digits, dashes)<input value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} /></label>}
      <label>Name<input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></label>
      <label>Description<textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Category<input value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} /></label>
      <label>Fulfilment target (hours, 1 to 2160)<input value={hours} inputMode="numeric" onChange={(e) => setHours(e.target.value)} /></label>
      <label>Approval policy id (optional, from workflow-approval)<input value={policy} onChange={(e) => setPolicy(e.target.value)} /></label>
      <label>Questions (one per line: key | label | required or optional)<textarea value={fields} onChange={(e) => setFields(e.target.value)} /></label>
      {localError && <p className="field-error" role="alert">{localError}</p>}
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Save'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** A returned request: the questions of its item, answered again (starting from what was said before), then a new approval starts. */
function ResubmitForm({ request, onDone, onCancel }: { request: ServiceRequest; onDone: () => void; onCancel: () => void }) {
  const { api } = useSession();
  const requests = serviceRequestApi(api);
  const item = useAsync(() => requests.catalog.retrieve(request.catalogItemId), [request.catalogItemId]);
  const [answers, setAnswers] = useState<Record<string, string>>(request.answers);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const fields = item.data?.fields ?? [];
  const missing = fields.some((field) => field.required && (answers[field.key] ?? '').trim() === '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!item.data || missing) return;
    const given = Object.fromEntries(Object.entries(answers).filter(([key, value]) => value.trim() !== '' && fields.some((field) => field.key === key)).map(([key, value]) => [key, value.trim()]));
    setBusy(true);
    setError(undefined);
    try {
      await requests.resubmit(request.id, given);
      onDone();
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" aria-label="Resubmit request" onSubmit={submit}>
      <ProblemBanner error={item.error ?? error} />
      {fields.map((field) => (
        <label key={field.key}>{field.label}{field.required ? '' : ' (optional)'}
          <input value={answers[field.key] ?? ''} maxLength={500} onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.value })} />
        </label>
      ))}
      <p className="muted">Resubmitting starts the approval again from the first stage.</p>
      <div className="actions">
        <button type="submit" className="primary" disabled={!item.data || missing || busy}>{busy ? 'Sending...' : 'Resubmit'}</button>
        <button type="button" onClick={onCancel}>Never mind</button>
      </div>
    </form>
  );
}

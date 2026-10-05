import { useState, type FormEvent } from 'react';
import { connectorApi } from '../api/services';
import {
  CONNECTION_PROVIDERS, LINK_STATUSES, LINK_SUBJECT_TYPES, type AuditEntry, type Connection, type ConnectionCheck, type ConnectionProvider, type LinkStatus,
  type LinkSubjectType, type TicketLink,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { isId } from './Incidents';

const short = (id: string) => id.slice(0, 8);

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** The ticket address comes from the provider: only an http(s) one becomes a link. */
const isWebUrl = (value: string | undefined): value is string => value !== undefined && /^https?:\/\//i.test(value);

export function IntegrationsPage() {
  const { api } = useSession();
  const connector = connectorApi(api);
  const connections = useAsync(() => connector.connections(), []);

  return (
    <section>
      <div className="page-head"><h1>Integrations</h1></div>
      <p className="muted">
        Link incidents, requests and problems to tickets in ServiceNow or Jira. Status and public comments flow both ways; the platform stays the
        system of record, so a change it refuses is recorded and never forced.
      </p>
      <ConnectionsPanel connections={connections.data ?? []} loading={connections.loading} error={connections.error} onChanged={connections.reload} />
      <LinksPanel connections={connections.data ?? []} />
    </section>
  );
}

function ConnectionsPanel({ connections, loading, error, onChanged }: { connections: Connection[]; loading: boolean; error: Error | undefined; onChanged: () => void }) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();

  return (
    <>
      <div className="page-head">
        <h2>Connections</h2>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New connection</button>
      </div>
      {creating && (
        <NewConnectionForm
          onCancel={() => setCreating(false)}
          onCreated={(connection) => { setCreating(false); setSelectedId(connection.id); onChanged(); }}
        />
      )}
      <ProblemBanner error={error} />
      <div className="split">
        {connections.length === 0 && !loading ? <Empty>No connections yet.</Empty> : (
          <table aria-label="Connections">
            <thead><tr><th>Name</th><th>Provider</th><th>Address</th><th>Credentials</th><th>Status</th></tr></thead>
            <tbody>
              {connections.map((connection) => (
                <tr key={connection.id} className={connection.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(connection.id)}>{connection.name}</button></td>
                  <td>{connection.provider}</td>
                  <td>{connection.baseUrl}</td>
                  <td>{connection.secretConfigured ? <span className="badge badge-ok">set</span> : <span className="badge badge-failed">not set</span>}</td>
                  <td><StatusBadge status={connection.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && (
          <ConnectionDetail key={selectedId} connection={connections.find((c) => c.id === selectedId)} onClose={() => setSelectedId(undefined)} onChanged={onChanged} />
        )}
      </div>
    </>
  );
}

function NewConnectionForm({ onCreated, onCancel }: { onCreated: (connection: Connection) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<ConnectionProvider>('JIRA');
  const [baseUrl, setBaseUrl] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [webhookSecretRef, setWebhookSecretRef] = useState('');
  const [integrationActor, setIntegrationActor] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = [name, baseUrl, secretRef, webhookSecretRef, integrationActor].every((v) => v.trim() !== '') && (provider !== 'JIRA' || projectKey.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await connectorApi(api).createConnection({
        name: name.trim(), provider, baseUrl: baseUrl.trim(), secretRef: secretRef.trim(), webhookSecretRef: webhookSecretRef.trim(),
        integrationActor: integrationActor.trim(), projectKey: provider === 'JIRA' ? projectKey.trim() : undefined,
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New connection" onSubmit={submit}>
      <h2>New connection</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Provider
        <select value={provider} onChange={(e) => setProvider(e.target.value as ConnectionProvider)}>{CONNECTION_PROVIDERS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>Address (https)<input value={baseUrl} maxLength={300} placeholder="https://acme.atlassian.net" onChange={(e) => setBaseUrl(e.target.value)} /></label>
      {provider === 'JIRA' && <label>Project key<input value={projectKey} maxLength={20} placeholder="ITSM" onChange={(e) => setProjectKey(e.target.value.toUpperCase())} /></label>}
      <p className="muted small">Secrets are never typed here: name the environment variables that hold them on the server.</p>
      <label>Credentials variable (holds the whole Authorization header value)
        <input value={secretRef} placeholder="JIRA_AUTH" onChange={(e) => setSecretRef(e.target.value)} />
      </label>
      <label>Webhook token variable<input value={webhookSecretRef} placeholder="JIRA_HOOK" onChange={(e) => setWebhookSecretRef(e.target.value)} /></label>
      <label>Integration account (the account the credentials act as)<input value={integrationActor} maxLength={200} onChange={(e) => setIntegrationActor(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Register connection'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ConnectionDetail({ connection, onClose, onChanged }: { connection: Connection | undefined; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const connector = connectorApi(api);
  const id = connection?.id;
  const trail = useAsync<AuditEntry[]>(async () => (id ? connector.connectionAuditLog(id) : []), [id, connection?.status]);
  const [check, setCheck] = useState<ConnectionCheck>();
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      onChanged();
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="detail" aria-label="Connection detail">
      <div className="detail-head">
        <h2>{connection?.name ?? 'Connection'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? trail.error} />
      {connection && (
        <>
          <p><StatusBadge status={connection.status} /> {connection.provider}{connection.projectKey ? ` / ${connection.projectKey}` : ''}</p>
          <dl>
            <dt>Address</dt><dd>{connection.baseUrl}</dd>
            <dt>Credentials variable</dt><dd><code>{connection.secretRef}</code> {connection.secretConfigured ? 'is set' : <strong>is not set on the server</strong>}</dd>
            <dt>Webhook token variable</dt><dd><code>{connection.webhookSecretRef}</code> {connection.webhookSecretConfigured ? 'is set' : <strong>is not set on the server</strong>}</dd>
            <dt>Integration account</dt><dd>{connection.integrationActor}</dd>
          </dl>
          <div className="actions" aria-label="Actions">
            <button type="button" disabled={busy} onClick={() => void run(async () => setCheck(await connector.checkConnection(connection.id)))}>Check connection</button>
            {connection.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => connector.switchConnection(connection.id, 'disable'))}>Disable</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => connector.switchConnection(connection.id, 'enable'))}>Enable</button>}
          </div>
          {check && (
            <p role="status">
              {check.reachable ? 'The provider answers with these credentials.' : `Not reachable${check.problem ? `: ${check.problem}` : '.'}`}
            </p>
          )}
          <h3>History</h3>
          <ol className="audit">
            {trail.data?.map((entry) => (
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

function LinksPanel({ connections }: { connections: Connection[] }) {
  const { api } = useSession();
  const connector = connectorApi(api);
  const [connectionId, setConnectionId] = useState('');
  const [status, setStatus] = useState<LinkStatus | ''>('');
  const [linking, setLinking] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const list = useAsync(
    () => connector.links({ connectionId: connectionId || undefined, status: status || undefined }),
    [connectionId, status],
  );
  const names = new Map(connections.map((c) => [c.id, c.name]));

  return (
    <>
      <div className="page-head">
        <h2>Linked tickets</h2>
        <button type="button" className="primary" onClick={() => setLinking(true)} disabled={linking || connections.length === 0}>Link an item</button>
      </div>
      {linking && (
        <LinkForm
          connections={connections.filter((c) => c.status === 'ACTIVE')}
          onCancel={() => setLinking(false)}
          onDone={() => { setLinking(false); list.reload(); }}
          onAttempted={list.reload}
        />
      )}
      <div className="filters">
        <select aria-label="Connection" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
          <option value="">All connections</option>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Link status" value={status} onChange={(e) => setStatus(e.target.value as LinkStatus | '')}>
          <option value="">All statuses</option>
          {LINK_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No linked tickets match.</Empty> : (
          <table aria-label="Linked tickets">
            <thead><tr><th>Item</th><th>Connection</th><th>Ticket</th><th>Status</th><th>Last sync</th></tr></thead>
            <tbody>
              {list.data?.map((link) => (
                <tr key={link.id} className={link.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(link.id)}>{link.subjectType.replace('_', ' ')} {short(link.subjectId)}</button></td>
                  <td>{names.get(link.connectionId) ?? short(link.connectionId)}</td>
                  <td>{link.externalId ? (isWebUrl(link.externalUrl) ? <a href={link.externalUrl} target="_blank" rel="noreferrer noopener">{link.externalId}</a> : link.externalId) : <span className="muted">none yet</span>}</td>
                  <td><StatusBadge status={link.status} /></td>
                  <td>{link.lastSyncedAt ? `${new Date(link.lastSyncedAt).toLocaleString()} (${link.lastDirection === 'INBOUND' ? 'from provider' : 'to provider'})` : <span className="muted">never</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <LinkDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={list.reload} />}
      </div>
    </>
  );
}

function LinkForm({ connections, onDone, onAttempted, onCancel }: { connections: Connection[]; onDone: () => void; onAttempted: () => void; onCancel: () => void }) {
  const { api } = useSession();
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');
  const [subjectType, setSubjectType] = useState<LinkSubjectType>('INCIDENT');
  const [subjectId, setSubjectId] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = connectionId !== '' && isId(subjectId.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await connectorApi(api).link({ connectionId, subjectType, subjectId: subjectId.trim() });
      onDone();
    } catch (failure) {
      // A provider that refuses still leaves the link, FAILED and retryable: show why, and refresh the list behind the message.
      setError(toError(failure));
      onAttempted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="Link an item" onSubmit={submit}>
      <h2>Link an item to a ticket</h2>
      <label>Connection
        <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>{connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      <label>Kind of item
        <select value={subjectType} onChange={(e) => setSubjectType(e.target.value as LinkSubjectType)}>{LINK_SUBJECT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>Item id<input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} /></label>
      <p className="muted small">The title and description of the item are sent to the provider: keep personal data out of them.</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Linking...' : 'Create the ticket'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function LinkDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const connector = connectorApi(api);
  const detail = useAsync<{ link: TicketLink; trail: AuditEntry[] }>(async () => {
    const [links, trail] = await Promise.all([connector.links({}), connector.linkAuditLog(id)]);
    const link = links.find((candidate) => candidate.id === id);
    if (!link) throw new Error('That link is no longer there.');
    return { link, trail };
  }, [id]);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const link = detail.data?.link;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      setConfirming(false);
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      // The link records a refusal too (FAILED, or the error on a LINKED one): always read it again.
      setBusy(false);
      detail.reload();
      onChanged();
    }
  }

  return (
    <aside className="detail" aria-label="Link detail">
      <div className="detail-head">
        <h2>{link ? `${link.subjectType.replace('_', ' ')} ${short(link.subjectId)}` : 'Link'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {link && (
        <>
          <p><StatusBadge status={link.status} /></p>
          <dl>
            <dt>Ticket</dt><dd>{link.externalId ?? <span className="muted">not created yet</span>}</dd>
            <dt>Last status pushed</dt><dd>{link.lastPushedStatus ?? <span className="muted">none</span>}</dd>
            <dt>Comments sent</dt><dd>{link.syncedComments}</dd>
            {link.lastError && <><dt>Last problem</dt><dd className="field-error">{link.lastError}</dd></>}
          </dl>
          {link.status !== 'DETACHED' && (
            <div className="actions" aria-label="Actions">
              <button type="button" disabled={busy} onClick={() => void run(() => connector.sync(id))}>{link.externalId ? 'Sync now' : 'Retry creating the ticket'}</button>
              {confirming ? (
                <>
                  <button type="button" className="danger" disabled={busy} onClick={() => void run(() => connector.detach(id))}>Detach for good</button>
                  <button type="button" onClick={() => setConfirming(false)}>Never mind</button>
                </>
              ) : <button type="button" disabled={busy} onClick={() => setConfirming(true)}>Detach</button>}
            </div>
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

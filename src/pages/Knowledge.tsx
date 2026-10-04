import { useState, type FormEvent } from 'react';
import { ProblemError } from '../api/client';
import { ARTICLE_ACTIONS, knowledgeApi, type ArticleAction, type ArticleInput } from '../api/services';
import { ARTICLE_STATUSES, ARTICLE_VISIBILITIES, type Article, type ArticleStatus, type ArticleVisibility, type AuditEntry } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { isId, parseIds } from './Incidents';

const short = (id: string) => id.slice(0, 8);

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** Keywords typed with commas or one per line; the service trims and lower-cases them, here only the empty ones are dropped. */
export function parseKeywords(text: string): string[] {
  return text.split(/[,\n]/).map((word) => word.trim()).filter(Boolean);
}

export function KnowledgePage() {
  const { api } = useSession();
  const knowledge = knowledgeApi(api);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ArticleStatus | ''>('');
  const [visibility, setVisibility] = useState<ArticleVisibility | ''>('');
  const [keyword, setKeyword] = useState('');
  const [problem, setProblem] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const text = q.trim();
  const list = useAsync(
    () => knowledge.list({
      q: text || undefined, status: status || undefined, visibility: visibility || undefined, keyword: keyword.trim() || undefined,
      problemId: isId(problem.trim()) ? problem.trim() : undefined,
    }),
    [text, status, visibility, keyword, problem],
  );

  return (
    <section>
      <div className="page-head">
        <h1>Knowledge</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New article</button>
      </div>
      <p className="muted">What IT knows, written down. An article is reviewed by somebody other than its author before it is published, and a published one changes only through a new version.</p>
      {creating && (
        <ArticleForm
          onCancel={() => setCreating(false)}
          onSaved={(article) => { setCreating(false); setSelectedId(article.id); list.reload(); }}
        />
      )}
      <div className="filters">
        <input type="search" aria-label="Search" placeholder="Search the articles" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as ArticleStatus | '')}>
          <option value="">All statuses</option>
          {ARTICLE_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as ArticleVisibility | '')}>
          <option value="">Any audience</option>
          {ARTICLE_VISIBILITIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input type="search" aria-label="Keyword" placeholder="Keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <input type="search" aria-label="About problem" placeholder="About problem (id)" value={problem} onChange={(e) => setProblem(e.target.value)} />
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No articles match.</Empty> : (
          <table>
            <thead><tr><th>Article</th><th>Status</th><th>Audience</th><th>Version</th><th>Category</th><th>Updated</th></tr></thead>
            <tbody>
              {list.data?.map((article) => (
                <tr key={article.id} className={article.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(article.id)}>{article.title}</button></td>
                  <td><StatusBadge status={article.status} /></td>
                  <td><StatusBadge status={article.visibility} /></td>
                  <td>{article.version}</td>
                  <td>{article.category ?? <span className="muted">-</span>}</td>
                  <td>{new Date(article.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <ArticleDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={list.reload} onOpen={setSelectedId} />}
      </div>
    </section>
  );
}

function ArticleForm({ article, onSaved, onCancel }: { article?: Article; onSaved: (article: Article) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [title, setTitle] = useState(article?.title ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [category, setCategory] = useState(article?.category ?? '');
  const [keywords, setKeywords] = useState((article?.keywords ?? []).join(', '));
  const [visibility, setVisibility] = useState<ArticleVisibility>(article?.visibility ?? 'PUBLIC');
  const [problems, setProblems] = useState((article?.relatedProblemIds ?? []).join(' '));
  const [incidents, setIncidents] = useState((article?.relatedIncidentIds ?? []).join(' '));
  const [localError, setLocalError] = useState<string>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = title.trim() !== '' && body.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedProblems = parseIds(problems);
    const parsedIncidents = parseIds(incidents);
    const failure = parsedProblems.error ?? parsedIncidents.error;
    setLocalError(failure);
    if (!ready || failure || !parsedProblems.ids || !parsedIncidents.ids) return;
    const input: ArticleInput = {
      title: title.trim(), body: body.trim(), category: category.trim() || undefined, keywords: parseKeywords(keywords), visibility,
      relatedProblemIds: parsedProblems.ids, relatedIncidentIds: parsedIncidents.ids,
    };
    setBusy(true);
    setError(undefined);
    try {
      const knowledge = knowledgeApi(api);
      if (article) {
        await knowledge.update(article.id, input);
        onSaved(await knowledge.retrieve(article.id));
      } else {
        onSaved(await knowledge.create(input));
      }
    } catch (failureToSave) {
      setError(toError(failureToSave));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={article ? 'Edit article' : 'New article'} onSubmit={submit}>
      <h2>{article ? 'Edit article' : 'New article'}</h2>
      <label>Title<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Text (no personal data or credentials)<textarea value={body} maxLength={20000} rows={8} onChange={(e) => setBody(e.target.value)} /></label>
      <label>Category<input value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} /></label>
      <label>Keywords (separate with commas)<input value={keywords} onChange={(e) => setKeywords(e.target.value)} /></label>
      <label>Who can read it once published
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as ArticleVisibility)}>
          <option value="PUBLIC">PUBLIC (staff and requesters)</option>
          <option value="INTERNAL">INTERNAL (staff only)</option>
        </select>
      </label>
      <label>Problems it relates to (ids, optional)<textarea value={problems} onChange={(e) => setProblems(e.target.value)} /></label>
      <label>Incidents it relates to (ids, optional)<textarea value={incidents} onChange={(e) => setIncidents(e.target.value)} /></label>
      {localError && <p className="field-error" role="alert">{localError}</p>}
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Save'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

type Pending = 'return' | 'edit' | undefined;

function ArticleDetail({ id, onClose, onChanged, onOpen }: { id: string; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const { api } = useSession();
  const knowledge = knowledgeApi(api);
  const detail = useAsync<{ article: Article; versions: Article[] | undefined; trail: AuditEntry[] | undefined }>(async () => {
    const article = await knowledge.retrieve(id);
    // The versions and the audit trail are staff views: a requester is refused (403) and simply does not get the sections.
    const staffOnly = async <T,>(call: () => Promise<T>) => call().catch((failure: unknown) => {
      if (failure instanceof ProblemError && failure.status === 403) return undefined;
      throw failure;
    });
    return { article, versions: await staffOnly(() => knowledge.versions(id)), trail: await staffOnly(() => knowledge.auditLog(id)) };
  }, [id]);
  const [pending, setPending] = useState<Pending>();
  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const article = detail.data?.article;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      setPending(undefined);
      setComment('');
      detail.reload();
      onChanged();
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function newVersion() {
    setBusy(true);
    setActionError(undefined);
    try {
      const created = await knowledge.newVersion(id);
      onChanged();
      onOpen(created.id);
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="detail" aria-label="Article detail">
      <div className="detail-head">
        <h2>{article?.title ?? 'Article'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={detail.error ?? actionError} />
      {article && (
        <>
          <p>
            <StatusBadge status={article.status} /> <StatusBadge status={article.visibility} /> <span className="muted">version {article.version}</span>
          </p>
          {article.status === 'DRAFT' && article.reviewComment && (
            <div className="banner" role="status"><strong>Sent back for changes:</strong> {article.reviewComment}</div>
          )}
          <div className="article-body">{article.body}</div>
          <dl>
            {article.category && <><dt>Category</dt><dd>{article.category}</dd></>}
            <dt>Keywords</dt><dd>{article.keywords.length === 0 ? 'none' : article.keywords.join(', ')}</dd>
            {article.authorId && <><dt>Written by</dt><dd><code>{article.authorId.length > 12 ? short(article.authorId) : article.authorId}</code></dd></>}
            {article.reviewerId && <><dt>Reviewed by</dt><dd><code>{article.reviewerId.length > 12 ? short(article.reviewerId) : article.reviewerId}</code></dd></>}
            {article.publishedAt && <><dt>Published</dt><dd>{new Date(article.publishedAt).toLocaleString()}</dd></>}
            {article.relatedProblemIds && <><dt>Problems</dt><dd>{article.relatedProblemIds.length === 0 ? 'none' : article.relatedProblemIds.map((related) => <code key={related}>{short(related)} </code>)}</dd></>}
            {article.relatedIncidentIds && <><dt>Incidents</dt><dd>{article.relatedIncidentIds.length === 0 ? 'none' : article.relatedIncidentIds.map((related) => <code key={related}>{short(related)} </code>)}</dd></>}
          </dl>

          {detail.data?.trail && (
            <>
              <div className="actions" aria-label="Actions">
                {ARTICLE_ACTIONS[article.status].map(({ action, label }) => (
                  <button key={action} type="button" disabled={busy} onClick={() => void run(() => knowledge.control(id, action as ArticleAction))}>{label}</button>
                ))}
                {article.status === 'DRAFT' && <button type="button" disabled={busy} onClick={() => setPending('edit')}>Edit</button>}
                {article.status === 'IN_REVIEW' && <button type="button" disabled={busy} onClick={() => setPending('return')}>Return for changes</button>}
                {article.status === 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => void newVersion()}>New version</button>}
              </div>

              {pending === 'edit' && (
                <ArticleForm article={article} onCancel={() => setPending(undefined)} onSaved={() => { setPending(undefined); detail.reload(); onChanged(); }} />
              )}
              {pending === 'return' && (
                <form className="form" aria-label="Return article" onSubmit={(e) => { e.preventDefault(); void run(() => knowledge.returnForChanges(id, comment.trim())); }}>
                  <label>What should the author change?<textarea value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></label>
                  <div className="actions">
                    <button type="submit" className="primary" disabled={comment.trim() === '' || busy}>Return</button>
                    <button type="button" onClick={() => setPending(undefined)}>Never mind</button>
                  </div>
                </form>
              )}
            </>
          )}

          {detail.data?.versions && detail.data.versions.length > 1 && (
            <>
              <h3>Versions</h3>
              <ul>
                {detail.data.versions.map((version) => (
                  <li key={version.id}>
                    {version.id === id ? <strong>Version {version.version}</strong> : <button type="button" className="link" onClick={() => onOpen(version.id)}>Version {version.version}</button>}
                    {' '}<StatusBadge status={version.status} />
                  </li>
                ))}
              </ul>
            </>
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

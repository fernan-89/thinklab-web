import { useState, type FormEvent } from 'react';
import { ProblemError } from '../api/client';
import { ARTICLE_ACTIONS, knowledgeApi, type ArticleAction, type ArticleInput } from '../api/services';
import { ARTICLE_STATUSES, ARTICLE_VISIBILITIES, type Article, type ArticleStatus, type ArticleVisibility, type AuditEntry } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { isId, parseIds } from './Incidents';
import { useI18n } from '../i18n';

const short = (id: string) => id.slice(0, 8);

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** Keywords typed with commas or one per line; the service trims and lower-cases them, here only the empty ones are dropped. */
export function parseKeywords(text: string): string[] {
  return text.split(/[,\n]/).map((word) => word.trim()).filter(Boolean);
}

export function KnowledgePage() {
  const { t, locale } = useI18n();
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
        <h1>{t('nav.knowledge')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('kb.new')}</button>
      </div>
      <p className="muted">{t('kb.intro')}</p>
      {creating && (
        <ArticleForm
          onCancel={() => setCreating(false)}
          onSaved={(article) => { setCreating(false); setSelectedId(article.id); list.reload(); }}
        />
      )}
      <div className="filters">
        <input type="search" aria-label={t('kb.search')} placeholder={t('kb.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as ArticleStatus | '')}>
          <option value="">{t('common.allStatuses')}</option>
          {ARTICLE_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label={t('kb.visibility')} value={visibility} onChange={(e) => setVisibility(e.target.value as ArticleVisibility | '')}>
          <option value="">{t('kb.anyAudience')}</option>
          {ARTICLE_VISIBILITIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input type="search" aria-label={t('kb.keyword')} placeholder={t('kb.keyword')} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <input type="search" aria-label={t('kb.aboutProblem')} placeholder={t('kb.aboutProblemId')} value={problem} onChange={(e) => setProblem(e.target.value)} />
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('kb.empty')}</Empty> : (
          <table>
            <thead><tr><th>{t('kb.article')}</th><th>{t('common.status')}</th><th>{t('kb.audience')}</th><th>{t('kb.version')}</th><th>{t('common.category')}</th><th>{t('kb.updated')}</th></tr></thead>
            <tbody>
              {list.data?.map((article) => (
                <tr key={article.id} className={article.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(article.id)}>{article.title}</button></td>
                  <td><StatusBadge status={article.status} /></td>
                  <td><StatusBadge status={article.visibility} /></td>
                  <td>{article.version}</td>
                  <td>{article.category ?? <span className="muted">-</span>}</td>
                  <td>{new Date(article.updatedAt).toLocaleString(locale)}</td>
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
  const { t } = useI18n();
  const notAnId = (bad: string) => t('itsm.notAnId', { id: bad });
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
    const parsedProblems = parseIds(problems, notAnId);
    const parsedIncidents = parseIds(incidents, notAnId);
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
    <form className="card form" aria-label={article ? t('kb.edit') : t('kb.new')} onSubmit={submit}>
      <h2>{article ? t('kb.edit') : t('kb.new')}</h2>
      <label>{t('itsm.title')}<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>{t('kb.text')}<textarea value={body} maxLength={20000} rows={8} onChange={(e) => setBody(e.target.value)} /></label>
      <label>{t('common.category')}<input value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} /></label>
      <label>{t('kb.keywordsInput')}<input value={keywords} onChange={(e) => setKeywords(e.target.value)} /></label>
      <label>{t('kb.audienceInput')}
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as ArticleVisibility)}>
          <option value="PUBLIC">{t('kb.publicOption')}</option>
          <option value="INTERNAL">{t('kb.internalOption')}</option>
        </select>
      </label>
      <label>{t('kb.relatedProblems')}<textarea value={problems} onChange={(e) => setProblems(e.target.value)} /></label>
      <label>{t('kb.relatedIncidents')}<textarea value={incidents} onChange={(e) => setIncidents(e.target.value)} /></label>
      {localError && <p className="field-error" role="alert">{localError}</p>}
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('common.save')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

type Pending = 'return' | 'edit' | undefined;

function ArticleDetail({ id, onClose, onChanged, onOpen }: { id: string; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const { t, locale, action: actionLabel } = useI18n();
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
    <aside className="detail" aria-label={t('kb.detail')}>
      <div className="detail-head">
        <h2>{article?.title ?? t('kb.article')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={detail.error ?? actionError} />
      {article && (
        <>
          <p>
            <StatusBadge status={article.status} /> <StatusBadge status={article.visibility} /> <span className="muted">version {article.version}</span>
          </p>
          {article.status === 'DRAFT' && article.reviewComment && (
            <div className="banner" role="status"><strong>{t('itsm.sentBack')}</strong> {article.reviewComment}</div>
          )}
          <div className="article-body">{article.body}</div>
          <dl>
            {article.category && <><dt>{t('common.category')}</dt><dd>{article.category}</dd></>}
            <dt>{t('kb.keywords')}</dt><dd>{article.keywords.length === 0 ? t('itsm.none') : article.keywords.join(', ')}</dd>
            {article.authorId && <><dt>{t('kb.writtenBy')}</dt><dd><code>{article.authorId.length > 12 ? short(article.authorId) : article.authorId}</code></dd></>}
            {article.reviewerId && <><dt>{t('kb.reviewedBy')}</dt><dd><code>{article.reviewerId.length > 12 ? short(article.reviewerId) : article.reviewerId}</code></dd></>}
            {article.publishedAt && <><dt>{t('kb.published')}</dt><dd>{new Date(article.publishedAt).toLocaleString(locale)}</dd></>}
            {article.relatedProblemIds && <><dt>{t('nav.problems')}</dt><dd>{article.relatedProblemIds.length === 0 ? t('itsm.none') : article.relatedProblemIds.map((related) => <code key={related}>{short(related)} </code>)}</dd></>}
            {article.relatedIncidentIds && <><dt>{t('nav.incidents')}</dt><dd>{article.relatedIncidentIds.length === 0 ? t('itsm.none') : article.relatedIncidentIds.map((related) => <code key={related}>{short(related)} </code>)}</dd></>}
          </dl>

          {detail.data?.trail && (
            <>
              <div className="actions" aria-label={t('itsm.actions')}>
                {ARTICLE_ACTIONS[article.status].map(({ action, label }) => (
                  <button key={action} type="button" disabled={busy} onClick={() => void run(() => knowledge.control(id, action as ArticleAction))}>{actionLabel(label)}</button>
                ))}
                {article.status === 'DRAFT' && <button type="button" disabled={busy} onClick={() => setPending('edit')}>{t('common.edit')}</button>}
                {article.status === 'IN_REVIEW' && <button type="button" disabled={busy} onClick={() => setPending('return')}>{t('kb.returnForChanges')}</button>}
                {article.status === 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => void newVersion()}>{t('kb.newVersion')}</button>}
              </div>

              {pending === 'edit' && (
                <ArticleForm article={article} onCancel={() => setPending(undefined)} onSaved={() => { setPending(undefined); detail.reload(); onChanged(); }} />
              )}
              {pending === 'return' && (
                <form className="form" aria-label={t('kb.returnArticle')} onSubmit={(e) => { e.preventDefault(); void run(() => knowledge.returnForChanges(id, comment.trim())); }}>
                  <label>{t('kb.whatChange')}<textarea value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></label>
                  <div className="actions">
                    <button type="submit" className="primary" disabled={comment.trim() === '' || busy}>{t('common.return')}</button>
                    <button type="button" onClick={() => setPending(undefined)}>{t('itsm.neverMind')}</button>
                  </div>
                </form>
              )}
            </>
          )}

          {detail.data?.versions && detail.data.versions.length > 1 && (
            <>
              <h3>{t('kb.versions')}</h3>
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
              <h3>{t('itsm.history')}</h3>
              <ol className="audit">
                {detail.data.trail.map((entry) => (
                  <li key={`${entry.occurredAt}-${entry.action}`}>
                    <strong>{entry.action}</strong> by {entry.executor}
                    <div className="muted small">{new Date(entry.occurredAt).toLocaleString(locale)}{entry.detail ? ` - ${entry.detail}` : ''}</div>
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

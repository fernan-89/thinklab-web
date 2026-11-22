import { useState, type FormEvent } from 'react';
import { approvalApi } from '../api/services';
import { APPROVAL_STATUSES, type ApprovalPolicy, type ApprovalRequest, type ApprovalStage, type ApprovalStatus, type AuditEntry } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n, type Translate } from '../i18n';

type Tab = 'inbox' | 'requests' | 'policies';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUserId = (value: string) => UUID.test(value);
const short = (id: string) => id.slice(0, 8);

/** "Stage 2 of 3" - the chain a request walks, one stage at a time. */
export const stageText = (request: Pick<ApprovalRequest, 'currentStage' | 'stages' | 'status'>, t?: Translate) =>
  request.status === 'PENDING'
    ? (t ? t('approvals.stageOf', { current: request.currentStage, total: request.stages.length }) : `Stage ${request.currentStage} of ${request.stages.length}`)
    : (t ? t(request.stages.length === 1 ? 'approvals.stagesOne' : 'approvals.stagesMany', { count: request.stages.length }) : `${request.stages.length} stage${request.stages.length === 1 ? '' : 's'}`);

export function ApprovalsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('inbox');
  return (
    <section>
      <h1>{t('nav.approvals')}</h1>
      <p className="muted">
        {t('approvals.intro')}
      </p>
      <div className="tabs" role="tablist" aria-label={t('nav.approvals')}>
        <button type="button" role="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>{t('approvals.inbox')}</button>
        <button type="button" role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')}>{t('approvals.all')}</button>
        <button type="button" role="tab" aria-selected={tab === 'policies'} onClick={() => setTab('policies')}>{t('ops.policies')}</button>
      </div>
      {tab === 'inbox' && <InboxTab />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'policies' && <PoliciesTab />}
    </section>
  );
}

function InboxTab() {
  const { t } = useI18n();
  const { api, session } = useSession();
  const approvals = approvalApi(api);
  const me = session?.executor ?? '';
  const inbox = useAsync(() => (isUserId(me) ? approvals.inbox(me) : Promise.resolve([])), [me]);
  const [failure, setFailure] = useState<Error>();

  if (!isUserId(me)) {
    return <p className="muted">{t('approvals.addressedTo')} <code>{me}</code>{t('approvals.notOne')}</p>;
  }
  const decide = async (id: string, outcome: 'APPROVE' | 'REJECT', comment: string) => {
    setFailure(undefined);
    try {
      await approvals.decide(id, outcome, comment);
    } catch (error) {
      setFailure(error as Error);
    }
    inbox.reload();
  };
  return (
    <>
      <ProblemBanner error={failure ?? inbox.error} />
      {inbox.loading && <p className="muted">{t('common.loading')}</p>}
      {!inbox.loading && inbox.data?.length === 0 && <Empty>{t('approvals.nothingWaiting')}</Empty>}
      <ul className="cards">
        {inbox.data?.map((request) => <InboxCard key={request.id} request={request} onDecide={decide} />)}
      </ul>
    </>
  );
}

function InboxCard({ request, onDecide }: { request: ApprovalRequest; onDecide: (id: string, outcome: 'APPROVE' | 'REJECT', comment: string) => Promise<void> }) {
  const { t, locale } = useI18n();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (outcome: 'APPROVE' | 'REJECT') => {
    setBusy(true);
    await onDecide(request.id, outcome, comment);
    setBusy(false);
  };
  return (
    <li className="card" aria-label={t('approvals.itemAria', { type: request.subjectType, id: short(request.subjectId) })}>
      <p>
        <strong>{request.subjectType}</strong> <code>{short(request.subjectId)}</code>
        <span className="muted"> - {stageText(request, t)}`, ${t(request.requiredApprovals === 1 ? 'approvals.neededOne' : 'approvals.neededMany', { count: request.requiredApprovals })}`</span>
      </p>
      <Chain request={request} />
      <p className="muted">{t('approvals.askedBy')} <code>{short(request.requesterId)}</code> on {new Date(request.createdAt).toLocaleString(locale)}</p>
      <div className="filters">
        <input aria-label={t('approvals.commentFor', { id: short(request.subjectId) })} placeholder={t('requests.commentOptional')} value={comment} onChange={(e) => setComment(e.target.value)} />
        <button type="button" className="primary" disabled={busy} onClick={() => act('APPROVE')}>{t('requests.approve')}</button>
        <button type="button" disabled={busy} onClick={() => act('REJECT')}>{t('requests.reject')}</button>
      </div>
    </li>
  );
}

/** The chain as a row of stages: done, current, or still ahead. */
function Chain({ request }: { request: ApprovalRequest }) {
  const { t } = useI18n();
  return (
    <ol className="chain" aria-label={t('approvals.stages')}>
      {request.stages.map((stage, index) => {
        const number = index + 1;
        const votes = request.decisions.filter((decision) => decision.stage === number).length;
        const state = request.status === 'APPROVED' || number < request.currentStage ? 'done' : number === request.currentStage && request.status === 'PENDING' ? 'current' : 'ahead';
        return (
          <li key={number} className={`chain-stage chain-${state}`}>
            {t('approvals.stageVotes', { number, votes, required: stage.requiredApprovals })} <span className="muted">({t(stage.eligibleApproverIds.length === 1 ? 'approvals.approversOne' : 'approvals.approversMany', { count: stage.eligibleApproverIds.length })})</span>
          </li>
        );
      })}
    </ol>
  );
}

function RequestsTab() {
  const { t, locale, enumValue } = useI18n();
  const { api } = useSession();
  const approvals = approvalApi(api);
  const [status, setStatus] = useState<ApprovalStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const list = useAsync(() => approvals.requests(status || undefined), [status]);
  return (
    <>
      <div className="filters">
        <select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as ApprovalStatus | '')}>
          <option value="">{t('common.allStatuses')}</option>
          {APPROVAL_STATUSES.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('requests.empty')}</Empty> : (
          <table>
            <thead><tr><th>{t('approvals.subject')}</th><th>{t('common.status')}</th><th>{t('approvals.progress')}</th><th>{t('approvals.asked')}</th></tr></thead>
            <tbody>
              {list.data?.map((request) => (
                <tr key={request.id} className={request.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(request.id)}>{request.subjectType} {short(request.subjectId)}</button></td>
                  <td><StatusBadge status={request.status} /></td>
                  <td>{stageText(request, t)}</td>
                  <td>{new Date(request.createdAt).toLocaleDateString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && list.data && <RequestDetail key={selectedId} request={list.data.find((r) => r.id === selectedId)} onClose={() => setSelectedId(undefined)} onChanged={list.reload} />}
      </div>
    </>
  );
}

function RequestDetail({ request, onClose, onChanged }: { request: ApprovalRequest | undefined; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const approvals = approvalApi(api);
  const id = request?.id ?? '';
  const audit = useAsync<AuditEntry[]>(() => (id ? approvals.auditLog(id) : Promise.resolve([])), [id]);
  const [failure, setFailure] = useState<Error>();
  if (!request) return null;
  const cancel = async () => {
    setFailure(undefined);
    try {
      await approvals.cancel(request.id);
      onChanged();
    } catch (error) {
      setFailure(error as Error);
    }
  };
  return (
    <aside className="detail" aria-label={t('approvals.detail')}>
      <div className="page-head">
        <h2>{request.subjectType} <code>{short(request.subjectId)}</code></h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <p><StatusBadge status={request.status} /> <span className="muted">{stageText(request, t)}</span></p>
      <Chain request={request} />
      <h3>{t('approvals.votes')}</h3>
      {request.decisions.length === 0 ? <Empty>{t('approvals.noVotes')}</Empty> : (
        <ul>
          {request.decisions.map((decision) => (
            <li key={`${decision.approverId}-${decision.decidedAt}`}>
              {t('approvals.voteStage', { number: decision.stage })} <code>{short(decision.approverId)}</code> {t(decision.outcome === 'APPROVE' ? 'approvals.approvedLower' : 'approvals.rejectedLower')}
              {decision.comment ? <> - {decision.comment}</> : null}
            </li>
          ))}
        </ul>
      )}
      {request.status === 'PENDING' && <button type="button" onClick={cancel}>{t('approvals.cancel')}</button>}
      <ProblemBanner error={failure ?? audit.error} />
      <h3>{t('itsm.history')}</h3>
      <ul>
        {audit.data?.map((entry) => <li key={`${entry.occurredAt}-${entry.action}`}>{entry.action}: {entry.detail}</li>)}
      </ul>
    </aside>
  );
}

function PoliciesTab() {
  const { t } = useI18n();
  const { api } = useSession();
  const approvals = approvalApi(api);
  const list = useAsync<ApprovalPolicy[]>(() => approvals.policies(), []);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="page-head">
        <h2>{t('ops.policies')}</h2>
        <button type="button" className="primary" disabled={creating} onClick={() => setCreating(true)}>{t('ops.newPolicy')}</button>
      </div>
      {creating && <NewPolicyForm onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); list.reload(); }} />}
      <ProblemBanner error={list.error} />
      {list.data?.length === 0 && !list.loading && <Empty>{t('approvals.noPolicies')}</Empty>}
      <ul className="cards">
        {list.data?.map((policy) => (
          <li key={policy.id} className="card" aria-label={t('approvals.policyAria', { name: policy.name })}>
            <h3>{policy.name} <span className="muted">({t(policy.stages.length === 1 ? 'approvals.stagesOne' : 'approvals.stagesMany', { count: policy.stages.length })})</span></h3>
            <ol>
              {policy.stages.map((stage, index) => (
                <li key={index}>{stage.requiredApprovals} of {stage.eligibleApproverIds.length}: {stage.eligibleApproverIds.map(short).join(', ')}</li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </>
  );
}

interface StageDraft { required: string; approvers: string }

export function parseStages(drafts: StageDraft[], t?: Translate): { stages?: ApprovalStage[]; error?: string } {
  const stages: ApprovalStage[] = [];
  for (const [index, draft] of drafts.entries()) {
    const ids = draft.approvers.split(/[\s,;]+/).filter(Boolean);
    const bad = ids.find((id) => !isUserId(id));
    if (ids.length === 0) return { error: t ? t('approvals.stageNoApprover', { number: index + 1 }) : `Stage ${index + 1} needs at least one approver.` };
    if (bad) return { error: t ? t('approvals.stageBadId', { number: index + 1, id: bad }) : `Stage ${index + 1}: "${bad}" is not a user id.` };
    const required = Number(draft.required);
    if (!Number.isInteger(required) || required < 1 || required > ids.length) return { error: t ? t('approvals.stageRange', { number: index + 1, max: ids.length }) : `Stage ${index + 1}: approvals needed must be between 1 and ${ids.length}.` };
    stages.push({ requiredApprovals: required, eligibleApproverIds: ids });
  }
  return { stages };
}

function NewPolicyForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<StageDraft[]>([{ required: '1', approvers: '' }]);
  const [localError, setLocalError] = useState<string>();
  const [failure, setFailure] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const update = (index: number, patch: Partial<StageDraft>) => setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(undefined);
    const parsed = parseStages(drafts, t);
    setLocalError(parsed.error);
    if (!parsed.stages) return;
    setBusy(true);
    try {
      await approvalApi(api).createPolicy(name.trim(), parsed.stages);
      onCreated();
    } catch (error) {
      setFailure(error as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card form" onSubmit={submit} aria-label={t('ops.newPolicy')}>
      <label>{t('common.name')}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      {drafts.map((draft, index) => (
        <fieldset key={index}>
          <legend>{t('approvals.stageNumber', { number: index + 1 })}</legend>
          <label>{t('approvals.needed')}<input type="number" min={1} value={draft.required} onChange={(e) => update(index, { required: e.target.value })} aria-label={t('approvals.neededStage', { number: index + 1 })} /></label>
          <label>{t('approvals.approverIds')}
            <textarea value={draft.approvers} onChange={(e) => update(index, { approvers: e.target.value })} aria-label={t('approvals.approversStage', { number: index + 1 })} />
          </label>
          {drafts.length > 1 && <button type="button" onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}>{t('approvals.removeStage', { number: index + 1 })}</button>}
        </fieldset>
      ))}
      <button type="button" onClick={() => setDrafts((current) => [...current, { required: '1', approvers: '' }])} disabled={drafts.length >= 10}>{t('approvals.addStage')}</button>
      {localError && <p className="field-error" role="alert">{localError}</p>}
      <ProblemBanner error={failure} />
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || name.trim() === ''}>{t('ops.createPolicy')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

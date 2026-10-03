import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { ApprovalsPage, isUserId, parseStages, stageText } from './Approvals';

beforeEach(() => sessionStorage.clear());

const LEAD = '0a0a0a0a-0000-4000-8000-000000000001';
const SEC_A = '0b0b0b0b-0000-4000-8000-000000000002';
const SEC_B = '0c0c0c0c-0000-4000-8000-000000000003';
const me = { organisationId: ORG, executor: LEAD };

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1', organisationId: ORG, subjectType: 'ChangeRequest', subjectId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  requesterId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', policyId: 'p1', requiredApprovals: 1, eligibleApproverIds: [LEAD], currentStage: 1,
  stages: [{ requiredApprovals: 1, eligibleApproverIds: [LEAD] }, { requiredApprovals: 2, eligibleApproverIds: [SEC_A, SEC_B] }],
  status: 'PENDING', decisions: [], createdAt: '2026-10-03T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z', ...over,
});
const policy = (over: Record<string, unknown> = {}) => ({
  id: 'p1', organisationId: ORG, name: 'Production change', requiredApprovals: 1, eligibleApproverIds: [LEAD],
  stages: [{ requiredApprovals: 1, eligibleApproverIds: [LEAD] }, { requiredApprovals: 2, eligibleApproverIds: [SEC_A, SEC_B] }],
  createdAt: '2026-10-03T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z', ...over,
});

describe('helpers', () => {
  it('knows a user id, and words the progress of a request', () => {
    expect(isUserId(LEAD)).toBe(true);
    expect(isUserId('alice')).toBe(false);
    expect(stageText(request() as never)).toBe('Stage 1 of 2');
    expect(stageText(request({ status: 'APPROVED' }) as never)).toBe('2 stages');
    expect(stageText(request({ status: 'REJECTED', stages: [{ requiredApprovals: 1, eligibleApproverIds: [LEAD] }] }) as never)).toBe('1 stage');
  });

  it('turns stage drafts into a chain, saying exactly what is wrong otherwise', () => {
    expect(parseStages([{ required: '1', approvers: `${LEAD}, ${SEC_A}` }, { required: '2', approvers: `${SEC_B}\n${SEC_A}` }]).stages).toEqual([
      { requiredApprovals: 1, eligibleApproverIds: [LEAD, SEC_A] }, { requiredApprovals: 2, eligibleApproverIds: [SEC_B, SEC_A] },
    ]);
    expect(parseStages([{ required: '1', approvers: ' ' }]).error).toBe('Stage 1 needs at least one approver.');
    expect(parseStages([{ required: '1', approvers: `${LEAD} alice` }]).error).toBe('Stage 1: "alice" is not a user id.');
    expect(parseStages([{ required: '3', approvers: LEAD }]).error).toBe('Stage 1: approvals needed must be between 1 and 1.');
    expect(parseStages([{ required: '0', approvers: LEAD }]).error).toContain('between 1 and 1');
    expect(parseStages([{ required: 'x', approvers: LEAD }]).error).toContain('between 1 and 1');
  });
});

describe('My inbox', () => {
  it('shows what waits for me with its chain, and sends my decision with my comment as me', async () => {
    let waiting = [request()];
    const { impl, calls } = fakeFetch((r) => {
      if (r.url.pathname.endsWith('/decision/capture')) { waiting = []; return { body: request({ status: 'PENDING', currentStage: 2 }) }; }
      if (r.url.pathname.endsWith('/retrieve')) return { body: waiting };
      return undefined;
    });
    renderWithSession(<ApprovalsPage />, impl, me);
    const user = userEvent.setup();

    const card = await screen.findByLabelText('Approval ChangeRequest aaaaaaaa');
    expect(within(card).getByText(/Stage 1 of 2/)).toBeInTheDocument();
    expect(calls[0].url.searchParams.get('pendingFor')).toBe(LEAD);
    expect(within(card).getByLabelText('Stages').children).toHaveLength(2);

    await user.type(within(card).getByLabelText('Comment for aaaaaaaa'), 'looks fine');
    await user.click(within(card).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(screen.getByText('Nothing is waiting for you.')).toBeInTheDocument());
    const decision = calls.find((c) => c.url.pathname.endsWith('/decision/capture'))!;
    expect(decision.method).toBe('PUT');
    expect(decision.body).toEqual({ outcome: 'APPROVE', comment: 'looks fine' });
    expect(decision.headers.get('X-Executor')).toBe(LEAD);
  });

  it('rejects without a comment, and shows a refusal (a lost race, say) as it comes back', async () => {
    const { impl, calls } = fakeFetch((r) => {
      if (r.url.pathname.endsWith('/decision/capture')) return { status: 409, body: { title: 'Conflict', error_code: 'ERR-WFA-00409', detail: 'ApprovalRequest was changed by someone else' } };
      if (r.url.pathname.endsWith('/retrieve')) return { body: [request()] };
      return undefined;
    });
    renderWithSession(<ApprovalsPage />, impl, me);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));

    expect(await screen.findByText('ERR-WFA-00409')).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname.endsWith('/decision/capture'))!.body).toEqual({ outcome: 'REJECT' });
    expect(screen.getByLabelText('Approval ChangeRequest aaaaaaaa')).toBeInTheDocument();
  });

  it('says plainly when the signed-in identity is not a user id, and asks nothing of the server', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: [] }));
    renderWithSession(<ApprovalsPage />, impl, { organisationId: ORG, executor: 'alice' });

    expect(await screen.findByText(/which is not one/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows a plural quorum, and a failed load', async () => {
    const { impl } = fakeFetch(() => ({ status: 500, body: { title: 'Boom' } }));
    renderWithSession(<ApprovalsPage />, impl, me);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');

    const second = fakeFetch(() => ({ body: [request({ requiredApprovals: 2, currentStage: 2, eligibleApproverIds: [LEAD, SEC_A],
      decisions: [{ approverId: SEC_B, outcome: 'APPROVE', decidedAt: '2026-10-03T11:00:00Z', stage: 1 }] })] }));
    renderWithSession(<ApprovalsPage />, second.impl, me);
    expect(await screen.findByText(/2 approvals needed at this stage/)).toBeInTheDocument();
  });
});

describe('All requests', () => {
  const server = (requests: unknown[], extra: Handler = () => undefined): Handler => (r) => {
    const custom = extra(r);
    if (custom) return custom;
    if (r.url.pathname.endsWith('/audit-log/retrieve')) return { body: [{ occurredAt: '2026-10-03T10:00:00Z', action: 'INITIATED', executor: 'x', detail: 'Approval requested.' }] };
    if (r.url.pathname.endsWith('/retrieve')) return { body: requests };
    return undefined;
  };

  it('lists the requests with their progress, filters by status, and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([request(), request({ id: 'r2', status: 'APPROVED', currentStage: 2 })]));
    renderWithSession(<ApprovalsPage />, impl, me);
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'All requests' }));
    expect(await screen.findAllByRole('button', { name: 'ChangeRequest aaaaaaaa' })).toHaveLength(2);
    expect(screen.getByText('Stage 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('2 stages')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'REJECTED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('REJECTED'));
  });

  it('shows an empty list as empty', async () => {
    const { impl } = fakeFetch(server([]));
    renderWithSession(<ApprovalsPage />, impl, me);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'All requests' }));
    expect(await screen.findByText('No requests match.')).toBeInTheDocument();
  });

  it('opens a request: its chain, its votes with their stage and comment, its history; and closes it', async () => {
    const voted = request({ currentStage: 2, requiredApprovals: 2, decisions: [{ approverId: LEAD, outcome: 'APPROVE', comment: 'ok', decidedAt: '2026-10-03T11:00:00Z', stage: 1 }, { approverId: SEC_A, outcome: 'REJECT', decidedAt: '2026-10-03T12:00:00Z', stage: 2 }] });
    const { impl } = fakeFetch(server([voted]));
    renderWithSession(<ApprovalsPage />, impl, me);
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'All requests' }));
    await user.click(await screen.findByRole('button', { name: 'ChangeRequest aaaaaaaa' }));

    const detail = await screen.findByLabelText('Approval detail');
    const line = (text: string) => within(detail).getByText((_, element) => element?.tagName === 'LI' && element.textContent === text);
    expect(line('Stage 1: 0a0a0a0a approved - ok')).toBeInTheDocument();
    expect(line('Stage 2: 0b0b0b0b rejected')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED: Approval requested.')).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Approval detail')).not.toBeInTheDocument();
  });

  it('cancels a pending request, and shows the refusal when it cannot', async () => {
    let attempt = 0;
    const { impl, calls } = fakeFetch(server([request()], (r) => {
      if (r.url.pathname.endsWith('/control/cancel')) { attempt += 1; return attempt === 1 ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-WFA-00409' } } : { status: 204 }; }
      return undefined;
    }));
    renderWithSession(<ApprovalsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'All requests' }));
    await user.click(await screen.findByRole('button', { name: 'ChangeRequest aaaaaaaa' }));
    expect(await screen.findByText('No votes yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByText('ERR-WFA-00409')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(calls.filter((c) => c.url.pathname.endsWith('/control/cancel'))).toHaveLength(2));
  });

  it('a request that is no longer in the list closes its detail', async () => {
    let cancelled = false;
    const { impl } = fakeFetch((r) => {
      if (r.url.pathname.endsWith('/control/cancel')) { cancelled = true; return { status: 204 }; }
      if (r.url.pathname.endsWith('/audit-log/retrieve')) return { body: [] };
      return { body: cancelled ? [] : [request()] };
    });
    renderWithSession(<ApprovalsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'All requests' }));
    await user.click(await screen.findByRole('button', { name: 'ChangeRequest aaaaaaaa' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(screen.queryByLabelText('Approval detail')).not.toBeInTheDocument());
  });
});

describe('Policies', () => {
  it('lists the policies with their stages', async () => {
    const { impl } = fakeFetch((r) => (!r.url.pathname.includes('/policy/') ? { body: [] } : { body: [policy(), policy({ id: 'p2', name: 'CAB', stages: [{ requiredApprovals: 1, eligibleApproverIds: [LEAD] }] })] }));
    renderWithSession(<ApprovalsPage />, impl, me);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Policies' }));

    const card = await screen.findByLabelText('Policy Production change');
    expect(within(card).getByText('(2 stages)')).toBeInTheDocument();
    expect(within(card).getByText('2 of 2: 0b0b0b0b, 0c0c0c0c')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Policy CAB')).getByText('(1 stage)')).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    const { impl } = fakeFetch(() => ({ body: [] }));
    renderWithSession(<ApprovalsPage />, impl, me);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Policies' }));
    expect(await screen.findByText('No policies yet.')).toBeInTheDocument();
  });

  it('builds a chain stage by stage, refuses a bad one on the page, and creates the policy', async () => {
    const { impl, calls } = fakeFetch((r) => (r.method === 'POST' ? { status: 201, body: policy() } : { body: [] }));
    renderWithSession(<ApprovalsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Policies' }));
    await user.click(await screen.findByRole('button', { name: 'New policy' }));

    const form = screen.getByRole('form', { name: 'New policy' });
    expect(within(form).getByRole('button', { name: 'Create policy' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), 'Production change');
    await user.type(within(form).getByLabelText('Approvers, stage 1'), 'alice');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));
    expect(await within(form).findByText('Stage 1: "alice" is not a user id.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.clear(within(form).getByLabelText('Approvers, stage 1'));
    await user.type(within(form).getByLabelText('Approvers, stage 1'), LEAD);
    await user.click(within(form).getByRole('button', { name: 'Add stage' }));
    await user.type(within(form).getByLabelText('Approvers, stage 2'), `${SEC_A} ${SEC_B}`);
    await user.clear(within(form).getByLabelText('Approvals needed, stage 2'));
    await user.type(within(form).getByLabelText('Approvals needed, stage 2'), '2');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New policy' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Production change',
      stages: [{ requiredApprovals: 1, eligibleApproverIds: [LEAD] }, { requiredApprovals: 2, eligibleApproverIds: [SEC_A, SEC_B] }],
    });
  });

  it('removes a stage, stops at ten, and shows what the server refuses (the same person in two stages)', async () => {
    const { impl } = fakeFetch((r) => (r.method === 'POST'
      ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-WFA-00400', detail: 'Segregation of duties: an approver cannot belong to more than one stage.' } }
      : { body: [] }));
    renderWithSession(<ApprovalsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Policies' }));
    await user.click(await screen.findByRole('button', { name: 'New policy' }));
    const form = screen.getByRole('form', { name: 'New policy' });

    expect(within(form).queryByRole('button', { name: /Remove stage/ })).not.toBeInTheDocument();
    for (let i = 0; i < 9; i += 1) await user.click(within(form).getByRole('button', { name: 'Add stage' }));
    expect(within(form).getByRole('button', { name: 'Add stage' })).toBeDisabled();
    await user.click(within(form).getByRole('button', { name: 'Remove stage 10' }));
    for (let i = 0; i < 8; i += 1) await user.click(within(form).getByRole('button', { name: `Remove stage ${9 - i}` }));
    expect(within(form).getByLabelText('Approvers, stage 1')).toBeInTheDocument();
    expect(within(form).queryByLabelText('Approvers, stage 2')).not.toBeInTheDocument();

    await user.type(within(form).getByLabelText('Name'), 'Twice');
    await user.type(within(form).getByLabelText('Approvers, stage 1'), LEAD);
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));
    expect(await within(form).findByText(/Segregation of duties/)).toBeInTheDocument();

    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New policy' })).not.toBeInTheDocument();
  });
});

describe('the app', () => {
  it('has Approvals in the navigation and opens it', async () => {
    const { impl } = fakeFetch(() => ({ body: [] }));
    renderWithSession(<App />, impl, me, '/approvals');
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
  });
});

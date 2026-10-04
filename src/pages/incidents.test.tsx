import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { IncidentsPage, isId, parseIds, previewPriority } from './Incidents';

beforeEach(() => sessionStorage.clear());

const ME = '0a0a0a0a-0000-4000-8000-000000000001';
const ASSET = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const me = { organisationId: ORG, executor: ME };

const incident = (over: Record<string, unknown> = {}) => ({
  id: 'i1', organisationId: ORG, requesterId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', title: 'Core switch down', description: 'No link on floor 3',
  impact: 'HIGH', urgency: 'HIGH', priority: 'P1', status: 'NEW', affectedAssetIds: [ASSET], relatedChangeIds: [], reopenCount: 0,
  response: { dueAt: '2026-10-04T10:15:00Z', state: 'PENDING' }, resolution: { dueAt: '2026-10-04T14:00:00Z', state: 'PENDING' },
  comments: [], createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', ...over,
});

/** A tiny incident server: one incident that changes as actions are applied. */
function server(initial: Record<string, unknown> = {}, extra: Handler = () => undefined) {
  let current: Record<string, unknown> = incident(initial);
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: [{ occurredAt: '2026-10-04T10:00:00Z', action: 'INITIATED', executor: 'x', detail: 'Incident opened with priority P1.' }] };
    if (r.method === 'POST' && path.endsWith('/initiate') && !path.endsWith('/comment/initiate')) return { status: 201, body: incident({ id: 'i2', title: (r.body as { title: string }).title }) };
    if (r.method === 'POST' && path.endsWith('/comment/initiate')) {
      current = { ...current, comments: [...(current.comments as unknown[]), { commentId: 'c1', author: ME, text: (r.body as { text: string }).text, internal: (r.body as { internal: boolean }).internal, createdAt: '2026-10-04T11:00:00Z' }] };
      return { status: 201 };
    }
    if (r.method === 'PUT') {
      const next: Record<string, string> = { acknowledge: 'ACKNOWLEDGED', start: 'IN_PROGRESS', hold: 'ON_HOLD', resume: 'IN_PROGRESS', resolve: 'RESOLVED', close: 'CLOSED', reopen: 'IN_PROGRESS', cancel: 'CANCELLED' };
      const action = path.split('/').pop() as string;
      if (next[action]) current = { ...current, status: next[action] };
      if (action === 'update') current = { ...current, priority: 'P3', impact: (r.body as { impact: string }).impact, urgency: (r.body as { urgency: string }).urgency };
      return { status: 204 };
    }
    if (path.endsWith('/retrieve') && path.split('/').length === 6) return { body: current };
    if (path.endsWith('/retrieve')) return { body: [current] };
    return undefined;
  };
  return handler;
}

describe('helpers', () => {
  it('knows an id, reads lists of ids, and previews the priority matrix', () => {
    expect(isId(ME)).toBe(true);
    expect(isId('alice')).toBe(false);
    expect(parseIds(` ${ME}, ${ASSET}\n`).ids).toEqual([ME, ASSET]);
    expect(parseIds('').ids).toEqual([]);
    expect(parseIds(`${ME} nope`).error).toBe('"nope" is not an id.');
    expect(previewPriority('HIGH', 'HIGH')).toBe('P1');
    expect(previewPriority('HIGH', 'MEDIUM')).toBe('P2');
    expect(previewPriority('MEDIUM', 'HIGH')).toBe('P2');
    expect(previewPriority('MEDIUM', 'MEDIUM')).toBe('P3');
    expect(previewPriority('LOW', 'HIGH')).toBe('P3');
    expect(previewPriority('LOW', 'MEDIUM')).toBe('P4');
    expect(previewPriority('LOW', 'LOW')).toBe('P4');
  });
});

describe('the list', () => {
  it('shows incidents with priority, status and both SLA targets, and asks for open ones by default', async () => {
    const { impl, calls } = fakeFetch(server({ response: { dueAt: '2026-10-04T10:15:00Z', state: 'BREACHED' } }));
    renderWithSession(<IncidentsPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Core switch down' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('P1')).toBeInTheDocument();
    expect(within(row).getByText('NEW')).toBeInTheDocument();
    expect(within(row).getByText('BREACHED')).toBeInTheDocument();
    expect(within(row).getByText('unassigned')).toBeInTheDocument();
    expect(calls[0].url.searchParams.get('openOnly')).toBe('true');
  });

  it('filters by status and priority, shows everything when asked, and "assigned to me" uses my id', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<IncidentsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Core switch down' });

    await user.selectOptions(screen.getByLabelText('Priority'), 'P2');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('priority')).toBe('P2'));
    await user.selectOptions(screen.getByLabelText('Status'), 'CLOSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('CLOSED'));
    expect(calls.at(-1)!.url.searchParams.get('openOnly')).toBeNull();
    expect(screen.getByLabelText('Open only')).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await user.click(screen.getByLabelText('Open only'));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('openOnly')).toBeNull());
    await user.click(screen.getByLabelText('Assigned to me'));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('assigneeId')).toBe(ME));
  });

  it('says so when nothing matches, shows a failed load, and cannot do "assigned to me" for a sign-in that is not an id', async () => {
    const empty = fakeFetch(() => ({ body: [] }));
    renderWithSession(<IncidentsPage />, empty.impl, { organisationId: ORG, executor: 'alice' });
    expect(await screen.findByText('No incidents match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Assigned to me')).toBeDisabled();

    const failing = fakeFetch(() => ({ status: 500, body: { title: 'Boom' } }));
    renderWithSession(<IncidentsPage />, failing.impl, me);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });
});

describe('opening an incident', () => {
  it('previews the priority while filling the form, refuses a bad id list, and opens it with the requester', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<IncidentsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Core switch down' });

    await user.click(screen.getByRole('button', { name: 'New incident' }));
    const form = screen.getByRole('form', { name: 'New incident' });
    expect(within(form).getByRole('button', { name: 'Open incident' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Title'), 'Printer jam');
    await user.type(within(form).getByLabelText(/Description/), 'Floor 2');
    expect(within(form).getByRole('status')).toHaveTextContent('P3');
    await user.selectOptions(within(form).getByLabelText('Impact'), 'HIGH');
    await user.selectOptions(within(form).getByLabelText('Urgency'), 'HIGH');
    expect(within(form).getByRole('status')).toHaveTextContent('P1');
    await user.type(within(form).getByLabelText(/Affected asset ids/), 'not-an-id');
    await user.click(within(form).getByRole('button', { name: 'Open incident' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('"not-an-id" is not an id.');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.clear(within(form).getByLabelText(/Affected asset ids/));
    await user.type(within(form).getByLabelText(/Affected asset ids/), ASSET);
    await user.click(within(form).getByRole('button', { name: 'Open incident' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New incident' })).not.toBeInTheDocument());
    const posted = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(posted).toMatchObject({ title: 'Printer jam', impact: 'HIGH', urgency: 'HIGH', affectedAssetIds: [ASSET], requesterId: ME });
    expect(posted.priority).toBeUndefined();
  });

  it('needs a requester id when the sign-in is not one, shows the service refusal, and can be cancelled', async () => {
    const { impl } = fakeFetch(server({}, (r) => (r.method === 'POST' ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'nope' } } : undefined)));
    renderWithSession(<IncidentsPage />, impl, { organisationId: ORG, executor: 'alice' });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Core switch down' });
    await user.click(screen.getByRole('button', { name: 'New incident' }));
    const form = screen.getByRole('form', { name: 'New incident' });

    await user.type(within(form).getByLabelText('Title'), 'T');
    await user.type(within(form).getByLabelText(/Description/), 'D');
    expect(within(form).getByRole('button', { name: 'Open incident' })).toBeDisabled();
    await user.type(within(form).getByLabelText(/Reported by/), ME);
    await user.click(within(form).getByRole('button', { name: 'Open incident' }));
    expect(await within(form).findByText('ERR-VALIDATION-00400')).toBeInTheDocument();

    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New incident' })).not.toBeInTheDocument();
  });
});

describe('working an incident', () => {
  async function open(initial: Record<string, unknown> = {}, extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server(initial, extra));
    renderWithSession(<IncidentsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Core switch down' }));
    const detail = await screen.findByLabelText('Incident detail');
    return { user, calls, detail };
  }

  it('shows the facts, the links, the SLA and the history, and walks NEW -> ACKNOWLEDGED -> IN_PROGRESS', async () => {
    const { user, calls, detail } = await open();

    expect(within(detail).getByText('No link on floor 3')).toBeInTheDocument();
    expect(within(detail).getByText('HIGH / HIGH')).toBeInTheDocument();
    expect(within(detail).getByText('aaaaaaaa')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Acknowledge' }));
    expect(await within(detail).findByRole('button', { name: 'Start work' })).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname.endsWith('/control/acknowledge'))!.method).toBe('PUT');
    expect(within(detail).getByRole('button', { name: 'Resolve' })).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Start work' }));
    expect(await within(detail).findByRole('button', { name: 'Put on hold' })).toBeInTheDocument();
  });

  it('holds with a reason, resumes, and resolves with a code and notes', async () => {
    const { user, calls, detail } = await open({ status: 'IN_PROGRESS' });

    await user.click(within(detail).getByRole('button', { name: 'Put on hold' }));
    const form = within(detail).getByRole('form', { name: 'Incident action' });
    expect(within(form).getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Why is it on hold?'), 'Waiting for the vendor');
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(await within(detail).findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname.endsWith('/control/hold'))!.body).toEqual({ reason: 'Waiting for the vendor' });

    await user.click(within(detail).getByRole('button', { name: 'Resume' }));
    await within(detail).findByRole('button', { name: 'Resolve' });
    await user.click(within(detail).getByRole('button', { name: 'Resolve' }));
    const resolveForm = within(detail).getByRole('form', { name: 'Incident action' });
    await user.type(within(resolveForm).getByLabelText('Resolution code'), 'REPLACED');
    expect(within(resolveForm).getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.type(within(resolveForm).getByLabelText('Resolution notes'), 'Swapped the switch');
    await user.click(within(resolveForm).getByRole('button', { name: 'Apply' }));
    expect(await within(detail).findByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname.endsWith('/control/resolve'))!.body).toEqual({ resolutionCode: 'REPLACED', notes: 'Swapped the switch' });
  });

  it('reopens a resolved incident with a reason, and can change its mind about an action', async () => {
    const { user, calls, detail } = await open({ status: 'RESOLVED', resolutionCode: 'REPLACED', resolutionNotes: 'Swapped', reopenCount: 1 });

    expect(within(detail).getByText(/reopened 1 time$/)).toBeInTheDocument();
    expect(within(detail).getByText('Swapped', { exact: false })).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Reopen' }));
    await user.click(within(detail).getByRole('button', { name: 'Never mind' }));
    expect(within(detail).queryByRole('form', { name: 'Incident action' })).not.toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Reopen' }));
    await user.type(within(detail).getByLabelText('Why is it reopened?'), 'Still failing');
    await user.click(within(detail).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/control/reopen'))!.body).toEqual({ reason: 'Still failing' }));
  });

  it('changes impact or urgency with a preview of the priority, then shows the re-derived one', async () => {
    const { user, calls, detail } = await open();

    await user.click(within(detail).getByRole('button', { name: 'Change impact or urgency' }));
    const form = within(detail).getByRole('form', { name: 'Incident action' });
    await user.selectOptions(within(form).getByLabelText('Impact'), 'LOW');
    expect(within(form).getByRole('status')).toHaveTextContent('P3');
    await user.selectOptions(within(form).getByLabelText('Urgency'), 'LOW');
    expect(within(form).getByRole('status')).toHaveTextContent('P4');
    await user.click(within(form).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/update'))!.body).toMatchObject({ impact: 'LOW', urgency: 'LOW', title: 'Core switch down', affectedAssetIds: [ASSET] }));
    expect(await within(detail).findByText('P3')).toBeInTheDocument();
  });

  it('assigns by user id (only a real id is accepted) and cancels', async () => {
    const { user, calls, detail } = await open();
    const assign = within(detail).getByRole('form', { name: 'Assign' });

    await user.type(within(assign).getByLabelText('Assignee (user id)'), 'bob');
    expect(within(assign).getByRole('button', { name: 'Assign' })).toBeDisabled();
    await user.clear(within(assign).getByLabelText('Assignee (user id)'));
    await user.type(within(assign).getByLabelText('Assignee (user id)'), ME);
    await user.click(within(assign).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/assignment/update'))!.body).toEqual({ assigneeId: ME }));

    await user.click(within(detail).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(detail).queryByRole('form', { name: 'Assign' })).not.toBeInTheDocument());
    expect(within(detail).queryByRole('form', { name: 'Add comment' })).not.toBeInTheDocument();
  });

  it('adds public and internal comments, flagging the internal ones', async () => {
    const { user, calls, detail } = await open({ comments: [{ commentId: 'c0', author: ME, text: 'Seen', internal: false, createdAt: '2026-10-04T10:30:00Z' }] });
    const form = within(detail).getByRole('form', { name: 'Add comment' });

    expect(within(detail).getByText('Seen')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add comment' })).toBeDisabled();
    await user.type(within(form).getByLabelText(/^Comment/), 'Vendor on leave');
    await user.click(within(form).getByLabelText('Internal note (staff only)'));
    await user.click(within(form).getByRole('button', { name: 'Add comment' }));

    expect(await within(detail).findByText('internal')).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname.endsWith('/comment/initiate'))!.body).toEqual({ text: 'Vendor on leave', internal: true });
  });

  it('shows a refused action as it comes back, and offers no actions on a closed incident', async () => {
    const refused = await open({}, (r) => (r.url.pathname.endsWith('/control/acknowledge') ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-INC-00409', detail: 'changed' } } : undefined));
    await refused.user.click(within(refused.detail).getByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByText('ERR-INC-00409')).toBeInTheDocument();
  });

  it('hides the history from a requester (403 on the audit trail) and shows the rest', async () => {
    const { detail } = await open({}, (r) => (r.url.pathname.endsWith('/audit-log/retrieve') ? { status: 403, body: { title: 'Forbidden', error_code: 'ERR-INC-00403' } } : undefined));

    expect(within(detail).queryByText('History')).not.toBeInTheDocument();
    expect(within(detail).getByText('No link on floor 3')).toBeInTheDocument();
  });

  it('shows a real failure of the audit trail, and a closed or cancelled incident with nothing to do', async () => {
    const failing = await open({}, (r) => (r.url.pathname.endsWith('/audit-log/retrieve') ? { status: 500, body: { title: 'Boom' } } : undefined));
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    await failing.user.click(within(failing.detail).getByRole('button', { name: 'Close' }));

    const closed = await open({ status: 'CLOSED', response: undefined, resolution: undefined });
    expect(within(closed.detail).queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(within(closed.detail).queryByRole('form', { name: 'Add comment' })).not.toBeInTheDocument();
  });
});

describe('the app', () => {
  it('has Incidents in the navigation and opens it', async () => {
    const { impl } = fakeFetch(() => ({ body: [] }));
    renderWithSession(<App />, impl, me, '/incidents');

    expect(await screen.findByRole('heading', { name: 'Incidents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Incidents' })).toBeInTheDocument();
  });
});

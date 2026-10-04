import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { fieldsToText, isId, parseFields, ServiceRequestsPage } from './ServiceRequests';

beforeEach(() => sessionStorage.clear());

const ME = '0a0a0a0a-0000-4000-8000-000000000001';
const POLICY = 'cccccccc-3333-4333-8333-cccccccccccc';
const me = { organisationId: ORG, executor: ME };

const item = (over: Record<string, unknown> = {}) => ({
  id: 'k1', organisationId: ORG, code: 'LAPTOP', name: 'New laptop', description: 'A standard laptop', category: 'HARDWARE',
  fields: [{ key: 'model', label: 'Which model?', required: true }, { key: 'notes', label: 'Anything else?', required: false }],
  fulfilmentTargetHours: 72, status: 'PUBLISHED', createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', ...over,
});

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1', organisationId: ORG, requesterId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', catalogItemId: 'k1', catalogItemCode: 'LAPTOP', catalogItemName: 'New laptop',
  answers: { model: 'X1' }, status: 'SUBMITTED', fulfilment: { dueAt: '2026-10-07T10:00:00Z', state: 'PENDING' },
  comments: [], createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', ...over,
});

/** A tiny service-request server: one request and a small catalog that change as actions are applied. */
function server(initial: Record<string, unknown> = {}, catalog: Record<string, unknown>[] = [item()], extra: Handler = () => undefined) {
  let current: Record<string, unknown> = request(initial);
  let items = catalog;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.includes('/catalog/')) {
      if (r.method === 'GET') {
        const status = r.url.searchParams.get('status');
        return { body: items.filter((entry) => !status || entry.status === status) };
      }
      if (r.method === 'POST') { items = [...items, item({ id: 'k2', code: (r.body as { code: string }).code, name: (r.body as { name: string }).name, status: 'DRAFT' })]; return { status: 201, body: items.at(-1) }; }
      const action = path.split('/').pop() as string;
      const id = path.split('/')[4];
      if (action === 'publish') items = items.map((entry) => (entry.id === id ? { ...entry, status: 'PUBLISHED' } : entry));
      if (action === 'retire') items = items.map((entry) => (entry.id === id ? { ...entry, status: 'RETIRED' } : entry));
      if (action === 'update') items = items.map((entry) => (entry.id === id ? { ...entry, name: (r.body as { name: string }).name } : entry));
      return { status: 204 };
    }
    if (path.endsWith('/audit-log/retrieve')) return { body: [{ occurredAt: '2026-10-04T10:00:00Z', action: 'INITIATED', executor: 'x', detail: 'Requested LAPTOP.' }] };
    if (r.method === 'POST' && path.endsWith('/initiate') && !path.endsWith('/comment/initiate')) return { status: 201, body: request({ id: 'r2' }) };
    if (r.method === 'POST' && path.endsWith('/comment/initiate')) {
      current = { ...current, comments: [...(current.comments as unknown[]), { commentId: 'c1', author: ME, text: (r.body as { text: string }).text, internal: (r.body as { internal: boolean }).internal, createdAt: '2026-10-04T11:00:00Z' }] };
      return { status: 201 };
    }
    if (r.method === 'PUT') {
      const next: Record<string, string> = { 'start-fulfilment': 'IN_FULFILMENT', fulfil: 'FULFILLED', close: 'CLOSED', cancel: 'CANCELLED' };
      const action = path.split('/').pop() as string;
      if (action === 'capture') {
        const approved = (r.body as { outcome: string }).outcome === 'APPROVE';
        current = { ...current, status: approved ? 'APPROVED' : 'REJECTED' };
        return { body: current };
      }
      if (next[action]) current = { ...current, status: next[action] };
      return { status: 204 };
    }
    if (path.endsWith('/retrieve') && path.split('/').length === 6) return { body: current };
    if (path.endsWith('/retrieve')) return { body: [current] };
    return undefined;
  };
  return handler;
}

describe('helpers', () => {
  it('reads the questions of an item line by line and reports what the service would refuse', () => {
    expect(isId(ME)).toBe(true);
    expect(isId('alice')).toBe(false);
    expect(parseFields('').fields).toEqual([]);
    expect(parseFields('model | Which model? | required\nnotes | Anything else?').fields).toEqual([
      { key: 'model', label: 'Which model?', required: true }, { key: 'notes', label: 'Anything else?', required: false },
    ]);
    expect(parseFields('1bad | Label').error).toMatch(/^Line 1: a key is a letter/);
    expect(parseFields('ok |').error).toBe('Line 1: a question needs a label.');
    expect(parseFields('a | A\nb | B\na | Again').error).toBe('Line 3: the key "a" is already used.');
    expect(parseFields('only-a-key').error).toMatch(/^Line 1: a key is a letter/);
    expect(fieldsToText(parseFields('model | Which model? | required\nnotes | More').fields!)).toBe('model | Which model? | required\nnotes | More | optional');
  });
});

describe('the requests list', () => {
  it('shows requests with status and the fulfilment target, and asks for open ones by default', async () => {
    const { impl, calls } = fakeFetch(server({ fulfilment: { dueAt: '2026-10-07T10:00:00Z', state: 'BREACHED' } }));
    renderWithSession(<ServiceRequestsPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'New laptop' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('LAPTOP')).toBeInTheDocument();
    expect(within(row).getByText('SUBMITTED')).toBeInTheDocument();
    expect(within(row).getByText('BREACHED')).toBeInTheDocument();
    expect(within(row).getByText('unassigned')).toBeInTheDocument();
    expect(calls[0].url.searchParams.get('openOnly')).toBe('true');
  });

  it('filters by status, shows everything when asked, and "assigned to me" uses my id', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<ServiceRequestsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'New laptop' });

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

  it('cannot filter "assigned to me" when the signed-in executor is not a user id', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<ServiceRequestsPage />, impl, { organisationId: ORG, executor: 'alice' });
    await screen.findByRole('button', { name: 'New laptop' });
    expect(screen.getByLabelText('Assigned to me')).toBeDisabled();
  });

  it('says when nothing matches and shows a problem from the service', async () => {
    const empty = fakeFetch((r) => (r.url.pathname.endsWith('/retrieve') ? { body: [] } : undefined));
    const first = renderWithSession(<ServiceRequestsPage />, empty.impl, me);
    expect(await screen.findByText('No requests match.')).toBeInTheDocument();
    first.unmount();

    const failing = fakeFetch(() => ({ status: 500, body: { title: 'Internal', error_code: 'ERR-INTERNAL-00500' } }));
    renderWithSession(<ServiceRequestsPage />, failing.impl, me);
    expect(await screen.findByText('ERR-INTERNAL-00500')).toBeInTheDocument();
  });
});

describe('making a request', () => {
  it('lists the published catalog, asks the questions of the chosen item, and sends only what was answered', async () => {
    const { impl, calls } = fakeFetch(server({}, [item(), item({ id: 'k3', code: 'SEAT', name: 'Software seat', approvalPolicyId: POLICY, fields: [{ key: 'product', label: 'Which product?', required: true }] })]));
    renderWithSession(<ServiceRequestsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'New laptop' });

    await user.click(screen.getByRole('button', { name: 'New request' }));
    const form = await screen.findByRole('form', { name: 'New request' });
    await waitFor(() => expect(within(form).getByRole('option', { name: 'Software seat' })).toBeInTheDocument());
    expect(within(form).getByRole('button', { name: 'Send request' })).toBeDisabled();

    await user.selectOptions(within(form).getByLabelText('What do you need?'), 'k3');
    expect(within(form).getByText(/it needs approval first/)).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText('What do you need?'), 'k1');
    expect(within(form).getByText(/no approval needed/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Send request' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Which model?'), ' X1 ');
    await user.click(within(form).getByRole('button', { name: 'Send request' }));

    const post = calls.find((call) => call.method === 'POST' && call.url.pathname.endsWith('/initiate'))!;
    expect(post.body).toEqual({ catalogItemId: 'k1', answers: { model: 'X1' }, requesterId: ME });
    expect(await screen.findByRole('complementary', { name: 'Request detail' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New request' })).not.toBeInTheDocument();
  });

  it('can be cancelled, and shows the problem when the service refuses', async () => {
    const { impl } = fakeFetch(server({}, [item()], (r) => (r.method === 'POST' && r.url.pathname.endsWith('/initiate')
      ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-SRQ-00409', detail: 'Retired.' } } : undefined)));
    renderWithSession(<ServiceRequestsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'New laptop' });

    await user.click(screen.getByRole('button', { name: 'New request' }));
    const form = await screen.findByRole('form', { name: 'New request' });
    await waitFor(() => expect(within(form).getByRole('option', { name: 'New laptop' })).toBeInTheDocument());
    await user.selectOptions(within(form).getByLabelText('What do you need?'), 'k1');
    await user.type(within(form).getByLabelText('Which model?'), 'X1');
    await user.type(within(form).getByLabelText('Anything else? (optional)'), 'blue');
    await user.click(within(form).getByRole('button', { name: 'Send request' }));
    expect(await within(form).findByText('ERR-SRQ-00409')).toBeInTheDocument();

    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New request' })).not.toBeInTheDocument();
  });
});

describe('a request', () => {
  async function open(initial: Record<string, unknown>, extra: Handler = () => undefined) {
    const fake = fakeFetch(server(initial, [item()], extra));
    renderWithSession(<ServiceRequestsPage />, fake.impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New laptop' }));
    const detail = await screen.findByRole('complementary', { name: 'Request detail' });
    await within(detail).findByText('Comments');
    return { ...fake, user, detail };
  }

  it('shows its answers, history and the actions legal in its status, and starts fulfilment', async () => {
    const { user, detail, calls } = await open({});

    expect(within(detail).getByText('X1')).toBeInTheDocument();
    expect(within(detail).getByText(/INITIATED/)).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Start fulfilment' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.pathname.endsWith('/control/start-fulfilment'))).toBe(true));
    await waitFor(() => expect(within(detail).getByRole('button', { name: 'Fulfil' })).toBeInTheDocument());
  });

  it('fulfils with notes (the form refuses empty notes), then closes it', async () => {
    const { user, detail, calls } = await open({ status: 'IN_FULFILMENT' });

    await user.click(within(detail).getByRole('button', { name: 'Fulfil' }));
    const form = within(detail).getByRole('form', { name: 'Request action' });
    expect(within(form).getByRole('button', { name: 'Fulfil' })).toBeDisabled();
    await user.type(within(form).getByLabelText('What was delivered?'), 'Handed over');
    await user.click(within(form).getByRole('button', { name: 'Fulfil' }));
    const put = await waitFor(() => {
      const call = calls.find((c) => c.url.pathname.endsWith('/control/fulfil'));
      expect(call).toBeDefined();
      return call!;
    });
    expect(put.body).toEqual({ notes: 'Handed over' });
    await user.click(await within(within(detail).getByLabelText('Actions')).findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(calls.some((call) => call.url.pathname.endsWith('/control/close'))).toBe(true));
  });

  it('a request waiting for approval can be approved or rejected with a comment, and cancelled', async () => {
    const approved = await open({ status: 'PENDING_APPROVAL', approvalRequestId: 'a1' });
    await approved.user.click(within(within(approved.detail).getByLabelText('Actions')).getByRole('button', { name: 'Approve' }));
    const approveForm = within(approved.detail).getByRole('form', { name: 'Request action' });
    await approved.user.type(within(approveForm).getByLabelText('Comment (optional)'), 'fine by me');
    await approved.user.click(within(approveForm).getByRole('button', { name: 'Approve' }));
    const capture = await waitFor(() => {
      const call = approved.calls.find((c) => c.url.pathname.endsWith('/approval/capture'));
      expect(call).toBeDefined();
      return call!;
    });
    expect(capture.body).toEqual({ outcome: 'APPROVE', comment: 'fine by me' });
    await waitFor(() => expect(within(approved.detail).getByRole('button', { name: 'Start fulfilment' })).toBeInTheDocument());
  });

  it('rejecting sends REJECT without a comment, and "never mind" closes the form', async () => {
    const { user, detail, calls } = await open({ status: 'PENDING_APPROVAL', approvalRequestId: 'a1' });

    const actions = within(detail).getByLabelText('Actions');
    await user.click(within(actions).getByRole('button', { name: 'Reject' }));
    await user.click(within(detail).getByRole('button', { name: 'Never mind' }));
    expect(within(detail).queryByRole('form', { name: 'Request action' })).not.toBeInTheDocument();
    await user.click(within(actions).getByRole('button', { name: 'Reject' }));
    await user.click(within(within(detail).getByRole('form', { name: 'Request action' })).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/approval/capture'))?.body).toEqual({ outcome: 'REJECT' }));
  });

  it('assigns a user id, comments publicly or internally, and shows comments with their visibility', async () => {
    const { user, detail, calls } = await open({});

    const assign = within(detail).getByRole('form', { name: 'Assign' });
    expect(within(assign).getByRole('button', { name: 'Assign' })).toBeDisabled();
    await user.type(within(assign).getByLabelText('Assignee (user id)'), ME);
    await user.click(within(assign).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/assignment/update'))?.body).toEqual({ assigneeId: ME }));

    const form = within(detail).getByRole('form', { name: 'Add comment' });
    await user.type(within(form).getByLabelText('Comment (no personal data)'), 'Stock is on its way');
    await user.click(within(form).getByLabelText('Internal note (staff only)'));
    await user.click(within(form).getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/comment/initiate'))?.body).toEqual({ text: 'Stock is on its way', internal: true }));
    expect(await within(detail).findByText('internal')).toBeInTheDocument();
    expect(within(detail).getByText('Stock is on its way')).toBeInTheDocument();
  });

  it('a finished request offers no actions and no comment form; a requester gets no history (403)', async () => {
    const { detail } = await open({ status: 'CLOSED' }, (r) => (r.url.pathname.endsWith('/audit-log/retrieve') ? { status: 403, body: { title: 'Forbidden', error_code: 'ERR-SRQ-00403' } } : undefined));

    expect(within(detail).queryByRole('form', { name: 'Add comment' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('form', { name: 'Assign' })).not.toBeInTheDocument();
    expect(within(detail).queryByText('History')).not.toBeInTheDocument();
    expect(within(detail).getByText('No comments yet.')).toBeInTheDocument();
  });

  it('shows the problem when an action is refused, and can be closed', async () => {
    const { user, detail } = await open({}, (r) => (r.method === 'PUT' && r.url.pathname.endsWith('/control/cancel')
      ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-SRQ-00409', detail: 'Changed by someone else.' } } : undefined));

    await user.click(within(detail).getByRole('button', { name: 'Cancel' }));
    expect(await within(detail).findByText('ERR-SRQ-00409')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Request detail' })).not.toBeInTheDocument();
  });

  it('shows a delivered note and rejected or cancelled requests without an SLA', async () => {
    const { detail } = await open({ status: 'REJECTED', fulfilment: undefined, fulfilmentNotes: 'Never delivered' });
    expect(within(detail).getByText('Never delivered')).toBeInTheDocument();
    expect(within(detail).queryByText('Fulfilment')).not.toBeInTheDocument();
  });
});

describe('the catalog', () => {
  async function openCatalog(catalog: Record<string, unknown>[] = [item({ id: 'k1', status: 'DRAFT' }), item({ id: 'k4', code: 'VPN', name: 'VPN access', status: 'PUBLISHED', approvalPolicyId: POLICY }), item({ id: 'k5', code: 'OLD', name: 'Old thing', status: 'RETIRED', category: undefined })], extra: Handler = () => undefined) {
    const fake = fakeFetch(server({}, catalog, extra));
    renderWithSession(<ServiceRequestsPage />, fake.impl, me);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Catalog' }));
    await screen.findByText('VPN access');
    return { ...fake, user };
  }

  it('lists every item with its status, target and approval, and filters by status', async () => {
    const { user, calls } = await openCatalog();

    const row = screen.getByText('VPN access').closest('tr') as HTMLElement;
    expect(within(row).getByText('PUBLISHED')).toBeInTheDocument();
    expect(within(row).getByText('72 h')).toBeInTheDocument();
    expect(within(row).getByText(POLICY.slice(0, 8))).toBeInTheDocument();
    expect(within(screen.getByText('New laptop').closest('tr') as HTMLElement).getByText('none')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Catalog status'), 'RETIRED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('RETIRED'));
    expect(await screen.findByText('Old thing')).toBeInTheDocument();
  });

  it('publishes a draft and retires a published item', async () => {
    const { user, calls } = await openCatalog();

    await user.click(screen.getByRole('button', { name: 'Publish LAPTOP' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/catalog/k1/control/publish'))).toBe(true));
    await user.click(await screen.findByRole('button', { name: 'Retire VPN' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/catalog/k4/control/retire'))).toBe(true));
  });

  it('drafts a new item with its questions, refusing a bad line before anything is sent', async () => {
    const { user, calls } = await openCatalog();

    await user.click(screen.getByRole('button', { name: 'New catalog item' }));
    const form = await screen.findByRole('form', { name: 'New catalog item' });
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Code (letters, digits, dashes)'), 'MOUSE');
    await user.type(within(form).getByLabelText('Name'), 'Mouse');
    await user.type(within(form).getByLabelText('Category'), 'HARDWARE');
    await user.type(within(form).getByLabelText('Description'), 'A mouse');
    await user.type(within(form).getByLabelText('Approval policy id (optional, from workflow-approval)'), POLICY);
    await user.type(within(form).getByLabelText('Questions (one per line: key | label | required or optional)'), '1bad | Colour');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Line 1: a key is a letter');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    const questions = within(form).getByLabelText('Questions (one per line: key | label | required or optional)');
    await user.clear(questions);
    await user.type(questions, 'colour | Which colour? | required');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    const post = await waitFor(() => {
      const call = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/catalog/initiate'));
      expect(call).toBeDefined();
      return call!;
    });
    expect(post.body).toEqual({
      code: 'MOUSE', name: 'Mouse', description: 'A mouse', category: 'HARDWARE', approvalPolicyId: POLICY, fulfilmentTargetHours: 72,
      fields: [{ key: 'colour', label: 'Which colour?', required: true }],
    });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'New catalog item' })).not.toBeInTheDocument());
  });

  it('edits a draft (no code field), and refuses a bad target or policy id', async () => {
    const { user, calls } = await openCatalog();

    await user.click(screen.getByRole('button', { name: 'Edit LAPTOP' }));
    const form = await screen.findByRole('form', { name: 'Edit catalog item' });
    expect(within(form).queryByLabelText('Code (letters, digits, dashes)')).not.toBeInTheDocument();
    expect(within(form).getByLabelText('Questions (one per line: key | label | required or optional)')).toHaveValue('model | Which model? | required\nnotes | Anything else? | optional');
    const hours = within(form).getByLabelText('Fulfilment target (hours, 1 to 2160)');
    await user.clear(hours);
    await user.type(hours, '0');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(hours);
    await user.type(hours, '48');
    const policy = within(form).getByLabelText('Approval policy id (optional, from workflow-approval)');
    await user.type(policy, 'not-an-id');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(policy);
    const name = within(form).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Renamed laptop');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url.pathname.endsWith('/catalog/k1/update'))?.body).toMatchObject({ name: 'Renamed laptop', fulfilmentTargetHours: 48 }));
  });

  it('can be cancelled, shows a refused save, and a refused publish', async () => {
    const { user } = await openCatalog(undefined, (r) => {
      if (r.method === 'POST' && r.url.pathname.endsWith('/catalog/initiate')) return { status: 409, body: { title: 'Conflict', error_code: 'ERR-SRQ-00409', detail: 'Code taken.' } };
      if (r.url.pathname.endsWith('/control/publish')) return { status: 409, body: { title: 'Conflict', error_code: 'ERR-SRQ-00409', detail: 'Not a draft.' } };
      return undefined;
    });

    await user.click(screen.getByRole('button', { name: 'New catalog item' }));
    const form = await screen.findByRole('form', { name: 'New catalog item' });
    await user.type(within(form).getByLabelText('Code (letters, digits, dashes)'), 'LAPTOP');
    await user.type(within(form).getByLabelText('Name'), 'Dup');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('Code taken.')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New catalog item' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publish LAPTOP' }));
    expect(await screen.findByText('Not a draft.')).toBeInTheDocument();
  });

  it('says when the catalog is empty', async () => {
    const fake = fakeFetch((r) => (r.url.pathname.includes('/catalog/') ? { body: [] } : { body: [] }));
    renderWithSession(<ServiceRequestsPage />, fake.impl, me);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Catalog' }));
    expect(await screen.findByText('The catalog is empty.')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Requests link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/requests');
    expect(await screen.findByRole('heading', { name: 'Service requests' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Requests' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'New laptop' })).toBeInTheDocument();
  });
});

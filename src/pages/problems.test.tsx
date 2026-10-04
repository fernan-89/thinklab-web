import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { ProblemsPage } from './Problems';

beforeEach(() => sessionStorage.clear());

const ME = '0a0a0a0a-0000-4000-8000-000000000001';
const INCIDENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ASSET = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const me = { organisationId: ORG, executor: ME };

const problem = (over: Record<string, unknown> = {}) => ({
  id: 'p1', organisationId: ORG, title: 'Switch drops packets', description: 'Intermittent loss on floor 3', priority: 'P2', status: 'NEW',
  relatedIncidentIds: [INCIDENT], relatedChangeIds: [], affectedAssetIds: [ASSET], reopenCount: 0, comments: [],
  createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', ...over,
});

/** A tiny problem server: one problem that changes as actions are applied. */
function server(initial: Record<string, unknown> = {}, extra: Handler = () => undefined) {
  let current: Record<string, unknown> = problem(initial);
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: [{ occurredAt: '2026-10-04T10:00:00Z', action: 'INITIATED', executor: 'x', detail: 'Problem opened with priority P2.' }] };
    if (r.method === 'POST' && path.endsWith('/initiate') && !path.endsWith('/comment/initiate')) return { status: 201, body: problem({ id: 'p2', title: (r.body as { title: string }).title }) };
    if (r.method === 'POST' && path.endsWith('/comment/initiate')) {
      current = { ...current, comments: [...(current.comments as unknown[]), { commentId: 'c1', author: ME, text: (r.body as { text: string }).text, createdAt: '2026-10-04T11:00:00Z' }] };
      return { status: 201 };
    }
    if (r.method === 'PUT') {
      const next: Record<string, string> = { investigate: 'UNDER_INVESTIGATION', 'known-error': 'KNOWN_ERROR', resolve: 'RESOLVED', close: 'CLOSED', reopen: 'UNDER_INVESTIGATION', cancel: 'CANCELLED' };
      const action = path.split('/').pop() as string;
      if (next[action]) current = { ...current, status: next[action] };
      if (path.endsWith('/assignment/update')) {
        current = { ...current, assigneeId: (r.body as { assigneeId: string }).assigneeId };
        return { status: 204 };
      }
      if (path.endsWith('/analysis/update')) {
        const body = r.body as { rootCause?: string; workaround?: string };
        current = { ...current, rootCause: body.rootCause ?? current.rootCause, workaround: body.workaround ?? current.workaround };
      }
      if (action === 'update' && !path.endsWith('/analysis/update')) current = { ...current, priority: (r.body as { priority: string }).priority };
      return { status: 204 };
    }
    if (path.endsWith('/retrieve') && path.split('/').length === 6) return { body: current };
    if (path.endsWith('/retrieve')) return { body: [current] };
    return undefined;
  };
  return handler;
}

describe('the list', () => {
  it('shows problems with priority, status and how many incidents they explain, and asks for open ones by default', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<ProblemsPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Switch drops packets' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('P2')).toBeInTheDocument();
    expect(within(row).getByText('NEW')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();
    expect(within(row).getByText('unassigned')).toBeInTheDocument();
    expect(calls[0].url.searchParams.get('openOnly')).toBe('true');
  });

  it('filters by status, priority and the incident it explains, shows everything when asked, and "assigned to me" uses my id', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<ProblemsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Switch drops packets' });

    await user.selectOptions(screen.getByLabelText('Priority'), 'P1');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('priority')).toBe('P1'));
    await user.selectOptions(screen.getByLabelText('Status'), 'CLOSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('CLOSED'));
    expect(calls.at(-1)!.url.searchParams.get('openOnly')).toBeNull();
    expect(screen.getByLabelText('Open only')).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await user.type(screen.getByLabelText('Explains incident'), 'not an id');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('incidentId')).toBeNull());
    await user.clear(screen.getByLabelText('Explains incident'));
    await user.type(screen.getByLabelText('Explains incident'), INCIDENT);
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('incidentId')).toBe(INCIDENT));
    await user.click(screen.getByLabelText('Open only'));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('openOnly')).toBeNull());
    await user.click(screen.getByLabelText('Assigned to me'));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('assigneeId')).toBe(ME));
  });

  it('cannot filter "assigned to me" without a user id, says when nothing matches and shows a problem from the service', async () => {
    const empty = fakeFetch((r) => (r.url.pathname.endsWith('/retrieve') ? { body: [] } : undefined));
    const first = renderWithSession(<ProblemsPage />, empty.impl, { organisationId: ORG, executor: 'alice' });
    expect(await screen.findByText('No problems match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Assigned to me')).toBeDisabled();
    first.unmount();

    const failing = fakeFetch(() => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-PRB-00403' } }));
    renderWithSession(<ProblemsPage />, failing.impl, me);
    expect(await screen.findByText('ERR-PRB-00403')).toBeInTheDocument();
  });
});

describe('opening a problem', () => {
  it('sends the priority the analyst chose and the links as lists of ids', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<ProblemsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Switch drops packets' });

    await user.click(screen.getByRole('button', { name: 'New problem' }));
    const form = await screen.findByRole('form', { name: 'New problem' });
    expect(within(form).getByRole('button', { name: 'Open problem' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Title'), '  Core router reboots ');
    await user.type(within(form).getByLabelText('Description (no personal data)'), 'Twice a week');
    await user.selectOptions(within(form).getByLabelText('Priority'), 'P1');
    await user.type(within(form).getByLabelText('Incidents it explains (ids, optional, separate with spaces or commas)'), `${INCIDENT}, nope`);
    await user.click(within(form).getByRole('button', { name: 'Open problem' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('"nope" is not an id.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    const incidents = within(form).getByLabelText('Incidents it explains (ids, optional, separate with spaces or commas)');
    await user.clear(incidents);
    await user.type(incidents, INCIDENT);
    await user.type(within(form).getByLabelText('Affected assets (ids, optional)'), ASSET);
    await user.click(within(form).getByRole('button', { name: 'Open problem' }));

    const post = await waitFor(() => {
      const call = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/initiate'));
      expect(call).toBeDefined();
      return call!;
    });
    expect(post.body).toEqual({ title: 'Core router reboots', description: 'Twice a week', priority: 'P1', relatedIncidentIds: [INCIDENT], relatedChangeIds: [], affectedAssetIds: [ASSET] });
    expect(await screen.findByRole('complementary', { name: 'Problem detail' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New problem' })).not.toBeInTheDocument();
  });

  it('can be cancelled and shows the problem when the service refuses', async () => {
    const { impl } = fakeFetch(server({}, (r) => (r.method === 'POST' && r.url.pathname.endsWith('/initiate')
      ? { status: 403, body: { title: 'Forbidden', error_code: 'ERR-PRB-00403', detail: 'Staff only.' } } : undefined)));
    renderWithSession(<ProblemsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Switch drops packets' });

    await user.click(screen.getByRole('button', { name: 'New problem' }));
    const form = await screen.findByRole('form', { name: 'New problem' });
    await user.type(within(form).getByLabelText('Title'), 'T');
    await user.type(within(form).getByLabelText('Description (no personal data)'), 'D');
    await user.click(within(form).getByRole('button', { name: 'Open problem' }));
    expect(await within(form).findByText('ERR-PRB-00403')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New problem' })).not.toBeInTheDocument();
  });
});

describe('a problem', () => {
  async function open(initial: Record<string, unknown>, extra: Handler = () => undefined) {
    const fake = fakeFetch(server(initial, extra));
    renderWithSession(<ProblemsPage />, fake.impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Switch drops packets' }));
    const detail = await screen.findByRole('complementary', { name: 'Problem detail' });
    await within(detail).findByText('History');
    return { ...fake, user, detail };
  }
  const actionsOf = (detail: HTMLElement) => within(detail).getByLabelText('Actions');

  it('shows its links, what is not known yet and its history, and starts the investigation', async () => {
    const { user, detail, calls } = await open({});

    expect(within(detail).getByText('not known yet')).toBeInTheDocument();
    expect(within(detail).getByText('none yet')).toBeInTheDocument();
    expect(within(detail).getByText(INCIDENT.slice(0, 8))).toBeInTheDocument();
    expect(within(detail).getByText(/INITIATED/)).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Record analysis' })).not.toBeInTheDocument();
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Start investigation' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/investigate'))).toBe(true));
    await waitFor(() => expect(within(actionsOf(detail)).getByRole('button', { name: 'Record analysis' })).toBeInTheDocument());
  });

  it('records the analysis (at least one field), declares the known error and shows the cause and workaround', async () => {
    const { user, detail, calls } = await open({ status: 'UNDER_INVESTIGATION' });

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Record analysis' }));
    const form = within(detail).getByRole('form', { name: 'Problem action' });
    expect(within(form).getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Root cause'), 'Firmware 2.1 leaks buffers');
    await user.type(within(form).getByLabelText('Workaround'), 'Reboot every Sunday');
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/analysis/update'))?.body).toEqual({ rootCause: 'Firmware 2.1 leaks buffers', workaround: 'Reboot every Sunday' }));
    expect(await within(detail).findByText('Firmware 2.1 leaks buffers')).toBeInTheDocument();
    expect(within(detail).getByText('Reboot every Sunday')).toBeInTheDocument();

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Declare known error' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/control/known-error'))).toBe(true));
    await waitFor(() => expect(within(detail).getAllByText('KNOWN ERROR').length).toBeGreaterThan(0));
  });

  it('records only a workaround when the root cause is left empty, and the form is prefilled from what is known', async () => {
    const { user, detail, calls } = await open({ status: 'KNOWN_ERROR', rootCause: 'Bad firmware', workaround: 'Reboot' });

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Record analysis' }));
    const form = within(detail).getByRole('form', { name: 'Problem action' });
    expect(within(form).getByLabelText('Root cause')).toHaveValue('Bad firmware');
    await user.clear(within(form).getByLabelText('Root cause'));
    await user.clear(within(form).getByLabelText('Workaround'));
    expect(within(form).getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Workaround'), 'Reboot weekly');
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/analysis/update'))?.body).toEqual({ workaround: 'Reboot weekly' }));
  });

  it('resolves with the permanent fix (required), then closes it; a resolved problem can be reopened with a reason', async () => {
    const resolving = await open({ status: 'KNOWN_ERROR', rootCause: 'Bad firmware', workaround: 'Reboot' });
    await resolving.user.click(within(actionsOf(resolving.detail)).getByRole('button', { name: 'Resolve' }));
    const form = within(resolving.detail).getByRole('form', { name: 'Problem action' });
    expect(within(form).getByRole('button', { name: 'Apply' })).toBeDisabled();
    await resolving.user.type(within(form).getByLabelText('Permanent fix'), 'Upgraded to 2.2');
    await resolving.user.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(resolving.calls.find((c) => c.url.pathname.endsWith('/control/resolve'))?.body).toEqual({ resolution: 'Upgraded to 2.2' }));
    await resolving.user.click(await within(actionsOf(resolving.detail)).findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(resolving.calls.some((c) => c.url.pathname.endsWith('/control/close'))).toBe(true));
  });

  it('reopens a resolved problem with a reason', async () => {
    const { user, detail, calls } = await open({ status: 'RESOLVED', resolution: 'Upgraded', rootCause: 'Bad firmware', reopenCount: 1 });

    expect(within(detail).getByText('reopened 1 time')).toBeInTheDocument();
    expect(within(detail).getByText('Upgraded')).toBeInTheDocument();
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Reopen' }));
    const form = within(detail).getByRole('form', { name: 'Problem action' });
    expect(within(form).getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Why is it reopened?'), 'Still failing');
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/control/reopen'))?.body).toEqual({ reason: 'Still failing' }));
  });

  it('changes the priority keeping the rest, and "never mind" closes the form', async () => {
    const { user, detail, calls } = await open({});

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Change priority' }));
    await user.click(within(detail).getByRole('button', { name: 'Never mind' }));
    expect(within(detail).queryByRole('form', { name: 'Problem action' })).not.toBeInTheDocument();
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Change priority' }));
    const form = within(detail).getByRole('form', { name: 'Problem action' });
    expect(within(form).getByLabelText('Priority')).toHaveValue('P2');
    await user.selectOptions(within(form).getByLabelText('Priority'), 'P1');
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/update'))?.body).toEqual({
      title: 'Switch drops packets', description: 'Intermittent loss on floor 3', priority: 'P1', relatedIncidentIds: [INCIDENT], relatedChangeIds: [], affectedAssetIds: [ASSET],
    }));
  });

  it('assigns a user id and adds comments, which are shown', async () => {
    const { user, detail, calls } = await open({});

    const assign = within(detail).getByRole('form', { name: 'Assign' });
    expect(within(assign).getByRole('button', { name: 'Assign' })).toBeDisabled();
    await user.type(within(assign).getByLabelText('Assignee (user id)'), ME);
    await user.click(within(assign).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/assignment/update'))?.body).toEqual({ assigneeId: ME }));

    const form = within(detail).getByRole('form', { name: 'Add comment' });
    await user.type(within(form).getByLabelText('Comment (no personal data)'), 'Vendor confirmed the leak');
    await user.click(within(form).getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/comment/initiate'))?.body).toEqual({ text: 'Vendor confirmed the leak' }));
    expect(await within(detail).findByText('Vendor confirmed the leak')).toBeInTheDocument();
  });

  it('a closed problem offers no actions, no assignment and no comment form', async () => {
    const { detail } = await open({ status: 'CLOSED' });

    expect(within(detail).queryByRole('form', { name: 'Add comment' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('form', { name: 'Assign' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Change priority' })).not.toBeInTheDocument();
    expect(within(detail).getByText('No comments yet.')).toBeInTheDocument();
  });

  it('shows the problem when an action is refused, and can be closed', async () => {
    const { user, detail } = await open({}, (r) => (r.method === 'PUT' && r.url.pathname.endsWith('/control/cancel')
      ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-PRB-00409', detail: 'Changed by someone else.' } } : undefined));

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Cancel' }));
    expect(await within(detail).findByText('ERR-PRB-00409')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Problem detail' })).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Problems link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/problems');
    expect(await screen.findByRole('heading', { name: 'Problems' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Problems' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Switch drops packets' })).toBeInTheDocument();
  });
});

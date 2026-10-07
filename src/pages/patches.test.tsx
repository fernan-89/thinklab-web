import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { PatchesPage } from './Patches';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const policy = (over: Record<string, unknown> = {}) => ({
  id: 'p1', organisationId: ORG, name: 'Servers', assetId: 'a1', criticalDays: 2, highDays: 7, mediumDays: 30, lowDays: 90, status: 'ACTIVE', compliance: 'COMPLIANT',
  openFindings: 1, overdueFindings: 0, waivedFindings: 0, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-07T02:00:00Z', ...over,
});

const finding = (over: Record<string, unknown> = {}) => ({
  id: 'f1', policyId: 'p1', patchRef: 'KB5030211', severity: 'HIGH', announcedAt: '2026-10-06T00:00:00Z', status: 'PENDING', dueAt: '2026-10-13T00:00:00Z', overdue: false,
  reportedBy: 'scanner-1', reportedAt: '2026-10-06T00:00:01Z', ...over,
});

const trail = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'Patch policy for asset a1.' }];

function server(policies: Record<string, unknown>[] = [policy()], findings: Record<string, unknown>[] = [finding()], extra: Handler = () => undefined) {
  let current = policies;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/finding/retrieve')) return { body: findings };
    if (r.method === 'PUT' && path.includes('/finding/')) return { status: 204 };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: policy({ id: 'p2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/control/pause')) {
      current = current.map((p) => ({ ...p, status: 'PAUSED', compliance: 'PAUSED' }));
      return { status: 204 };
    }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) {
      current = current.map((p) => ({ ...p, status: 'ACTIVE', compliance: 'COMPLIANT' }));
      return { status: 204 };
    }
    if (r.method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: current };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: current[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows what holds and what does not, for each policy', async () => {
    const { impl } = fakeFetch(server([
      policy(),
      policy({ id: 'p3', name: 'Mail', compliance: 'OVERDUE', overdueFindings: 2, openFindings: 3, waivedFindings: 1 }),
      policy({ id: 'p5', name: 'Old', status: 'PAUSED', compliance: 'PAUSED' }),
    ]));
    renderWithSession(<PatchesPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Servers' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('COMPLIANT')).toBeInTheDocument();
    expect(within(row).getByText('2/7/30/90')).toBeInTheDocument();
    const mail = screen.getByRole('button', { name: 'Mail' }).closest('tr') as HTMLElement;
    expect(within(mail).getByText('OVERDUE')).toBeInTheDocument();
    expect(within(mail).getByText('3')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('Overdue')).toBeInTheDocument();
    expect(tiles.getByText('3', { selector: '.n' })).toBeInTheDocument();
  });

  it('filters by compliance and status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<PatchesPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No policies match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Compliance'), 'OVERDUE');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('compliance')).toBe('OVERDUE'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('PAUSED'));
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the policies cannot be read', async () => {
    const { impl } = fakeFetch(server([], [], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-PCH-00403', detail: 'Staff only.' } })));
    renderWithSession(<PatchesPage />, impl, me);

    expect((await screen.findAllByText('ERR-PCH-00403')).length).toBeGreaterThan(0);
  });
});

describe('a new policy', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([policy()], [finding()], extra));
    renderWithSession(<PatchesPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Servers' });
    await user.click(screen.getByRole('button', { name: 'New policy' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New policy' }) };
  }

  it('needs a name and an asset, and sends the four numbers', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create policy' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Mail ');
    await user.type(within(form).getByLabelText(/Asset it covers/), ' a9 ');
    await user.clear(within(form).getByLabelText(/critical patch/));
    await user.type(within(form).getByLabelText(/critical patch/), '1');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New policy' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Mail', assetId: 'a9', criticalDays: 1, highDays: 7, mediumDays: 30, lowDays: 90 });
    expect(await screen.findByRole('complementary', { name: 'Policy detail' })).toBeInTheDocument();
  });

  it('a number cleared keeps the form closed to submission', async () => {
    const { user, form } = await open();
    await user.type(within(form).getByLabelText('Name'), 'X');
    await user.type(within(form).getByLabelText(/Asset it covers/), 'a1');
    await user.clear(within(form).getByLabelText(/medium patch/));
    expect(within(form).getByRole('button', { name: 'Create policy' })).toBeDisabled();
  });

  it('shows why a promise is refused and keeps the form; Cancel closes it', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'A more severe patch cannot be given more time than a less severe one.' } } : undefined));
    await user.type(within(form).getByLabelText('Name'), 'Bad');
    await user.type(within(form).getByLabelText(/Asset it covers/), 'a3');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    expect(await within(form).findByText(/cannot be given more time/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New policy' })).not.toBeInTheDocument();
  });

  it('shows a failure that is not a problem document as plain text', async () => {
    const { impl } = fakeFetch(server());
    const broken = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') throw new Error('network down');
      return impl(input, init);
    }) as typeof fetch;
    renderWithSession(<PatchesPage />, broken, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Servers' });
    await user.click(screen.getByRole('button', { name: 'New policy' }));
    const form = screen.getByRole('form', { name: 'New policy' });
    await user.type(within(form).getByLabelText('Name'), 'X');
    await user.type(within(form).getByLabelText(/Asset it covers/), 'a4');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

describe('a policy in detail', () => {
  async function select(policies = [policy()], findings: Record<string, unknown>[] = [finding()], extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server(policies, findings, extra));
    renderWithSession(<PatchesPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: policies[0].name as string }));
    return { user, calls, detail: await screen.findByRole('complementary', { name: 'Policy detail' }) };
  }

  it('shows the promise, the counts, the patches with their deadline and state, and the history', async () => {
    const { detail } = await select([policy({ compliance: 'OVERDUE', overdueFindings: 1, oldestOverdueDueAt: '2026-10-03T00:00:00Z' })], [
      finding({ overdue: true }),
      finding({ id: 'f2', patchRef: 'CVE-1', severity: 'LOW', status: 'WAIVED', waiverReason: 'VENDOR_NO_FIX', waivedUntil: '2026-11-01T00:00:00Z' }),
      finding({ id: 'f3', patchRef: 'KB3', status: 'APPLIED', dueAt: undefined }),
    ]);

    expect(await within(detail).findByText(/critical 2 d, high 7 d/)).toBeInTheDocument();
    expect(within(detail).getByText(/Oldest overdue since/)).toBeInTheDocument();
    const table = await within(detail).findByRole('table', { name: 'Patches' });
    expect(within(table).getByText('KB5030211')).toBeInTheDocument();
    expect(within(table).getByText('overdue')).toBeInTheDocument();
    expect(within(table).getByText(/VENDOR_NO_FIX until/)).toBeInTheDocument();
    expect(within(table).getByText('APPLIED')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('says when no patch was reported, and filters the patches by status', async () => {
    const { user, detail, calls } = await select([policy()], []);

    expect(await within(detail).findByText('No patches reported.')).toBeInTheDocument();
    await user.selectOptions(within(detail).getByLabelText('Patch status'), 'WAIVED');
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/finding/retrieve') && c.url.searchParams.get('status') === 'WAIVED')).toBe(true));
  });

  it('waives a pending patch with a reason from the fixed list and a number of days, and can cancel', async () => {
    const { user, detail, calls } = await select();
    await user.click(await within(detail).findByRole('button', { name: 'Waive' }));
    let form = within(detail).getByRole('form', { name: 'Waive patch' });
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(within(detail).queryByRole('form', { name: 'Waive patch' })).not.toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Waive' }));
    form = within(detail).getByRole('form', { name: 'Waive patch' });
    await user.selectOptions(within(form).getByLabelText('Reason'), 'COMPENSATING_CONTROL');
    await user.clear(within(form).getByLabelText(/For how many days/));
    expect(within(form).getByRole('button', { name: 'Waive' })).toBeDisabled();
    await user.type(within(form).getByLabelText(/For how many days/), '10');
    await user.click(within(form).getByRole('button', { name: 'Waive' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/finding/f1/control/waive'))).toBe(true));
    const sent = calls.find((c) => c.url.pathname.endsWith('/control/waive'))!.body as { reason: string; until: string };
    expect(sent.reason).toBe('COMPENSATING_CONTROL');
    const days = (new Date(sent.until).getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(9.9);
    expect(days).toBeLessThan(10.1);
  });

  it('withdraws a waiver', async () => {
    const { user, detail, calls } = await select([policy()], [finding({ status: 'WAIVED', waiverReason: 'ACCEPTED_RISK', waivedUntil: '2026-11-01T00:00:00Z' })]);
    await user.click(await within(detail).findByRole('button', { name: 'Withdraw waiver' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/finding/f1/control/unwaive'))).toBe(true));
  });

  it('pauses and resumes, and closes', async () => {
    const { user, detail, calls } = await select();
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/pause'))).toBe(true));
    await user.click(await within(detail).findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/resume'))).toBe(true));
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Policy detail' })).not.toBeInTheDocument();
  });

  it('shows why a change was refused', async () => {
    const { user, detail } = await select([policy()], [finding()], (r) => (r.method === 'PUT' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-PCH-00409', detail: 'Illegal transition.' } } : undefined));
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('ERR-PCH-00409')).toBeInTheDocument();
  });

  it('a failure that is not a problem document is plain text', async () => {
    const { user, detail } = await select([policy()], [finding()], (r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; });
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('network down')).toBeInTheDocument();
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { BackupsPage } from './Backups';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const policy = (over: Record<string, unknown> = {}) => ({
  id: 'p1', organisationId: ORG, name: 'Database nightly', assetId: 'a1', frequencyHours: 24, rpoHours: 48, rtoMinutes: 120, retentionDays: 30,
  status: 'ACTIVE', protection: 'OK', protectedUntil: '2026-10-09T02:00:00Z', restoreTest: 'NOT_REQUIRED', lastSuccessAt: '2026-10-07T02:00:00Z',
  createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-07T02:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'Backup policy for asset a1.' }];
const runs = [
  { id: 'r1', policyId: 'p1', kind: 'BACKUP', outcome: 'SUCCEEDED', startedAt: '2026-10-07T01:40:00Z', finishedAt: '2026-10-07T02:00:00Z', durationMinutes: 20, reportedBy: 'agent-1', reportedAt: '2026-10-07T02:00:01Z' },
  { id: 'r2', policyId: 'p1', kind: 'RESTORE_TEST', outcome: 'FAILED', startedAt: '2026-10-06T01:40:00Z', finishedAt: '2026-10-06T02:00:00Z', durationMinutes: 20, failureReason: 'STORAGE_FULL', reportedBy: 'agent-2', reportedAt: '2026-10-06T02:00:01Z' },
];

function server(policies: Record<string, unknown>[] = [policy()], extra: Handler = () => undefined, runList: unknown[] = runs) {
  let current = policies;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/run/retrieve')) return { body: runList };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: policy({ id: 'p2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/control/pause')) {
      current = current.map((p) => ({ ...p, status: 'PAUSED', protection: 'PAUSED' }));
      return { status: 204 };
    }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) {
      current = current.map((p) => ({ ...p, status: 'ACTIVE', protection: 'OK' }));
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
      policy({ id: 'p3', name: 'Mail', protection: 'RPO_BREACHED', restoreTest: 'OVERDUE' }),
      policy({ id: 'p4', name: 'Fresh', protection: 'NEVER', lastSuccessAt: undefined, protectedUntil: undefined }),
      policy({ id: 'p5', name: 'Old', status: 'PAUSED', protection: 'PAUSED' }),
    ]));
    renderWithSession(<BackupsPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Database nightly' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('OK')).toBeInTheDocument();
    const mail = screen.getByRole('button', { name: 'Mail' }).closest('tr') as HTMLElement;
    expect(within(mail).getByText('RPO BREACHED')).toBeInTheDocument();
    expect(within(mail).getByText('OVERDUE')).toBeInTheDocument();
    const fresh = screen.getByRole('button', { name: 'Fresh' }).closest('tr') as HTMLElement;
    expect(within(fresh).getByText('none yet')).toBeInTheDocument();
    expect(within(fresh).getByText('NEVER')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('4')).toBeInTheDocument();
    expect(tiles.getByText('Past the RPO')).toBeInTheDocument();
  });

  it('filters by protection and status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<BackupsPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No policies match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Protection'), 'RPO_BREACHED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('protection')).toBe('RPO_BREACHED'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('PAUSED'));
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the policies cannot be read', async () => {
    const { impl } = fakeFetch(server([], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-BKP-00403', detail: 'Staff only.' } })));
    renderWithSession(<BackupsPage />, impl, me);

    expect((await screen.findAllByText('ERR-BKP-00403')).length).toBeGreaterThan(0);
  });
});

describe('a new policy', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([policy()], extra));
    renderWithSession(<BackupsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Database nightly' });
    await user.click(screen.getByRole('button', { name: 'New policy' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New policy' }) };
  }

  it('needs a name and an asset; the restore test is optional and left out when empty', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create policy' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Mail ');
    await user.type(within(form).getByLabelText(/Asset it protects/), ' a9 ');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New policy' })).not.toBeInTheDocument());
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ name: 'Mail', assetId: 'a9', frequencyHours: 24, rpoHours: 48, rtoMinutes: 120, retentionDays: 30 });
    expect(await screen.findByRole('complementary', { name: 'Policy detail' })).toBeInTheDocument();
  });

  it('sends the numbers that were changed, the restore test included, and a number cleared keeps the form closed to submission', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText('Name'), 'Files');
    await user.type(within(form).getByLabelText(/Asset it protects/), 'a2');
    await user.clear(within(form).getByLabelText(/Backed up every/));
    expect(within(form).getByRole('button', { name: 'Create policy' })).toBeDisabled();
    await user.type(within(form).getByLabelText(/Backed up every/), '12');
    await user.clear(within(form).getByLabelText(/Most data/));
    await user.type(within(form).getByLabelText(/Most data/), '24');
    await user.clear(within(form).getByLabelText(/Longest recovery/));
    await user.type(within(form).getByLabelText(/Longest recovery/), '60');
    await user.clear(within(form).getByLabelText(/Keep copies/));
    await user.type(within(form).getByLabelText(/Keep copies/), '90');
    await user.type(within(form).getByLabelText(/Prove a restore/), '14');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Files', assetId: 'a2', frequencyHours: 12, rpoHours: 24, rtoMinutes: 60, retentionDays: 90, restoreTestEveryDays: 14 });
  });

  it('shows why a promise is refused and keeps the form; Cancel closes it', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'The recovery point objective cannot be shorter than the backup frequency.' } } : undefined));
    await user.type(within(form).getByLabelText('Name'), 'Bad');
    await user.type(within(form).getByLabelText(/Asset it protects/), 'a3');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    expect(await within(form).findByText(/cannot be shorter/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New policy' })).not.toBeInTheDocument();
  });

  it('shows a failure that is not a problem document as plain text', async () => {
    const { impl } = fakeFetch(server([policy()]));
    const broken = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') throw new Error('network down');
      return impl(input, init);
    }) as typeof fetch;
    renderWithSession(<BackupsPage />, broken, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Database nightly' });
    await user.click(screen.getByRole('button', { name: 'New policy' }));
    const form = screen.getByRole('form', { name: 'New policy' });
    await user.type(within(form).getByLabelText('Name'), 'X');
    await user.type(within(form).getByLabelText(/Asset it protects/), 'a4');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

describe('a policy in detail', () => {
  async function select(policies = [policy()], extra: Handler = () => undefined, runList: unknown[] = runs) {
    const { impl, calls } = fakeFetch(server(policies, extra, runList));
    renderWithSession(<BackupsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: policies[0].name as string }));
    return { user, calls, detail: await screen.findByRole('complementary', { name: 'Policy detail' }) };
  }

  it('shows the promise, the runs with their reason and who reported them, and the history', async () => {
    const { detail } = await select([policy({ restoreTestEveryDays: 30, restoreTest: 'OK', restoreTestDueAt: '2026-11-01T00:00:00Z', lastRestoreMinutes: 20, rtoMet: true, lastRunAt: '2026-10-07T02:00:00Z' })]);

    expect(await within(detail).findByText(/a backup every 24 h, at most 48 h of data lost/)).toBeInTheDocument();
    expect(within(detail).getByText(/within the objective/)).toBeInTheDocument();
    expect(within(detail).getByText(/every 30 days/)).toBeInTheDocument();
    const table = await within(detail).findByRole('table', { name: 'Recent runs' });
    expect(within(table).getByText('succeeded')).toBeInTheDocument();
    expect(within(table).getByText('STORAGE_FULL')).toBeInTheDocument();
    expect(within(table).getByText('restore test')).toBeInTheDocument();
    expect(within(table).getByText('agent-1')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('says when the objective was missed, and when no run was reported yet', async () => {
    const { detail } = await select([policy({ lastRestoreMinutes: 200, rtoMet: false })], () => undefined, []);

    expect(await within(detail).findByText(/over the objective/)).toBeInTheDocument();
    expect(await within(detail).findByText('No runs reported yet.')).toBeInTheDocument();
  });

  it('a restore test that is not required shows no restore line, and a history entry without a detail shows none', async () => {
    const { detail } = await select([policy()], (r) => (r.url.pathname.endsWith('/audit-log/retrieve')
      ? { body: [{ occurredAt: '2026-10-01T10:00:00Z', action: 'PAUSED', executor: 'x', toStatus: 'PAUSED' }] } : undefined));

    expect(await within(detail).findByText('PAUSED', { selector: 'strong' })).toBeInTheDocument();
    expect(within(detail).queryByText('Restore test')).not.toBeInTheDocument();
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
    const { user, detail } = await select([policy()], (r) => (r.method === 'PUT' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-BKP-00409', detail: 'Illegal transition.' } } : undefined));
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('ERR-BKP-00409')).toBeInTheDocument();
  });

  it('a failure that is not a problem document is plain text', async () => {
    const { user, detail } = await select([policy()], (r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; });
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('network down')).toBeInTheDocument();
  });
});

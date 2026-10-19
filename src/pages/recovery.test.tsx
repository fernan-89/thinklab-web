import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { RecoveryPage } from './Recovery';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'p1', organisationId: ORG, name: 'Orders failover', assetId: 'a1', strategy: 'WARM_STANDBY', rtoMinutes: 120, rpoMinutes: 30, testEveryDays: 90, status: 'ACTIVE',
  readiness: 'READY', nextExerciseDueAt: '2027-01-10T00:00:00Z', lastExerciseAt: '2026-10-10T00:00:00Z', lastOutcome: 'SUCCEEDED', createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-10T00:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'Recovery plan for asset a1.' }];
const exercises = [
  { id: 'e1', planId: 'p1', kind: 'FAILOVER', outcome: 'SUCCEEDED', startedAt: '2026-10-10T00:00:00Z', finishedAt: '2026-10-10T01:00:00Z', durationMinutes: 60, dataLossMinutes: 5, reportedBy: 'drill-1', reportedAt: '2026-10-10T01:00:01Z' },
  { id: 'e2', planId: 'p1', kind: 'TABLETOP', outcome: 'PARTIAL', startedAt: '2026-09-10T00:00:00Z', finishedAt: '2026-09-10T00:20:00Z', durationMinutes: 20, failureReason: 'RUNBOOK_OUTDATED', reportedBy: 'drill-2', reportedAt: '2026-09-10T00:20:01Z' },
];

function server(plans: Record<string, unknown>[] = [plan()], extra: Handler = () => undefined, exerciseList: unknown[] = exercises) {
  let current = plans;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/exercise/retrieve')) return { body: exerciseList };
    if (r.method === 'POST' && path.endsWith('/exercise/initiate')) return { status: 201, body: exercises[0] };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: plan({ id: 'p2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/control/pause')) { current = current.map((p) => ({ ...p, status: 'PAUSED', readiness: 'PAUSED' })); return { status: 204 }; }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) { current = current.map((p) => ({ ...p, status: 'ACTIVE', readiness: 'READY' })); return { status: 204 }; }
    if (r.method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: current };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: current[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows what is proved and what is not, for each plan, with the strategy in plain words', async () => {
    const { impl } = fakeFetch(server([
      plan(),
      plan({ id: 'p3', name: 'Mail', readiness: 'LAST_EXERCISE_FAILED', strategy: 'BACKUP_RESTORE' }),
      plan({ id: 'p4', name: 'Fresh', readiness: 'NEVER_TESTED', lastExerciseAt: undefined, nextExerciseDueAt: undefined }),
      plan({ id: 'p5', name: 'Slow', readiness: 'OBJECTIVE_MISSED', strategy: 'PILOT_LIGHT' }),
      plan({ id: 'p6', name: 'Old', status: 'PAUSED', readiness: 'PAUSED', strategy: 'ACTIVE_ACTIVE' }),
      plan({ id: 'p7', name: 'Late', readiness: 'TEST_OVERDUE' }),
    ]));
    renderWithSession(<RecoveryPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Orders failover' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('READY')).toBeInTheDocument();
    expect(within(row).getByText('Warm standby')).toBeInTheDocument();
    const mail = screen.getByRole('button', { name: 'Mail' }).closest('tr') as HTMLElement;
    expect(within(mail).getByText('LAST EXERCISE FAILED')).toBeInTheDocument();
    expect(within(mail).getByText('Restore from a backup')).toBeInTheDocument();
    const fresh = screen.getByRole('button', { name: 'Fresh' }).closest('tr') as HTMLElement;
    expect(within(fresh).getByText('NEVER TESTED')).toBeInTheDocument();
    expect(within(fresh).getByText('none yet')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Slow' }).closest('tr') as HTMLElement).getByText('OBJECTIVE MISSED')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Late' }).closest('tr') as HTMLElement).getByText('TEST OVERDUE')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('6')).toBeInTheDocument();
    expect(tiles.getByText('Objective missed')).toBeInTheDocument();
    expect(tiles.getByText('Last exercise failed')).toBeInTheDocument();
  });

  it('filters by readiness and status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<RecoveryPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No plans match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Readiness'), 'OBJECTIVE_MISSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('readiness')).toBe('OBJECTIVE_MISSED'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('PAUSED'));
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the plans cannot be read', async () => {
    const { impl } = fakeFetch(server([], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-DRR-00403', detail: 'Staff only.' } })));
    renderWithSession(<RecoveryPage />, impl, me);

    expect((await screen.findAllByText('ERR-DRR-00403')).length).toBeGreaterThan(0);
  });
});

describe('a new plan', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([plan()], extra));
    renderWithSession(<RecoveryPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Orders failover' });
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New plan' }) };
  }

  it('needs a name and an asset; the runbook is optional and left out when empty', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create plan' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Mail ');
    await user.type(within(form).getByLabelText(/Asset it recovers/), ' a9 ');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New plan' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Mail', assetId: 'a9', strategy: 'WARM_STANDBY', rtoMinutes: 120, rpoMinutes: 30, testEveryDays: 90 });
    expect(await screen.findByRole('complementary', { name: 'Plan detail' })).toBeInTheDocument();
  });

  it('sends the strategy, the numbers and the runbook that were chosen; a number cleared closes the form to submission', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText('Name'), 'Files');
    await user.type(within(form).getByLabelText(/Asset it recovers/), 'a2');
    await user.selectOptions(within(form).getByLabelText('Strategy'), 'BACKUP_RESTORE');
    await user.clear(within(form).getByLabelText(/Longest recovery/));
    expect(within(form).getByRole('button', { name: 'Create plan' })).toBeDisabled();
    await user.type(within(form).getByLabelText(/Longest recovery/), '240');
    await user.clear(within(form).getByLabelText(/Most data/));
    await user.type(within(form).getByLabelText(/Most data/), '60');
    await user.clear(within(form).getByLabelText(/Prove it every/));
    await user.type(within(form).getByLabelText(/Prove it every/), '30');
    await user.type(within(form).getByLabelText(/Runbook/), ' KB-1042 ');
    await user.click(within(form).getByRole('button', { name: 'Create plan' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Files', assetId: 'a2', strategy: 'BACKUP_RESTORE', rtoMinutes: 240, rpoMinutes: 60, testEveryDays: 30, runbookRef: 'KB-1042',
    });
  });

  it('shows why a promise is refused and keeps the form; Cancel closes it', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'A plan that restores from a backup cannot promise to lose no data.' } } : undefined));
    await user.type(within(form).getByLabelText('Name'), 'Bad');
    await user.type(within(form).getByLabelText(/Asset it recovers/), 'a3');
    await user.click(within(form).getByRole('button', { name: 'Create plan' }));

    expect(await within(form).findByText(/cannot promise to lose no data/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New plan' })).not.toBeInTheDocument();
  });

  it('shows a failure that is not a problem document as plain text', async () => {
    const { impl } = fakeFetch(server([plan()]));
    const broken = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') throw new Error('network down');
      return impl(input, init);
    }) as typeof fetch;
    renderWithSession(<RecoveryPage />, broken, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Orders failover' });
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    const form = screen.getByRole('form', { name: 'New plan' });
    await user.type(within(form).getByLabelText('Name'), 'X');
    await user.type(within(form).getByLabelText(/Asset it recovers/), 'a4');
    await user.click(within(form).getByRole('button', { name: 'Create plan' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

describe('a plan in detail', () => {
  async function select(plans = [plan()], extra: Handler = () => undefined, list: unknown[] = exercises) {
    const { impl, calls } = fakeFetch(server(plans, extra, list));
    renderWithSession(<RecoveryPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: plans[0].name as string }));
    return { user, calls, detail: await screen.findByRole('complementary', { name: 'Plan detail' }) };
  }

  it('shows the promise, the measured recovery, the exercises with their reason and who reported them, and the history', async () => {
    const { detail } = await select([plan({ runbookRef: 'KB-1042', lastMeasuredMinutes: 60, rtoMet: true, lastMeasuredDataLossMinutes: 5, rpoMet: true })]);

    expect(await within(detail).findByText(/warm standby, recovered within 120 min, at most 30 min of data lost, proved every 90 days/)).toBeInTheDocument();
    expect(within(detail).getByText('KB-1042')).toBeInTheDocument();
    expect(within(detail).getByText(/60 min, within the objective; 5 min of data lost, within the objective/)).toBeInTheDocument();
    const table = await within(detail).findByRole('table', { name: 'Recent exercises' });
    expect(within(table).getByText('succeeded')).toBeInTheDocument();
    expect(within(table).getByText(/RUNBOOK_OUTDATED/)).toBeInTheDocument();
    expect(within(table).getByText('Walk through the runbook')).toBeInTheDocument();
    expect(within(table).getByText('drill-1')).toBeInTheDocument();
    expect(within(table).getByText('5 min')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('says when an objective was missed, when nothing was measured yet, and when no exercise was reported', async () => {
    const missed = await select([plan({ lastMeasuredMinutes: 200, rtoMet: false })], () => undefined, []);
    expect(await within(missed.detail).findByText(/200 min, over the objective/)).toBeInTheDocument();
    expect(await within(missed.detail).findByText('No exercises reported yet.')).toBeInTheDocument();
  });

  it('a plan whose objectives were never measured says only a failover or a full recovery measures them; one that lost data over the limit says so', async () => {
    const unmeasured = await select([plan({ readiness: 'NEVER_TESTED', lastExerciseAt: undefined, lastOutcome: undefined, nextExerciseDueAt: undefined })]);
    expect(await within(unmeasured.detail).findByText(/not measured yet: only a failover or a full recovery measures them/)).toBeInTheDocument();
    expect(within(unmeasured.detail).queryByText('Next exercise due')).not.toBeInTheDocument();
  });

  it('a measured recovery that lost more data than allowed says so, and a history entry without a detail shows none', async () => {
    const { detail } = await select([plan({ lastMeasuredMinutes: 30, rtoMet: true, lastMeasuredDataLossMinutes: 90, rpoMet: false })], (r) => (r.url.pathname.endsWith('/audit-log/retrieve')
      ? { body: [{ occurredAt: '2026-10-01T10:00:00Z', action: 'PAUSED', executor: 'x', toStatus: 'PAUSED' }] } : undefined));

    expect(await within(detail).findByText(/30 min, within the objective; 90 min of data lost, over the objective/)).toBeInTheDocument();
    expect(await within(detail).findByText('PAUSED', { selector: 'strong' })).toBeInTheDocument();
  });

  it('a measured recovery that did not say what it lost mentions no data loss', async () => {
    const { detail } = await select([plan({ lastMeasuredMinutes: 30, rtoMet: true })]);

    expect(await within(detail).findByText(/^30 min, within the objective$/)).toBeInTheDocument();
  });

  it('pauses and resumes, and closes', async () => {
    const { user, detail, calls } = await select();
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/pause'))).toBe(true));
    await user.click(await within(detail).findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/resume'))).toBe(true));
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Plan detail' })).not.toBeInTheDocument();
  });

  it('shows why a change was refused, and a failure that is not a problem document as plain text', async () => {
    const refused = await select([plan()], (r) => (r.method === 'PUT' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-DRR-00409', detail: 'Illegal transition.' } } : undefined));
    await refused.user.click(await within(refused.detail).findByRole('button', { name: 'Pause' }));
    expect(await within(refused.detail).findByText('ERR-DRR-00409')).toBeInTheDocument();
  });

  it('a failure that is not a problem document is plain text', async () => {
    const { user, detail } = await select([plan()], (r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; });
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('network down')).toBeInTheDocument();
  });
});

describe('reporting an exercise', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([plan()], extra));
    renderWithSession(<RecoveryPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Orders failover' }));
    const detail = await screen.findByRole('complementary', { name: 'Plan detail' });
    await user.click(await within(detail).findByRole('button', { name: 'Report an exercise' }));
    return { user, calls, detail, form: within(detail).getByRole('form', { name: 'Report an exercise' }) };
  }

  it('reports a passed failover with the data it lost, and the form closes', async () => {
    const { user, form, calls, detail } = await open();
    expect(within(form).queryByLabelText('What went wrong')).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Data lost/), '7');
    await user.click(within(form).getByRole('button', { name: 'Report' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.pathname.endsWith('/exercise/initiate'))).toBe(true));
    const body = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/exercise/initiate'))!.body as Record<string, unknown>;
    expect(body).toMatchObject({ planId: 'p1', kind: 'FAILOVER', outcome: 'SUCCEEDED', dataLossMinutes: 7 });
    expect(body).not.toHaveProperty('failureReason');
    expect(new Date(body.finishedAt as string).getTime()).toBeGreaterThan(new Date(body.startedAt as string).getTime());
    await waitFor(() => expect(within(detail).queryByRole('form', { name: 'Report an exercise' })).not.toBeInTheDocument());
  });

  it('a partial or failed exercise asks what went wrong, from the fixed list, and sends it; a passed one sends none', async () => {
    const { user, form, calls } = await open();
    await user.selectOptions(within(form).getByLabelText('Kind'), 'TABLETOP');
    await user.selectOptions(within(form).getByLabelText('Outcome'), 'PARTIAL');
    await user.selectOptions(within(form).getByLabelText('What went wrong'), 'DEPENDENCY_MISSING');
    await user.click(within(form).getByRole('button', { name: 'Report' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.pathname.endsWith('/exercise/initiate'))).toBe(true));
    const body = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/exercise/initiate'))!.body as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'TABLETOP', outcome: 'PARTIAL', failureReason: 'DEPENDENCY_MISSING' });
    expect(body).not.toHaveProperty('dataLossMinutes');
  });

  it('needs both moments, shows why a report is refused and keeps the form; Cancel closes it', async () => {
    const { user, form, detail } = await open((r) => (r.method === 'POST' && r.url.pathname.endsWith('/exercise/initiate')
      ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'An exercise cannot finish before it started.' } } : undefined));
    const started = within(form).getByLabelText('Started');
    await user.clear(started);
    expect(within(form).getByRole('button', { name: 'Report' })).toBeDisabled();
    await user.type(started, '2026-10-19T10:00');
    await user.click(within(form).getByRole('button', { name: 'Report' }));

    expect(await within(form).findByText(/cannot finish before it started/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(within(detail).queryByRole('form', { name: 'Report an exercise' })).not.toBeInTheDocument();
  });

  it('a failure that is not a problem document is plain text', async () => {
    const { user, form } = await open((r) => { if (r.method === 'POST') throw new Error('network down'); return undefined; });
    await user.click(within(form).getByRole('button', { name: 'Report' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

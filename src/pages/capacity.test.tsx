import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { CapacityPage } from './Capacity';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const policy = (over: Record<string, unknown> = {}) => ({
  id: 'p1', organisationId: ORG, name: 'Orders disk', assetId: 'a1', metric: 'DISK', limit: 100, warnPercent: 70, criticalPercent: 90, windowDays: 30, horizonDays: 30,
  reportEveryHours: 24, status: 'ACTIVE', level: 'OK', utilisationPercent: 60, stale: false, forecast: 'WITHIN_HORIZON', daysToLimit: 4, projectedExhaustionAt: '2026-10-22T12:00:00Z',
  lastValue: 60, lastMeasuredAt: '2026-10-18T12:00:00Z', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-18T12:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'Capacity policy for DISK of asset a1.' }];
const samples = [
  { id: 's2', policyId: 'p1', value: 60, measuredAt: '2026-10-18T12:00:00Z', reportedBy: 'agent-1', reportedAt: '2026-10-18T12:00:01Z' },
  { id: 's1', policyId: 'p1', value: 50, measuredAt: '2026-10-17T12:00:00Z', reportedBy: 'agent-2', reportedAt: '2026-10-17T12:00:01Z' },
];

function server(policies: Record<string, unknown>[] = [policy()], extra: Handler = () => undefined, sampleList: unknown[] = samples) {
  let current = policies;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/sample/retrieve')) return { body: sampleList };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: policy({ id: 'p2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/control/pause')) {
      current = current.map((p) => ({ ...p, status: 'PAUSED', level: 'PAUSED', forecast: undefined, utilisationPercent: undefined }));
      return { status: 204 };
    }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) {
      current = current.map((p) => ({ ...p, status: 'ACTIVE', level: 'OK' }));
      return { status: 204 };
    }
    if (r.method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: current };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: current[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows how full each asset is, where the trend leads, and the tiles', async () => {
    const { impl } = fakeFetch(server([
      policy(),
      policy({ id: 'p3', name: 'Mail', level: 'CRITICAL', utilisationPercent: 95, forecast: 'WITHIN_HORIZON', daysToLimit: 0, stale: true }),
      policy({ id: 'p4', name: 'Fresh', level: 'NO_DATA', utilisationPercent: undefined, forecast: 'NOT_ENOUGH_DATA', daysToLimit: undefined, lastValue: undefined }),
      policy({ id: 'p5', name: 'Flat', level: 'WARNING', utilisationPercent: 75, forecast: 'STABLE', daysToLimit: undefined }),
      policy({ id: 'p6', name: 'Old', status: 'PAUSED', level: 'PAUSED', utilisationPercent: undefined, forecast: undefined, daysToLimit: undefined }),
      policy({ id: 'p7', name: 'Slow', forecast: 'BEYOND_HORIZON', daysToLimit: 120.04 }),
    ]));
    renderWithSession(<CapacityPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Orders disk' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('60.0%')).toBeInTheDocument();
    expect(within(row).getByText('in 4.0 days')).toBeInTheDocument();
    const mail = screen.getByRole('button', { name: 'Mail' }).closest('tr') as HTMLElement;
    expect(within(mail).getByText('CRITICAL')).toBeInTheDocument();
    expect(within(mail).getByText('now')).toBeInTheDocument();
    expect(within(mail).getByText(/no recent sample/)).toBeInTheDocument();
    const fresh = screen.getByRole('button', { name: 'Fresh' }).closest('tr') as HTMLElement;
    expect(within(fresh).getByText('NO DATA')).toBeInTheDocument();
    expect(within(fresh).getByText('not enough samples')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Flat' }).closest('tr') as HTMLElement).getByText('not growing')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Old' }).closest('tr') as HTMLElement).getAllByText('-').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('button', { name: 'Slow' }).closest('tr') as HTMLElement).getByText('in 120.0 days')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('6')).toBeInTheDocument();
    expect(tiles.getByText('Critical')).toBeInTheDocument();
  });

  it('filters by level, forecast, metric and status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<CapacityPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No policies match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Level'), 'CRITICAL');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('level')).toBe('CRITICAL'));
    await user.selectOptions(screen.getByLabelText('Forecast'), 'WITHIN_HORIZON');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('forecast')).toBe('WITHIN_HORIZON'));
    await user.selectOptions(screen.getByLabelText('Metric'), 'MEMORY');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('metric')).toBe('MEMORY'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('PAUSED'));
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the policies cannot be read', async () => {
    const { impl } = fakeFetch(server([], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-CAP-00403', detail: 'Staff only.' } })));
    renderWithSession(<CapacityPage />, impl, me);

    expect((await screen.findAllByText('ERR-CAP-00403')).length).toBeGreaterThan(0);
  });
});

describe('a new policy', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([policy()], extra));
    renderWithSession(<CapacityPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Orders disk' });
    await user.click(screen.getByRole('button', { name: 'New policy' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New policy' }) };
  }

  it('needs a name, an asset and a limit; sends the defaults of the rest', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create policy' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Mail ');
    await user.type(within(form).getByLabelText(/Asset it watches/), ' a9 ');
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText(/^Limit/), '250');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New policy' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Mail', assetId: 'a9', metric: 'DISK', limit: 250, warnPercent: 70, criticalPercent: 90, windowDays: 30, horizonDays: 30, reportEveryHours: 24,
    });
    expect(await screen.findByRole('complementary', { name: 'Policy detail' })).toBeInTheDocument();
  });

  it('sends what was changed, the metric included', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText('Name'), 'Files');
    await user.type(within(form).getByLabelText(/Asset it watches/), 'a2');
    await user.selectOptions(within(form).getByLabelText('Metric'), 'MEMORY');
    await user.type(within(form).getByLabelText(/^Limit/), '64.5');
    for (const [label, value] of [[/Warn at/, '50'], [/Critical at/, '80'], [/Trend drawn/, '14'], [/running out within/, '60'], [/reports every/, '12']] as const) {
      await user.clear(within(form).getByLabelText(label));
      await user.type(within(form).getByLabelText(label), value);
    }
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Files', assetId: 'a2', metric: 'MEMORY', limit: 64.5, warnPercent: 50, criticalPercent: 80, windowDays: 14, horizonDays: 60, reportEveryHours: 12,
    });
  });

  it('shows why a policy is refused and keeps the form; Cancel closes it', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'The critical utilisation must be above the warning one.' } } : undefined));
    await user.type(within(form).getByLabelText('Name'), 'Bad');
    await user.type(within(form).getByLabelText(/Asset it watches/), 'a3');
    await user.type(within(form).getByLabelText(/^Limit/), '10');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    expect(await within(form).findByText(/must be above the warning/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New policy' })).not.toBeInTheDocument();
  });

  it('shows a failure that is not a problem document as plain text', async () => {
    const { impl } = fakeFetch(server([policy()]));
    const broken = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') throw new Error('network down');
      return impl(input, init);
    }) as typeof fetch;
    renderWithSession(<CapacityPage />, broken, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Orders disk' });
    await user.click(screen.getByRole('button', { name: 'New policy' }));
    const form = screen.getByRole('form', { name: 'New policy' });
    await user.type(within(form).getByLabelText('Name'), 'X');
    await user.type(within(form).getByLabelText(/Asset it watches/), 'a4');
    await user.type(within(form).getByLabelText(/^Limit/), '5');
    await user.click(within(form).getByRole('button', { name: 'Create policy' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

describe('a policy in detail', () => {
  async function select(policies = [policy()], extra: Handler = () => undefined, sampleList: unknown[] = samples) {
    const { impl, calls } = fakeFetch(server(policies, extra, sampleList));
    renderWithSession(<CapacityPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: policies[0].name as string }));
    return { user, calls, detail: await screen.findByRole('complementary', { name: 'Policy detail' }) };
  }

  it('shows the watch, the latest sample, the trend, the samples with who reported them, and the history', async () => {
    const { detail } = await select();

    expect(await within(detail).findByText(/DISK of 100, warn at 70%, critical at 90%/)).toBeInTheDocument();
    expect(within(detail).getByText(/60 \(60.0%\)/)).toBeInTheDocument();
    expect(within(detail).getByText(/a straight line through the last 30 days; running out in 4.0 days, around/)).toBeInTheDocument();
    expect(within(detail).getByText(/expected every 24 h/)).toBeInTheDocument();
    expect(within(detail).getByText('WITHIN HORIZON')).toBeInTheDocument();
    const table = await within(detail).findByRole('table', { name: 'Recent samples' });
    expect(within(table).getByText('agent-1')).toBeInTheDocument();
    expect(within(table).getByText('50')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('says when the tool is silent, when nothing was sampled yet, and shows no forecast badge for a paused policy', async () => {
    const stale = await select([policy({ stale: true, forecast: 'STABLE', daysToLimit: undefined, projectedExhaustionAt: undefined })], () => undefined, []);
    expect(await within(stale.detail).findByText(/older than twice the expected interval/)).toBeInTheDocument();
    expect(await within(stale.detail).findByText('No samples reported yet.')).toBeInTheDocument();
    expect(within(stale.detail).getByText(/running out not growing$/)).toBeInTheDocument();
  });

  it('a policy with no sample and a paused one show no latest-sample line, and a history entry without a detail shows none', async () => {
    const { detail } = await select([policy({ lastValue: undefined, lastMeasuredAt: undefined, utilisationPercent: undefined, level: 'PAUSED', status: 'PAUSED', forecast: undefined, daysToLimit: undefined, projectedExhaustionAt: undefined })],
      (r) => (r.url.pathname.endsWith('/audit-log/retrieve') ? { body: [{ occurredAt: '2026-10-01T10:00:00Z', action: 'PAUSED', executor: 'x', toStatus: 'PAUSED' }] } : undefined));

    expect(await within(detail).findByText('PAUSED', { selector: 'strong' })).toBeInTheDocument();
    expect(within(detail).queryByText('Latest sample')).not.toBeInTheDocument();
    expect(within(detail).getByText(/running out -$/)).toBeInTheDocument();
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
    const { user, detail } = await select([policy()], (r) => (r.method === 'PUT' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-CAP-00409', detail: 'Illegal transition.' } } : undefined));
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('ERR-CAP-00409')).toBeInTheDocument();
  });

  it('a failure that is not a problem document is plain text', async () => {
    const { user, detail } = await select([policy()], (r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; });
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('network down')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Capacity link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/capacity');
    expect(await screen.findByRole('heading', { name: 'Capacity', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Capacity' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Policies' })).toBeInTheDocument();
  });
});

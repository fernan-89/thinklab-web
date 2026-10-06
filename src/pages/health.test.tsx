import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { HealthPage } from './Health';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const check = (over: Record<string, unknown> = {}) => ({
  id: 'k1', organisationId: ORG, name: 'Intranet', type: 'HTTP', target: 'https://intranet.acme.test/health', intervalSeconds: 60, timeoutMillis: 5000,
  failureThreshold: 3, successThreshold: 1, status: 'ACTIVE', health: 'UP', consecutiveFailures: 0, lastCheckedAt: '2026-10-06T12:00:00Z', lastLatencyMillis: 14,
  createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T12:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-06T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'UNKNOWN', detail: 'Watching HTTP https://intranet.acme.test/health.' }];
const probes = [
  { at: '2026-10-06T12:00:00Z', ok: true, statusCode: 200, latencyMillis: 14 },
  { at: '2026-10-06T11:59:00Z', ok: false, latencyMillis: 5000, error: 'timeout' },
];

function server(checks: Record<string, unknown>[] = [check()], extra: Handler = () => undefined) {
  let current = checks;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/summary/retrieve')) return { body: { total: 3, up: 1, down: 1, unknown: 0, paused: 1 } };
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/results/retrieve')) return { body: probes };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: check({ id: 'k2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/check/execute')) return { body: check({ health: 'DOWN', consecutiveFailures: 3, lastError: 'timeout' }) };
    if (r.method === 'PUT' && path.endsWith('/control/pause')) {
      current = current.map((c) => ({ ...c, status: 'PAUSED' }));
      return { status: 204 };
    }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) {
      current = current.map((c) => ({ ...c, status: 'ACTIVE' }));
      return { status: 204 };
    }
    if (r.method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: current };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: current[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows the tiles, and each check with its health, last probe, latency and what went wrong', async () => {
    const { impl } = fakeFetch(server([check(), check({ id: 'k3', name: 'Database', type: 'TCP', target: 'db:5432', health: 'DOWN', lastError: 'connection refused' }),
      check({ id: 'k4', name: 'Fresh', health: 'UNKNOWN', lastCheckedAt: undefined, lastLatencyMillis: undefined, status: 'PAUSED' }),
      check({ id: 'k5', name: 'NoLatency', lastLatencyMillis: undefined })]));
    renderWithSession(<HealthPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Intranet' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('UP')).toBeInTheDocument();
    expect(within(row).getByText(/14 ms/)).toBeInTheDocument();
    const down = screen.getByRole('button', { name: 'Database' }).closest('tr') as HTMLElement;
    expect(within(down).getByText('DOWN')).toBeInTheDocument();
    expect(within(down).getByText('connection refused')).toBeInTheDocument();
    const fresh = screen.getByRole('button', { name: 'Fresh' }).closest('tr') as HTMLElement;
    expect(within(fresh).getByText('not yet')).toBeInTheDocument();
    expect(within(fresh).getByText('PAUSED')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'NoLatency' }).closest('tr') as HTMLElement).getByText(/- ms/)).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('3')).toBeInTheDocument();
    expect(tiles.getByText('Down')).toBeInTheDocument();
  });

  it('filters by health and status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<HealthPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No checks match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Health'), 'DOWN');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('health')).toBe('DOWN'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('PAUSED'));
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the list cannot be read', async () => {
    const { impl } = fakeFetch(server([], (r) => (r.url.pathname.endsWith('/summary/retrieve')
      ? { status: 403, body: { title: 'Forbidden', error_code: 'ERR-HLM-00403', detail: 'Staff only.' } } : undefined)));
    renderWithSession(<HealthPage />, impl, me);

    expect(await screen.findByText('ERR-HLM-00403')).toBeInTheDocument();
  });
});

describe('a new check', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([check()], extra));
    renderWithSession(<HealthPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Intranet' });
    await user.click(screen.getByRole('button', { name: 'New check' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New check' }) };
  }

  it('needs a name and a target; an HTTP check can take an expected status, a TCP one cannot; numbers it leaves empty are not sent', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Start watching' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Portal ');
    await user.type(within(form).getByLabelText(/Address/), ' https://portal.acme.test/health ');
    await user.type(within(form).getByLabelText(/Expected status/), '204');
    await user.type(within(form).getByLabelText(/Every/), '30');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New check' })).not.toBeInTheDocument());
    const post = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/initiate'))!;
    expect(post.body).toEqual({ name: 'Portal', type: 'HTTP', target: 'https://portal.acme.test/health', intervalSeconds: 30, timeoutMillis: undefined, expectedStatus: 204, failureThreshold: undefined });
    expect(await screen.findByRole('complementary', { name: 'Check detail' })).toBeInTheDocument();
  });

  it('a TCP check asks for host and port and has no expected status', async () => {
    const { user, form, calls } = await open();
    await user.selectOptions(within(form).getByLabelText('Type'), 'TCP');
    expect(within(form).queryByLabelText(/Expected status/)).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText('Name'), 'Database');
    await user.type(within(form).getByLabelText('Host and port'), 'db.internal:5432');
    await user.type(within(form).getByLabelText(/Down after/), '2');
    await user.type(within(form).getByLabelText(/Timeout/), '1000');
    await user.click(within(form).getByRole('button', { name: 'Start watching' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.pathname.endsWith('/initiate'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ type: 'TCP', target: 'db.internal:5432', failureThreshold: 2, timeoutMillis: 1000 });
    expect(calls.find((c) => c.method === 'POST')!.body).not.toHaveProperty('expectedStatus');
  });

  it('shows why a target is refused and keeps the form', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'That address cannot be monitored.' } } : undefined));
    await user.type(within(form).getByLabelText('Name'), 'Metadata');
    await user.type(within(form).getByLabelText(/Address/), 'http://169.254.169.254/');
    await user.click(within(form).getByRole('button', { name: 'Start watching' }));

    expect(await within(form).findByText('ERR-VALIDATION-00400')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New check' })).not.toBeInTheDocument();
  });
});

describe('a check in detail', () => {
  async function open(over: Record<string, unknown> = {}, extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([check(over)], extra));
    renderWithSession(<HealthPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Intranet' }));
    const detail = await screen.findByRole('complementary', { name: 'Check detail' });
    await within(detail).findByText('INITIATED');
    return { user, calls, detail };
  }

  it('shows how it is probed, the recent probes with what went wrong, and the history', async () => {
    const { detail } = await open({ expectedStatus: 204, consecutiveFailures: 2, lastStateChangeAt: '2026-10-06T11:00:00Z' });

    expect(within(detail).getByText(/every 60 s, timeout 5000 ms/)).toBeInTheDocument();
    expect(within(detail).getByText(/3 failure\(s\) in a row; up after 1 success/)).toBeInTheDocument();
    expect(within(detail).getByText('204')).toBeInTheDocument();
    expect(within(detail).getByText(/2 probe\(s\) in a row/)).toBeInTheDocument();
    expect(within(detail).getByText('Last change of health')).toBeInTheDocument();
    const probesTable = within(detail).getByRole('table', { name: 'Recent probes' });
    expect(within(probesTable).getByText('timeout')).toBeInTheDocument();
    expect(within(probesTable).getByText('200')).toBeInTheDocument();
  });

  it('says so when there are no probes yet', async () => {
    const { impl } = fakeFetch(server([check()], (r) => (r.url.pathname.endsWith('/results/retrieve') ? { body: [] } : undefined)));
    renderWithSession(<HealthPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Intranet' }));

    expect(await screen.findByText('No probes yet.')).toBeInTheDocument();
  });

  it('probes now and shows the result, pauses and resumes', async () => {
    const { user, detail, calls } = await open();

    await user.click(within(within(detail).getByLabelText('Actions')).getByRole('button', { name: 'Probe now' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/check/execute'))).toBe(true));
    await user.click(within(within(detail).getByLabelText('Actions')).getByRole('button', { name: 'Pause' }));
    expect(await within(detail).findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Resume' }));
    expect(await within(detail).findByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('shows the problem when an action is refused, and can be closed', async () => {
    const { user, detail } = await open({}, (r) => (r.method === 'PUT' && r.url.pathname.endsWith('/control/pause')
      ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-HLM-00409', detail: 'Changed by someone else.' } } : undefined));

    await user.click(within(within(detail).getByLabelText('Actions')).getByRole('button', { name: 'Pause' }));
    expect(await within(detail).findByText('ERR-HLM-00409')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Check detail' })).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Health link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/health');
    expect(await screen.findByRole('heading', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Health' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Intranet' })).toBeInTheDocument();
  });
});

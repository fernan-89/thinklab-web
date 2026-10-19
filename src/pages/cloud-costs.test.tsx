import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { CloudCostsPage } from './CloudCosts';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const account = (over: Record<string, unknown> = {}) => ({
  id: 'a1', organisationId: ORG, name: 'Production', provider: 'AWS', externalId: '123456789012', currency: 'USD', monthlyBudget: 3100, warnPercent: 80,
  reportEveryHours: 24, status: 'ACTIVE', month: '2026-10', level: 'OK', spent: 1240.5, projected: 2100, usedPercent: 40.016, stale: false,
  lastReportedAt: '2026-10-18T02:00:00Z', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-18T02:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'A monthly budget of 3100.00 USD.' }];
const reports = [
  { id: 'r2', accountId: 'a1', day: '2026-10-18', amount: 102.37, reportedBy: 'billing-export', reportedAt: '2026-10-18T02:00:00Z' },
  { id: 'r1', accountId: 'a1', day: '2026-10-17', amount: 98, reportedBy: 'finops-tool', reportedAt: '2026-10-17T02:00:00Z' },
];

function server(accounts: Record<string, unknown>[] = [account()], extra: Handler = () => undefined, reportList: unknown[] = reports) {
  let current = accounts;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.includes('/it-vendor-registry/')) return { body: [{ id: 'v1', name: 'Amazon Web Services' }] };
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/cost/retrieve')) return { body: reportList };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: account({ id: 'a2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/control/pause')) {
      current = current.map((a) => ({ ...a, status: 'PAUSED', level: 'PAUSED', spent: undefined, projected: undefined, usedPercent: undefined }));
      return { status: 204 };
    }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) { current = current.map((a) => ({ ...a, status: 'ACTIVE', level: 'OK' })); return { status: 204 }; }
    if (r.method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: current };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: current[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows each account with its level, what this month cost in its own currency, where it is heading, and the tiles', async () => {
    const { impl } = fakeFetch(server([
      account(),
      account({ id: 'a3', name: 'Data', provider: 'AZURE', currency: 'EUR', level: 'OVER_BUDGET', spent: 3200, projected: 9920, monthlyBudget: 3000, stale: true }),
      account({ id: 'a4', name: 'Fresh', level: 'NO_DATA', spent: undefined, projected: undefined, usedPercent: undefined }),
      account({ id: 'a5', name: 'Old', status: 'PAUSED', level: 'PAUSED', spent: undefined, projected: undefined, usedPercent: undefined }),
    ]));
    renderWithSession(<CloudCostsPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Production' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('1240.50 USD of 3100.00')).toBeInTheDocument();
    expect(within(row).getByText('2100.00 USD')).toBeInTheDocument();
    const data = screen.getByRole('button', { name: 'Data' }).closest('tr') as HTMLElement;
    expect(within(data).getByText('OVER BUDGET')).toBeInTheDocument();
    expect(within(data).getByText('3200.00 EUR of 3000.00')).toBeInTheDocument();
    expect(within(data).getByText(/no recent report/)).toBeInTheDocument();
    const fresh = screen.getByRole('button', { name: 'Fresh' }).closest('tr') as HTMLElement;
    expect(within(fresh).getByText('NO DATA')).toBeInTheDocument();
    expect(within(fresh).getAllByText('-').length).toBe(2);
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('4')).toBeInTheDocument();
    expect(tiles.getByText('Over budget')).toBeInTheDocument();
  });

  it('filters by level, provider, currency and status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<CloudCostsPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No accounts match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Level'), 'NEAR_BUDGET');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('level')).toBe('NEAR_BUDGET'));
    await user.selectOptions(screen.getByLabelText('Provider'), 'GCP');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('provider')).toBe('GCP'));
    await user.selectOptions(screen.getByLabelText('Currency'), 'BRL');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('currency')).toBe('BRL'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('PAUSED'));
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the accounts cannot be read', async () => {
    const { impl } = fakeFetch(server([], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-CLD-00403', detail: 'Staff only.' } })));
    renderWithSession(<CloudCostsPage />, impl, me);

    expect((await screen.findAllByText('ERR-CLD-00403')).length).toBeGreaterThan(0);
  });
});

describe('a new account', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([account()], extra));
    renderWithSession(<CloudCostsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Production' });
    await user.click(screen.getByRole('button', { name: 'New account' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New account' }) };
  }

  it('needs a name, the provider account and a budget; sends the defaults of the rest and no vendor unless one is chosen', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Staging ');
    await user.type(within(form).getByLabelText("The provider's account id"), ' 210987654321 ');
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Monthly budget'), '1500.50');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New account' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Staging', provider: 'AWS', externalId: '210987654321', currency: 'USD', monthlyBudget: 1500.5, warnPercent: 80, reportEveryHours: 24,
    });
    expect(await screen.findByRole('complementary', { name: 'Account detail' })).toBeInTheDocument();
  });

  it('sends what was changed, the provider, the currency and the vendor included', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText('Name'), 'Data platform');
    await user.selectOptions(within(form).getByLabelText('Provider'), 'AZURE');
    await user.type(within(form).getByLabelText("The provider's account id"), 'sub-0f3c:prod');
    await user.selectOptions(within(form).getByLabelText(/Currency/), 'EUR');
    await user.type(within(form).getByLabelText('Monthly budget'), '900');
    for (const [label, value] of [[/Warn at/, '90'], [/reports every/, '12']] as const) {
      await user.clear(within(form).getByLabelText(label));
      await user.type(within(form).getByLabelText(label), value);
    }
    await within(form).findByRole('option', { name: 'Amazon Web Services' });
    await user.selectOptions(within(form).getByLabelText(/Vendor/), 'v1');
    await user.click(within(form).getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Data platform', provider: 'AZURE', externalId: 'sub-0f3c:prod', currency: 'EUR', monthlyBudget: 900, warnPercent: 90, reportEveryHours: 12, vendorId: 'v1',
    });
  });

  it('shows why an account is refused and keeps the form; Cancel closes it', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-CLD-00409', detail: 'An account named Production already exists.' } } : undefined));
    await user.type(within(form).getByLabelText('Name'), 'Production');
    await user.type(within(form).getByLabelText("The provider's account id"), '1');
    await user.type(within(form).getByLabelText('Monthly budget'), '10');
    await user.click(within(form).getByRole('button', { name: 'Create account' }));

    expect(await within(form).findByText(/already exists/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New account' })).not.toBeInTheDocument();
  });

  it('a network failure is plain text', async () => {
    const { user, form } = await open((r) => { if (r.method === 'POST') throw new Error('network down'); return undefined; });
    await user.type(within(form).getByLabelText('Name'), 'X');
    await user.type(within(form).getByLabelText("The provider's account id"), '1');
    await user.type(within(form).getByLabelText('Monthly budget'), '1');
    await user.click(within(form).getByRole('button', { name: 'Create account' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

describe('an account in detail', () => {
  async function select(accounts = [account()], extra: Handler = () => undefined, reportList: unknown[] = reports) {
    const { impl, calls } = fakeFetch(server(accounts, extra, reportList));
    renderWithSession(<CloudCostsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: accounts[0].name as string }));
    return { user, calls, detail: await screen.findByRole('complementary', { name: 'Account detail' }) };
  }

  it('shows the budget, the month spent and where it is heading, the days with who reported them, and the history', async () => {
    const { detail } = await select();

    expect(await within(detail).findByText('AWS 123456789012')).toBeInTheDocument();
    expect(within(detail).getByText(/3100.00 USD a month, warn at 80%/)).toBeInTheDocument();
    expect(within(detail).getByText('2026-10')).toBeInTheDocument();
    expect(within(detail).getByText(/1240.50 USD spent \(40.0%\), heading to 2100.00 USD/)).toBeInTheDocument();
    expect(within(detail).getByText(/expected every 24 h, last at/)).toBeInTheDocument();
    const table = await within(detail).findByRole('table', { name: 'Recent days' });
    expect(within(table).getByText('finops-tool')).toBeInTheDocument();
    expect(within(table).getByText('102.37 USD')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('says when the tool is silent and when nothing was reported yet', async () => {
    const stale = await select([account({ stale: true })], () => undefined, []);
    expect(await within(stale.detail).findByText(/older than twice the expected interval/)).toBeInTheDocument();
    expect(await within(stale.detail).findByText('No costs reported yet.')).toBeInTheDocument();
  });

  it('an account with nothing this month shows no month line; one never reported shows no last report; a history entry without a detail shows none', async () => {
    const { detail } = await select([account({ spent: undefined, projected: undefined, usedPercent: undefined, level: 'NO_DATA', lastReportedAt: undefined })],
      (r) => (r.url.pathname.endsWith('/audit-log/retrieve') ? { body: [{ occurredAt: '2026-10-01T10:00:00Z', action: 'PAUSED', executor: 'x', toStatus: 'PAUSED' }] } : undefined));

    expect(await within(detail).findByText('PAUSED', { selector: 'strong' })).toBeInTheDocument();
    expect(within(detail).queryByText('2026-10')).not.toBeInTheDocument();
    expect(within(detail).getByText('expected every 24 h')).toBeInTheDocument();
  });

  it('a month without a line to its end shows zero', async () => {
    const { detail } = await select([account({ projected: undefined })]);
    expect(await within(detail).findByText(/heading to 0.00 USD/)).toBeInTheDocument();
  });

  it('pauses and resumes, and closes', async () => {
    const { user, detail, calls } = await select();
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/pause'))).toBe(true));
    await user.click(await within(detail).findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/resume'))).toBe(true));
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Account detail' })).not.toBeInTheDocument();
  });

  it('shows why a change was refused', async () => {
    const { user, detail } = await select([account()], (r) => (r.method === 'PUT' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-CLD-00409', detail: 'Illegal transition.' } } : undefined));
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('ERR-CLD-00409')).toBeInTheDocument();
  });

  it('a failure that is not a problem document is plain text', async () => {
    const { user, detail } = await select([account()], (r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; });
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('network down')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Cloud costs link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/cloud-costs');
    expect(await screen.findByRole('heading', { name: 'Cloud costs', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cloud costs' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Cloud accounts' })).toBeInTheDocument();
  });
});

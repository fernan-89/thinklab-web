import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { LicensesPage } from './Licenses';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const license = (over: Record<string, unknown> = {}) => ({
  id: 'l1', organisationId: ORG, product: 'Office 365 E3', unit: 'USER', entitled: 100, warnPercent: 90, reportEveryHours: 24, status: 'ACTIVE', level: 'OK',
  usagePercent: 60, available: 40, stale: false, lastInUse: 60, lastMeasuredAt: '2026-10-18T12:00:00Z', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-18T12:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: '100 USER seats of Office 365 E3.' }];
const reports = [
  { id: 'r2', licenseId: 'l1', inUse: 60, measuredAt: '2026-10-18T12:00:00Z', reportedBy: 'inventory-1', reportedAt: '2026-10-18T12:00:01Z' },
  { id: 'r1', licenseId: 'l1', inUse: 55, measuredAt: '2026-10-17T12:00:00Z', reportedBy: 'inventory-2', reportedAt: '2026-10-17T12:00:01Z' },
];

function server(licenses: Record<string, unknown>[] = [license()], extra: Handler = () => undefined, reportList: unknown[] = reports) {
  let current = licenses;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.includes('/it-vendor-registry/')) return { body: [{ id: 'v1', name: 'Microsoft' }] };
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/usage/retrieve')) return { body: reportList };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: license({ id: 'l2', product: (r.body as { product: string }).product }) };
    if (r.method === 'PUT' && path.endsWith('/control/pause')) {
      current = current.map((l) => ({ ...l, status: 'PAUSED', level: 'PAUSED', usagePercent: undefined, available: undefined }));
      return { status: 204 };
    }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) { current = current.map((l) => ({ ...l, status: 'ACTIVE', level: 'OK' })); return { status: 204 }; }
    if (r.method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: current };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: current[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows each licence with its level, the seats in use and left, and the tiles', async () => {
    const { impl } = fakeFetch(server([
      license(),
      license({ id: 'l3', product: 'AutoCAD', unit: 'DEVICE', level: 'OVER_LIMIT', usagePercent: 110, available: -1, lastInUse: 11, entitled: 10, stale: true }),
      license({ id: 'l4', product: 'Fresh', level: 'NO_DATA', usagePercent: undefined, available: undefined, lastInUse: undefined, lastMeasuredAt: undefined }),
      license({ id: 'l5', product: 'Old', status: 'PAUSED', level: 'PAUSED', usagePercent: undefined, available: undefined }),
    ]));
    renderWithSession(<LicensesPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Office 365 E3' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('60 of 100')).toBeInTheDocument();
    expect(within(row).getByText('40 left')).toBeInTheDocument();
    const cad = screen.getByRole('button', { name: 'AutoCAD' }).closest('tr') as HTMLElement;
    expect(within(cad).getByText('OVER LIMIT')).toBeInTheDocument();
    expect(within(cad).getByText('1 too many')).toBeInTheDocument();
    expect(within(cad).getByText(/no recent count/)).toBeInTheDocument();
    const fresh = screen.getByRole('button', { name: 'Fresh' }).closest('tr') as HTMLElement;
    expect(within(fresh).getByText('NO DATA')).toBeInTheDocument();
    expect(within(fresh).getAllByText('-').length).toBe(2);
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('4')).toBeInTheDocument();
    expect(tiles.getByText('Over the limit')).toBeInTheDocument();
  });

  it('filters by level, unit and status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<LicensesPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No licences match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Level'), 'OVER_LIMIT');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('level')).toBe('OVER_LIMIT'));
    await user.selectOptions(screen.getByLabelText('Unit'), 'CORE');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('unit')).toBe('CORE'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('PAUSED'));
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the licences cannot be read', async () => {
    const { impl } = fakeFetch(server([], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-LIC-00403', detail: 'Staff only.' } })));
    renderWithSession(<LicensesPage />, impl, me);

    expect((await screen.findAllByText('ERR-LIC-00403')).length).toBeGreaterThan(0);
  });
});

describe('a new licence', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([license()], extra));
    renderWithSession(<LicensesPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Office 365 E3' });
    await user.click(screen.getByRole('button', { name: 'New licence' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New licence' }) };
  }

  it('needs a product and the seats bought; sends the defaults of the rest and no vendor unless one is chosen', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create licence' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Product'), ' Visio ');
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Seats bought'), '25');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New licence' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ product: 'Visio', unit: 'USER', entitled: 25, warnPercent: 90, reportEveryHours: 24 });
    expect(await screen.findByRole('complementary', { name: 'Licence detail' })).toBeInTheDocument();
  });

  it('sends what was changed, the unit and the vendor included', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText('Product'), 'AutoCAD');
    await user.selectOptions(within(form).getByLabelText('A seat is one'), 'DEVICE');
    await user.type(within(form).getByLabelText('Seats bought'), '10');
    for (const [label, value] of [[/Warn at/, '80'], [/reports every/, '12']] as const) {
      await user.clear(within(form).getByLabelText(label));
      await user.type(within(form).getByLabelText(label), value);
    }
    await within(form).findByRole('option', { name: 'Microsoft' });
    await user.selectOptions(within(form).getByLabelText(/Vendor/), 'v1');
    await user.click(within(form).getByRole('button', { name: 'Create licence' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ product: 'AutoCAD', unit: 'DEVICE', entitled: 10, warnPercent: 80, reportEveryHours: 12, vendorId: 'v1' });
  });

  it('shows why a licence is refused and keeps the form; Cancel closes it', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-LIC-00409', detail: 'A licence for Office already exists.' } } : undefined));
    await user.type(within(form).getByLabelText('Product'), 'Office');
    await user.type(within(form).getByLabelText('Seats bought'), '10');
    await user.click(within(form).getByRole('button', { name: 'Create licence' }));

    expect(await within(form).findByText(/already exists/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New licence' })).not.toBeInTheDocument();
  });

  it('a network failure is plain text', async () => {
    const { user, form } = await open((r) => { if (r.method === 'POST') throw new Error('network down'); return undefined; });
    await user.type(within(form).getByLabelText('Product'), 'X');
    await user.type(within(form).getByLabelText('Seats bought'), '1');
    await user.click(within(form).getByRole('button', { name: 'Create licence' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

describe('a licence in detail', () => {
  async function select(licenses = [license()], extra: Handler = () => undefined, reportList: unknown[] = reports) {
    const { impl, calls } = fakeFetch(server(licenses, extra, reportList));
    renderWithSession(<LicensesPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: licenses[0].product as string }));
    return { user, calls, detail: await screen.findByRole('complementary', { name: 'Licence detail' }) };
  }

  it('shows what was bought, the latest count, the counts with who reported them, and the history', async () => {
    const { detail } = await select();

    expect(await within(detail).findByText(/100 seats, one per user, warn at 90%/)).toBeInTheDocument();
    expect(within(detail).getByText(/60 in use \(60.0%, 40 left\)/)).toBeInTheDocument();
    expect(within(detail).getByText(/expected every 24 h/)).toBeInTheDocument();
    const table = await within(detail).findByRole('table', { name: 'Recent counts' });
    expect(within(table).getByText('inventory-2')).toBeInTheDocument();
    expect(within(table).getByText('55')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('says when the tool is silent and when nothing was counted yet; a licence with no count shows no latest-count line', async () => {
    const stale = await select([license({ stale: true })], () => undefined, []);
    expect(await within(stale.detail).findByText(/older than twice the expected interval/)).toBeInTheDocument();
    expect(await within(stale.detail).findByText('No counts reported yet.')).toBeInTheDocument();
  });

  it('a licence with no count and a history entry without a detail show none', async () => {
    const { detail } = await select([license({ lastInUse: undefined, lastMeasuredAt: undefined, usagePercent: undefined, available: undefined, level: 'NO_DATA' })],
      (r) => (r.url.pathname.endsWith('/audit-log/retrieve') ? { body: [{ occurredAt: '2026-10-01T10:00:00Z', action: 'PAUSED', executor: 'x', toStatus: 'PAUSED' }] } : undefined));

    expect(await within(detail).findByText('PAUSED', { selector: 'strong' })).toBeInTheDocument();
    expect(within(detail).queryByText('Latest count')).not.toBeInTheDocument();
  });

  it('pauses and resumes, and closes', async () => {
    const { user, detail, calls } = await select();
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/pause'))).toBe(true));
    await user.click(await within(detail).findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/resume'))).toBe(true));
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Licence detail' })).not.toBeInTheDocument();
  });

  it('shows why a change was refused', async () => {
    const { user, detail } = await select([license()], (r) => (r.method === 'PUT' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-LIC-00409', detail: 'Illegal transition.' } } : undefined));
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('ERR-LIC-00409')).toBeInTheDocument();
  });

  it('a failure that is not a problem document is plain text', async () => {
    const { user, detail } = await select([license()], (r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; });
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('network down')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Licenses link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/licenses');
    expect(await screen.findByRole('heading', { name: 'Licenses', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Licenses' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Licences' })).toBeInTheDocument();
  });
});

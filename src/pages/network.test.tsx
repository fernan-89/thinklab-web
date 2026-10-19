import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { NetworkPage } from './Network';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const subnet = (over: Record<string, unknown> = {}) => ({
  id: 's1', organisationId: ORG, name: 'Office LAN', cidr: '10.20.0.0/24', network: '10.20.0.0', broadcast: '10.20.0.255', prefix: 24, vlan: 120, warnPercent: 80,
  status: 'ACTIVE', level: 'OK', used: 3, usable: 254, free: 251, usedPercent: 1.18, createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z', ...over,
});

const allocation = (over: Record<string, unknown> = {}) => ({
  id: 'a1', organisationId: ORG, subnetId: 's1', ip: '10.20.0.1', hostname: 'gw-office', status: 'ALLOCATED', createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-19T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'Subnet 10.20.0.0/24.' }];

function server(subnets: Record<string, unknown>[] = [subnet()], extra: Handler = () => undefined, allocations: unknown[] = [allocation(), allocation({ id: 'a2', ip: '10.20.0.9', hostname: undefined, status: 'RELEASED' })]) {
  let current = subnets;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/allocation/retrieve')) return { body: allocations };
    if (r.method === 'POST' && path.endsWith('/allocation/initiate')) return { status: 201, body: allocation({ id: 'a3', ip: '10.20.0.2' }) };
    if (r.method === 'PUT' && path.endsWith('/control/release')) return { status: 204 };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: subnet({ id: 's2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/control/retire')) { current = current.map((s) => ({ ...s, status: 'RETIRED', level: 'RETIRED', usedPercent: undefined })); return { status: 204 }; }
    if (r.method === 'PUT' && path.endsWith('/control/reactivate')) { current = current.map((s) => ({ ...s, status: 'ACTIVE', level: 'OK' })); return { status: 204 }; }
    if (r.method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: current };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: current[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows each subnet with its range, VLAN, level and use, and the tiles', async () => {
    const { impl } = fakeFetch(server([
      subnet(),
      subnet({ id: 's3', name: 'Lab', cidr: '192.168.50.0/29', vlan: undefined, level: 'FULL', used: 6, usable: 6, free: 0 }),
      subnet({ id: 's4', name: 'Old', status: 'RETIRED', level: 'RETIRED' }),
    ]));
    renderWithSession(<NetworkPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Office LAN' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('10.20.0.0/24')).toBeInTheDocument();
    expect(within(row).getByText('120')).toBeInTheDocument();
    expect(within(row).getByText('3 of 254')).toBeInTheDocument();
    const lab = screen.getByRole('button', { name: 'Lab' }).closest('tr') as HTMLElement;
    expect(within(lab).getByText('FULL')).toBeInTheDocument();
    expect(within(lab).getByText('-')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('3')).toBeInTheDocument();
    expect(tiles.getByText('Nearly full')).toBeInTheDocument();
  });

  it('filters by level and status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<NetworkPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No subnets match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Level'), 'FULL');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('level')).toBe('FULL'));
    await user.selectOptions(screen.getByLabelText('Status'), 'RETIRED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('RETIRED'));
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the subnets cannot be read', async () => {
    const { impl } = fakeFetch(server([], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-IPM-00403', detail: 'Staff only.' } })));
    renderWithSession(<NetworkPage />, impl, me);

    expect((await screen.findAllByText('ERR-IPM-00403')).length).toBeGreaterThan(0);
  });
});

describe('a new subnet', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([subnet()], extra));
    renderWithSession(<NetworkPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Office LAN' });
    await user.click(screen.getByRole('button', { name: 'New subnet' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New subnet' }) };
  }

  it('needs a name and a range; sends the VLAN only when given', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create subnet' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Lab ');
    await user.type(within(form).getByLabelText(/Range/), ' 192.168.50.0/29 ');
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New subnet' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Lab', cidr: '192.168.50.0/29', warnPercent: 80 });
    expect(await screen.findByRole('complementary', { name: 'Subnet detail' })).toBeInTheDocument();
  });

  it('sends the VLAN and the warning when they are given', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText('Name'), 'Voice');
    await user.type(within(form).getByLabelText(/Range/), '10.30.0.0/24');
    await user.type(within(form).getByLabelText(/VLAN/), '30');
    await user.clear(within(form).getByLabelText(/Nearly full/));
    await user.type(within(form).getByLabelText(/Nearly full/), '90');
    await user.click(within(form).getByRole('button', { name: 'Create subnet' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Voice', cidr: '10.30.0.0/24', vlan: 30, warnPercent: 90 });
  });

  it('shows why a subnet is refused (an overlap) and keeps the form; Cancel closes it', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-IPM-00409', detail: 'The range 10.20.0.0/25 overlaps the active subnet 10.20.0.0/24.' } } : undefined));
    await user.type(within(form).getByLabelText('Name'), 'Inside');
    await user.type(within(form).getByLabelText(/Range/), '10.20.0.0/25');
    await user.click(within(form).getByRole('button', { name: 'Create subnet' }));

    expect(await within(form).findByText(/overlaps the active subnet/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New subnet' })).not.toBeInTheDocument();
  });

  it('a network failure is plain text', async () => {
    const { user, form } = await open((r) => { if (r.method === 'POST') throw new Error('network down'); return undefined; });
    await user.type(within(form).getByLabelText('Name'), 'X');
    await user.type(within(form).getByLabelText(/Range/), '10.40.0.0/24');
    await user.click(within(form).getByRole('button', { name: 'Create subnet' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

describe('a subnet in detail', () => {
  async function select(subnets = [subnet()], extra: Handler = () => undefined, allocations?: unknown[]) {
    const { impl, calls } = fakeFetch(server(subnets, extra, allocations));
    renderWithSession(<NetworkPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: subnets[0].name as string }));
    return { user, calls, detail: await screen.findByRole('complementary', { name: 'Subnet detail' }) };
  }

  it('shows the range, the use, the addresses with their host and status, and the history', async () => {
    const { detail } = await select();

    expect(await within(detail).findByText(/10.20.0.0 to 10.20.0.255, VLAN 120/)).toBeInTheDocument();
    expect(within(detail).getByText(/3 of 254 addresses used, 251 free \(1.2%\); nearly full at 80%/)).toBeInTheDocument();
    const table = await within(detail).findByRole('table', { name: 'Addresses' });
    expect(within(table).getByText('gw-office')).toBeInTheDocument();
    expect(within(table).getByText('RELEASED')).toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: 'Release' })).toHaveLength(1);
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('allocates the lowest free address, or the one typed, with a host name; releases one', async () => {
    const { user, detail, calls } = await select();
    const form = within(await within(detail).findByRole('form', { name: 'Allocate' }));
    await user.click(form.getByRole('button', { name: 'Allocate' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ subnetId: 's1' });

    await user.type(form.getByLabelText(/Address/), ' 10.20.0.50 ');
    await user.type(form.getByLabelText(/Host name/), ' printer ');
    await user.click(form.getByRole('button', { name: 'Allocate' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({ subnetId: 's1', ip: '10.20.0.50', hostname: 'printer' });
    await waitFor(() => expect(form.getByLabelText(/Address/)).toHaveValue(''));

    await user.click(within(await within(detail).findByRole('table', { name: 'Addresses' })).getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/allocation/a1/control/release'))).toBe(true));
  });

  it('a subnet with nothing handed out says so; a retired one offers no allocation and can be reactivated; it closes', async () => {
    const { user, detail, calls } = await select([subnet({ vlan: undefined, usedPercent: undefined })], () => undefined, []);
    expect(await within(detail).findByText('No address handed out yet.')).toBeInTheDocument();
    expect(within(detail).getByText(/\(10\.20\.0\.0 to 10\.20\.0\.255\)/)).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/retire'))).toBe(true));
    const reactivate = await within(detail).findByRole('button', { name: 'Reactivate' });
    expect(within(detail).queryByRole('form', { name: 'Allocate' })).not.toBeInTheDocument();
    await user.click(reactivate);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/reactivate'))).toBe(true));
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Subnet detail' })).not.toBeInTheDocument();
  });

  it('a history entry without a detail shows none', async () => {
    const { detail } = await select([subnet()], (r) => (r.url.pathname.endsWith('/audit-log/retrieve') ? { body: [{ occurredAt: '2026-10-19T10:00:00Z', action: 'RETIRED', executor: 'x', toStatus: 'RETIRED' }] } : undefined));

    expect(await within(detail).findByText('RETIRED', { selector: 'strong' })).toBeInTheDocument();
  });

  it('shows why an allocation was refused, and a failure that is not a problem document as plain text', async () => {
    const refused = await select([subnet()], (r) => (r.method === 'POST' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-IPM-00409', detail: 'The address 10.20.0.50 is already allocated in this subnet.' } } : undefined));
    await refused.user.click(within(await within(refused.detail).findByRole('form', { name: 'Allocate' })).getByRole('button', { name: 'Allocate' }));
    expect(await within(refused.detail).findByText('ERR-IPM-00409')).toBeInTheDocument();
  });

  it('a network failure is plain text', async () => {
    const { user, detail } = await select([subnet()], (r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; });
    await user.click(await within(detail).findByRole('button', { name: 'Retire' }));

    expect(await within(detail).findByText('network down')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Network link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/network');
    expect(await screen.findByRole('heading', { name: 'Network', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Network' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Subnets' })).toBeInTheDocument();
  });
});

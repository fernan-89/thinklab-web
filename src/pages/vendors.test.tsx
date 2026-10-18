import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { VendorsPage } from './Vendors';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const vendor = (over: Record<string, unknown> = {}) => ({
  id: 'v1', organisationId: ORG, name: 'Dell', category: 'HARDWARE', status: 'ACTIVE', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', ...over,
});

const agreement = (over: Record<string, unknown> = {}) => ({
  id: 'g1', organisationId: ORG, vendorId: 'v1', kind: 'WARRANTY', reference: 'WTY-1', assetId: 'a1', startsOn: '2026-01-01', endsOn: '2026-12-31', noticeDays: 30, autoRenew: false,
  status: 'ACTIVE', standing: 'IN_FORCE', daysToEnd: 74, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'WARRANTY WTY-1 until 2026-12-31.' }];

function server(vendors: Record<string, unknown>[] = [vendor()], agreements: Record<string, unknown>[] = [agreement()], extra: Handler = () => undefined) {
  let currentVendors = vendors;
  let currentAgreements = agreements;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (r.method === 'POST' && path.endsWith('/agreement/initiate')) return { status: 201, body: agreement({ id: 'g2', reference: (r.body as { reference: string }).reference }) };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: vendor({ id: 'v2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/control/deactivate')) { currentVendors = currentVendors.map((v) => ({ ...v, status: 'INACTIVE' })); return { status: 204 }; }
    if (r.method === 'PUT' && path.endsWith('/control/activate')) { currentVendors = currentVendors.map((v) => ({ ...v, status: 'ACTIVE' })); return { status: 204 }; }
    if (r.method === 'PUT' && path.endsWith('/control/pause')) { currentAgreements = currentAgreements.map((a) => ({ ...a, status: 'PAUSED', standing: 'PAUSED', daysToEnd: undefined })); return { status: 204 }; }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) { currentAgreements = currentAgreements.map((a) => ({ ...a, status: 'ACTIVE', standing: 'IN_FORCE' })); return { status: 204 }; }
    if (r.method === 'PUT' && path.endsWith('/update')) return { status: 204 };
    if (r.method === 'GET' && path.endsWith('/agreement/retrieve')) {
      const standing = r.url.searchParams.get('standing');
      return { body: standing ? currentAgreements.filter((a) => a.standing === standing) : currentAgreements };
    }
    if (r.method === 'GET' && path.includes('/agreement/') && path.endsWith('/retrieve')) return { body: currentAgreements[0] };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: currentVendors };
    return undefined;
  };
  return handler;
}

describe('the lists and the summary', () => {
  it('shows each agreement with its vendor, standing and time left, the vendors, and the tiles', async () => {
    const { impl } = fakeFetch(server([vendor(), vendor({ id: 'v3', name: 'Acme', status: 'INACTIVE', category: 'CLOUD' })], [
      agreement(),
      agreement({ id: 'g3', reference: 'SUP-1', kind: 'SUPPORT', standing: 'EXPIRING', daysToEnd: 12 }),
      agreement({ id: 'g4', reference: 'OLD-1', standing: 'EXPIRED', daysToEnd: -3 }),
      agreement({ id: 'g5', reference: 'NEW-1', standing: 'NOT_STARTED', daysToEnd: 90 }),
      agreement({ id: 'g6', reference: 'END-1', standing: 'EXPIRING', daysToEnd: 0 }),
      agreement({ id: 'g7', reference: 'PAU-1', status: 'PAUSED', standing: 'PAUSED', daysToEnd: undefined }),
      agreement({ id: 'g8', reference: 'GONE-1', vendorId: 'unknown' }),
    ]));
    renderWithSession(<VendorsPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'WTY-1' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('Dell')).toBeInTheDocument();
    expect(within(row).getByText('IN FORCE')).toBeInTheDocument();
    expect(within(row).getByText('74 days left')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'SUP-1' }).closest('tr') as HTMLElement).getByText('12 days left')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'OLD-1' }).closest('tr') as HTMLElement).getByText('ended 3 days ago')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'END-1' }).closest('tr') as HTMLElement).getByText('ends today')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'PAU-1' }).closest('tr') as HTMLElement).getByText('-')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'GONE-1' }).closest('tr') as HTMLElement).getByText('unknown')).toBeInTheDocument();
    const vendors = within(await screen.findByRole('table', { name: 'Vendors' }));
    expect(vendors.getByText('Acme')).toBeInTheDocument();
    expect(vendors.getByText('INACTIVE')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('7')).toBeInTheDocument();
    expect(tiles.getByText('Expiring')).toBeInTheDocument();
  });

  it('filters by standing, kind and vendor, and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([vendor()], []));
    renderWithSession(<VendorsPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No agreements match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Standing'), 'EXPIRING');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('standing')).toBe('EXPIRING'));
    await user.selectOptions(screen.getByLabelText('Kind'), 'LICENSE');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('kind')).toBe('LICENSE'));
    await user.selectOptions(screen.getByLabelText('Vendor'), 'v1');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('vendorId')).toBe('v1'));
    await user.selectOptions(screen.getByLabelText('Standing'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('standing')).toBeNull());
  });

  it('says so when there is no vendor, and cannot make an agreement without an active one', async () => {
    const { impl } = fakeFetch(server([], []));
    renderWithSession(<VendorsPage />, impl, me);

    expect(await screen.findByText('No vendors yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New agreement' })).toBeDisabled();
  });

  it('shows the problem when the agreements or the vendors cannot be read', async () => {
    const { impl } = fakeFetch(server([], [], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-VND-00403', detail: 'Staff only.' } })));
    renderWithSession(<VendorsPage />, impl, me);

    expect((await screen.findAllByText('ERR-VND-00403')).length).toBeGreaterThan(0);
  });
});

describe('vendors', () => {
  it('registers a vendor with a name and a category and lists it again', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<VendorsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'WTY-1' });
    await user.click(screen.getByRole('button', { name: 'New vendor' }));
    const form = screen.getByRole('form', { name: 'New vendor' });
    const submit = within(form).getByRole('button', { name: 'Create vendor' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Acme ');
    await user.selectOptions(within(form).getByLabelText('Category'), 'CLOUD');
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New vendor' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Acme', category: 'CLOUD' });
  });

  it('shows why a vendor is refused and keeps the form; Cancel closes it', async () => {
    const { impl } = fakeFetch(server([vendor()], [agreement()], (r) => (r.method === 'POST' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-VND-00409', detail: 'A vendor named Dell already exists.' } } : undefined)));
    renderWithSession(<VendorsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'WTY-1' });
    await user.click(screen.getByRole('button', { name: 'New vendor' }));
    const form = screen.getByRole('form', { name: 'New vendor' });
    await user.type(within(form).getByLabelText('Name'), 'Dell');
    await user.click(within(form).getByRole('button', { name: 'Create vendor' }));

    expect(await within(form).findByText(/already exists/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New vendor' })).not.toBeInTheDocument();
  });

  it('a network failure while registering a vendor is plain text', async () => {
    const { impl: inner } = fakeFetch(server());
    const broken = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') throw new Error('network down');
      return inner(input, init);
    }) as typeof fetch;
    renderWithSession(<VendorsPage />, broken, me);
    const second = userEvent.setup();
    await screen.findByRole('button', { name: 'WTY-1' });
    await second.click(screen.getByRole('button', { name: 'New vendor' }));
    const again = screen.getByRole('form', { name: 'New vendor' });
    await second.type(within(again).getByLabelText('Name'), 'X');
    await second.click(within(again).getByRole('button', { name: 'Create vendor' }));
    expect(await within(again).findByText('network down')).toBeInTheDocument();
  });

  it('deactivates and activates a vendor; a refusal is shown', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<VendorsPage />, impl, me);
    const user = userEvent.setup();
    const table = within(await screen.findByRole('table', { name: 'Vendors' }));
    await user.click(table.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/deactivate'))).toBe(true));
    await user.click(await table.findByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/activate'))).toBe(true));
  });

  it('shows why a vendor change was refused', async () => {
    const { impl } = fakeFetch(server([vendor()], [agreement()], (r) => (r.method === 'PUT' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-VND-00409', detail: 'Illegal transition.' } } : undefined)));
    renderWithSession(<VendorsPage />, impl, me);
    const user = userEvent.setup();
    const table = within(await screen.findByRole('table', { name: 'Vendors' }));
    await user.click(table.getByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByText('ERR-VND-00409')).toBeInTheDocument();
  });

  it('a failure to deactivate that is not a problem document is plain text', async () => {
    const { impl } = fakeFetch(server([vendor()], [agreement()], (r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; }));
    renderWithSession(<VendorsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole('table', { name: 'Vendors' })).getByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByText('network down')).toBeInTheDocument();
  });
});

describe('a new agreement', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([vendor(), vendor({ id: 'v3', name: 'Acme', status: 'INACTIVE' })], [agreement()], extra));
    renderWithSession(<VendorsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'WTY-1' });
    await screen.findByRole('option', { name: 'Dell' });
    await user.click(screen.getByRole('button', { name: 'New agreement' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New agreement' }) };
  }

  it('offers only active vendors, needs a reference and both days, and sends what was chosen', async () => {
    const { user, form, calls } = await open();
    expect(within(form).queryByRole('option', { name: 'Acme' })).not.toBeInTheDocument();
    const submit = within(form).getByRole('button', { name: 'Create agreement' });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText('Kind'), 'LICENSE');
    await user.type(within(form).getByLabelText(/Reference/), ' LIC-9 ');
    await user.type(within(form).getByLabelText(/Asset it covers/), ' a7 ');
    await user.type(within(form).getByLabelText('First day'), '2026-01-01');
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Last day'), '2027-06-30');
    const notice = within(form).getByLabelText(/Tell us this many days/);
    await user.clear(notice);
    await user.type(notice, '45');
    await user.click(within(form).getByLabelText(/It renews itself/));
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New agreement' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      vendorId: 'v1', kind: 'LICENSE', reference: 'LIC-9', assetId: 'a7', startsOn: '2026-01-01', endsOn: '2027-06-30', noticeDays: 45, autoRenew: true,
    });
    expect(await screen.findByRole('complementary', { name: 'Agreement detail' })).toBeInTheDocument();
  });

  it('leaves the asset out when none is given', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText(/Reference/), 'CT-1');
    await user.type(within(form).getByLabelText('First day'), '2026-01-01');
    await user.type(within(form).getByLabelText('Last day'), '2026-12-31');
    await user.click(within(form).getByRole('button', { name: 'Create agreement' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).not.toHaveProperty('assetId');
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ kind: 'CONTRACT', noticeDays: 30, autoRenew: false });
  });

  it('shows why an agreement is refused and keeps the form; Cancel closes it; a failure that is not a problem document is plain text', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'The agreement cannot end before it starts.' } } : undefined));
    await user.type(within(form).getByLabelText(/Reference/), 'BAD');
    await user.type(within(form).getByLabelText('First day'), '2026-12-31');
    await user.type(within(form).getByLabelText('Last day'), '2026-01-01');
    await user.click(within(form).getByRole('button', { name: 'Create agreement' }));

    expect(await within(form).findByText(/cannot end before it starts/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New agreement' })).not.toBeInTheDocument();
  });

  it('a network failure is plain text', async () => {
    const { user, form } = await open((r) => { if (r.method === 'POST') throw new Error('network down'); return undefined; });
    await user.type(within(form).getByLabelText(/Reference/), 'NET');
    await user.type(within(form).getByLabelText('First day'), '2026-01-01');
    await user.type(within(form).getByLabelText('Last day'), '2026-02-01');
    await user.click(within(form).getByRole('button', { name: 'Create agreement' }));

    expect(await within(form).findByText('network down')).toBeInTheDocument();
  });
});

describe('an agreement in detail', () => {
  async function select(extra: Handler = () => undefined, over: Record<string, unknown> = {}) {
    const { impl, calls } = fakeFetch(server([vendor()], [agreement(over)], extra));
    renderWithSession(<VendorsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'WTY-1' }));
    return { user, calls, detail: await screen.findByRole('complementary', { name: 'Agreement detail' }) };
  }

  it('shows the vendor, the kind, the days in force, the notice, the asset and the history', async () => {
    const { detail } = await select();

    expect(await within(detail).findByText(/2026-01-01 to 2026-12-31 \(74 days left\)/)).toBeInTheDocument();
    expect(within(detail).getByText('Dell')).toBeInTheDocument();
    expect(within(detail).getByText('WARRANTY')).toBeInTheDocument();
    expect(within(detail).getByText('30 days before the end')).toBeInTheDocument();
    expect(within(detail).getByText('a1')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('says when it renews itself, shows no asset line when none is covered, and a history entry without a detail shows none', async () => {
    const { detail } = await select((r) => (r.url.pathname.endsWith('/audit-log/retrieve') ? { body: [{ occurredAt: '2026-10-01T10:00:00Z', action: 'PAUSED', executor: 'x', toStatus: 'PAUSED' }] } : undefined),
      { autoRenew: true, assetId: undefined });

    expect(await within(detail).findByText(/renews itself \(not followed here\)/)).toBeInTheDocument();
    expect(within(detail).queryByText('Asset')).not.toBeInTheDocument();
    expect(await within(detail).findByText('PAUSED', { selector: 'strong' })).toBeInTheDocument();
  });

  it('pauses and resumes, and closes', async () => {
    const { user, detail, calls } = await select();
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/pause'))).toBe(true));
    await user.click(await within(detail).findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/resume'))).toBe(true));
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Agreement detail' })).not.toBeInTheDocument();
  });

  it('renews with a new last day and sends the rest as it was; nothing is sent without a day', async () => {
    const { user, detail, calls } = await select();
    const renew = within(await within(detail).findByRole('form', { name: 'Renew' }));
    expect(renew.getByRole('button', { name: 'Renew' })).toBeDisabled();
    await user.type(renew.getByLabelText(/new last day/), '2028-12-31');
    await user.click(renew.getByRole('button', { name: 'Renew' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/update'))).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.url.pathname.endsWith('/update'))!.body).toEqual({
      kind: 'WARRANTY', assetId: 'a1', startsOn: '2026-01-01', endsOn: '2028-12-31', noticeDays: 30, autoRenew: false,
    });
    await waitFor(() => expect(renew.getByLabelText(/new last day/)).toHaveValue(''));
  });

  it('submitting the renewal form with no day does nothing', async () => {
    const { detail, calls } = await select();
    const form = await within(detail).findByRole('form', { name: 'Renew' });
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('shows why a change was refused', async () => {
    const { user, detail } = await select((r) => (r.method === 'PUT' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-VND-00409', detail: 'Illegal transition.' } } : undefined));
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('ERR-VND-00409')).toBeInTheDocument();
  });

  it('a failure that is not a problem document is plain text', async () => {
    const { user, detail } = await select((r) => { if (r.method === 'PUT') throw new Error('network down'); return undefined; });
    await user.click(await within(detail).findByRole('button', { name: 'Pause' }));

    expect(await within(detail).findByText('network down')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Vendors link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/vendors');
    expect(await screen.findByRole('heading', { name: 'Vendors', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vendors' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Agreements' })).toBeInTheDocument();
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { ProcurementPage } from './Procurement';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1', organisationId: ORG, reference: 'PO-2026-001', vendorId: 'v1', requesterId: 'u1', currency: 'BRL', total: 15100, expectedOn: '2026-11-30', status: 'DRAFT',
  fulfilment: 'NOT_ORDERED', late: false, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z',
  lines: [
    { lineNo: 1, category: 'HARDWARE', item: 'LAP-14', quantity: 10, unitPrice: 1500, received: 0, remaining: 10 },
    { lineNo: 2, category: 'SOFTWARE', item: 'OFFICE-E3', quantity: 5, unitPrice: 20, received: 0, remaining: 5 },
  ], ...over,
});

const trail = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'DRAFT', detail: 'Drafted with 2 line(s) in BRL.' }];
const receipts = [{ lineNo: 1, deliveryRef: 'DN-100', quantity: 4, receivedAt: '2026-10-05T10:00:00Z', reportedBy: 'dock-1' }];

function server(orders: Record<string, unknown>[] = [order()], extra: Handler = () => undefined, receiptList: unknown[] = []) {
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (path.endsWith('/receipt/retrieve')) return { body: receiptList };
    if (r.method === 'POST' && path.endsWith('/receipt/initiate')) return { status: 201, body: receipts[0] };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: order({ id: 'o2', reference: (r.body as { reference: string }).reference }) };
    if (r.method === 'PUT') return path.endsWith('/approval/capture') ? { body: order({ status: 'APPROVED' }) } : { status: 204 };
    if (r.method === 'GET' && path.split('/').length === 5 && path.endsWith('/retrieve')) return { body: orders };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: orders.find((o) => path.includes(`/${o.id}/`)) ?? orders[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows each order with its status, total, receiving state and lateness, and the tiles', async () => {
    const { impl } = fakeFetch(server([
      order(),
      order({ id: 'o3', reference: 'PO-LATE', status: 'ORDERED', fulfilment: 'PARTIAL', late: true, total: 99.5, currency: 'USD', expectedOn: undefined }),
      order({ id: 'o4', reference: 'PO-WAIT', status: 'PENDING_APPROVAL' }),
      order({ id: 'o5', reference: 'PO-OK', status: 'APPROVED' }),
    ]));
    renderWithSession(<ProcurementPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'PO-2026-001' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('DRAFT')).toBeInTheDocument();
    expect(within(row).getByText('15100.00 BRL')).toBeInTheDocument();
    expect(within(row).getByText('2026-11-30')).toBeInTheDocument();
    const late = screen.getByRole('button', { name: 'PO-LATE' }).closest('tr') as HTMLElement;
    expect(within(late).getByText('PARTIAL')).toBeInTheDocument();
    expect(within(late).getByText('LATE')).toBeInTheDocument();
    expect(within(late).getByText('99.50 USD')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('Total')).toBeInTheDocument();
    expect(tiles.getByText('Late').previousElementSibling).toHaveTextContent('1');
    expect(tiles.getByText('Waiting for approval').previousElementSibling).toHaveTextContent('1');
    expect(tiles.getByText('Approved, not placed').previousElementSibling).toHaveTextContent('1');
    expect(tiles.getByText('Placed').previousElementSibling).toHaveTextContent('1');
  });

  it('filters by status, currency, receiving state and lateness, and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<ProcurementPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No purchase orders match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'ORDERED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('ORDERED'));
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('currency')).toBe('USD'));
    await user.selectOptions(screen.getByLabelText('Received'), 'PARTIAL');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('fulfilment')).toBe('PARTIAL'));
    await user.click(screen.getByLabelText('Late only'));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('late')).toBe('true'));
    await user.click(screen.getByLabelText('Late only'));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('late')).toBeNull());
  });

  it('shows the problem when the orders cannot be read', async () => {
    const { impl } = fakeFetch(server([], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-PRC-00403', detail: 'Staff only.' } })));
    renderWithSession(<ProcurementPage />, impl, me);

    expect((await screen.findAllByText('ERR-PRC-00403')).length).toBeGreaterThan(0);
  });
});

describe('a new order', () => {
  async function open() {
    const { impl, calls } = fakeFetch(server([order()]));
    renderWithSession(<ProcurementPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'PO-2026-001' });
    await user.click(screen.getByRole('button', { name: 'New order' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New order' }) };
  }

  it('needs a reference, a vendor and a complete line; sends the lines in numbers and no day unless one is given; opens the new order', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create order' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Reference'), ' PO-9 ');
    await user.type(within(form).getByLabelText('Vendor (id)'), ' v9 ');
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Item 1'), ' LAP-14 ');
    await user.clear(within(form).getByLabelText('Quantity 1'));
    await user.type(within(form).getByLabelText('Quantity 1'), '3');
    await user.type(within(form).getByLabelText('Unit price 1'), '1500.50');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New order' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      reference: 'PO-9', vendorId: 'v9', requesterId: me.executor, currency: 'BRL', lines: [{ category: 'HARDWARE', item: 'LAP-14', quantity: 3, unitPrice: 1500.5 }],
    });
    expect(await screen.findByRole('complementary', { name: 'Order detail' })).toBeInTheDocument();
  });

  it('adds and removes lines, sends the currency, the category and the expected day that were chosen', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText('Reference'), 'PO-10');
    await user.type(within(form).getByLabelText('Vendor (id)'), 'v1');
    await user.selectOptions(within(form).getByLabelText('Currency'), 'EUR');
    await user.type(within(form).getByLabelText('Expected on (optional)'), '2026-12-01');
    await user.type(within(form).getByLabelText('Item 1'), 'A');
    await user.type(within(form).getByLabelText('Unit price 1'), '1');
    await user.click(within(form).getByRole('button', { name: 'Add a line' }));
    await user.selectOptions(within(form).getByLabelText('Category 2'), 'CLOUD');
    await user.type(within(form).getByLabelText('Item 2'), 'RI-1Y');
    await user.type(within(form).getByLabelText('Unit price 2'), '2');
    await user.click(within(form).getByRole('button', { name: 'Add a line' }));
    await user.click(within(form).getByRole('button', { name: 'Remove line 3' }));
    expect(within(form).queryByLabelText('Item 3')).not.toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Create order' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      currency: 'EUR', expectedOn: '2026-12-01', lines: [{ category: 'HARDWARE', item: 'A' }, { category: 'CLOUD', item: 'RI-1Y', unitPrice: 2 }],
    });
  });

  it('shows the problem when the order is refused and can be cancelled', async () => {
    const { impl } = fakeFetch(server([order()], (r) => (r.method === 'POST' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-PRC-00409', detail: 'A purchase order with that reference exists.' } } : undefined)));
    renderWithSession(<ProcurementPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'PO-2026-001' });
    await user.click(screen.getByRole('button', { name: 'New order' }));
    const form = screen.getByRole('form', { name: 'New order' });
    await user.type(within(form).getByLabelText('Reference'), 'PO-1');
    await user.type(within(form).getByLabelText('Vendor (id)'), 'v1');
    await user.type(within(form).getByLabelText('Item 1'), 'A');
    await user.type(within(form).getByLabelText('Unit price 1'), '1');
    await user.click(within(form).getByRole('button', { name: 'Create order' }));

    expect(await within(form).findByText('ERR-PRC-00409')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New order' })).not.toBeInTheDocument();
  });
});

describe('one order', () => {
  async function select(orders: Record<string, unknown>[], extra: Handler = () => undefined, receiptList: unknown[] = []) {
    const { impl, calls } = fakeFetch(server(orders, extra, receiptList));
    renderWithSession(<ProcurementPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: orders[0].reference as string }));
    const detail = await screen.findByRole('complementary', { name: 'Order detail' });
    await within(detail).findByRole('table', { name: 'Lines' });
    return { user, calls, detail };
  }

  it('shows the lines with what was received and what is left, the vendor, the requester and the history, and closes', async () => {
    const { user, detail } = await select([order({ status: 'ORDERED', fulfilment: 'PARTIAL', orderedAt: '2026-10-02T09:00:00Z', lines: [
      { lineNo: 1, category: 'HARDWARE', item: 'LAP-14', quantity: 10, unitPrice: 1500, received: 4, remaining: 6 },
    ] })], () => undefined, receipts);

    const lines = within(within(detail).getByRole('table', { name: 'Lines' }));
    expect(lines.getByText('LAP-14')).toBeInTheDocument();
    expect(lines.getByText('6')).toBeInTheDocument();
    expect(within(detail).getByText('v1')).toBeInTheDocument();
    expect(within(detail).getByText('u1')).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
    expect(within(within(detail).getByRole('table', { name: 'Receipts' })).getByText('DN-100')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Order detail' })).not.toBeInTheDocument();
  });

  it('a draft is sent for approval or cancelled; an empty draft cannot be sent', async () => {
    const { user, detail, calls } = await select([order()]);

    await user.click(within(detail).getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/submit'))).toBe(true));
    await user.click(within(detail).getByRole('button', { name: 'Cancel order' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/cancel'))).toBe(true));
  });

  it('an empty draft cannot be sent for approval', async () => {
    const { detail } = await select([order({ lines: [], total: 0 })]);

    expect(within(detail).getByRole('button', { name: 'Send for approval' })).toBeDisabled();
  });

  it('an order waiting for approval takes a decision from an approver: approve or reject, forwarded as that approver', async () => {
    const { user, detail, calls } = await select([order({ status: 'PENDING_APPROVAL' })]);
    const decision = within(detail).getByRole('form', { name: 'Decision' });
    expect(within(decision).getByRole('button', { name: 'Approve' })).toBeDisabled();

    await user.type(within(decision).getByLabelText('Approver (id)'), ' a1 ');
    await user.click(within(decision).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/approval/capture'))?.body).toEqual({ approverId: 'a1', outcome: 'APPROVE' }));
    await user.click(within(decision).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(calls.filter((c) => c.url.pathname.endsWith('/approval/capture')).at(-1)!.body).toEqual({ approverId: 'a1', outcome: 'REJECT' }));
  });

  it('an approved order is placed with the vendor', async () => {
    const { user, detail, calls } = await select([order({ status: 'APPROVED' })]);

    await user.click(within(detail).getByRole('button', { name: 'Place with the vendor' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/place'))).toBe(true));
  });

  it('a placed order takes receipts: the line, the delivery reference and the quantity; the form empties after a receipt', async () => {
    const { user, detail, calls } = await select([order({ status: 'ORDERED', fulfilment: 'NONE' })]);
    const form = within(detail).getByRole('form', { name: 'Receive goods' });
    expect(within(form).getByRole('button', { name: 'Record receipt' })).toBeDisabled();

    await user.selectOptions(within(form).getByLabelText('Line'), '2');
    await user.type(within(form).getByLabelText('Delivery reference'), ' DN-7 ');
    await user.type(within(form).getByLabelText('Quantity received'), '3');
    await user.click(within(form).getByRole('button', { name: 'Record receipt' }));

    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/receipt/initiate'))?.body).toEqual({ lineNo: 2, deliveryRef: 'DN-7', quantity: 3 }));
    await waitFor(() => expect(within(form).getByLabelText('Delivery reference')).toHaveValue(''));
    expect(within(detail).getByText('Nothing received yet.')).toBeInTheDocument();
  });

  it('a placed order with nothing received can be cancelled', async () => {
    const { detail } = await select([order({ status: 'ORDERED', fulfilment: 'NONE' })]);

    expect(within(detail).getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
  });

  it('a cancelled order has no actions', async () => {
    const { detail } = await select([order({ status: 'CANCELLED' })]);

    expect(within(detail).queryByRole('button', { name: /Cancel order|Send for approval|Place with the vendor/ })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('form')).not.toBeInTheDocument();
  });

  it('shows the refusal when an action is refused', async () => {
    const { user, detail } = await select([order({ status: 'APPROVED' })], (r) => (r.method === 'PUT' && r.url.pathname.endsWith('/control/place') ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-PRC-00409', detail: 'Changed by someone else.' } } : undefined));

    await user.click(within(detail).getByRole('button', { name: 'Place with the vendor' }));
    expect((await screen.findAllByText('ERR-PRC-00409')).length).toBeGreaterThan(0);
  });

  it('shows the problem when one order cannot be read', async () => {
    const { impl } = fakeFetch(server([order()], (r) => (/\/o1\/retrieve$/.test(r.url.pathname) ? { status: 404, body: { title: 'Not Found', error_code: 'ERR-PRC-00404', detail: 'Gone.' } } : undefined)));
    renderWithSession(<ProcurementPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'PO-2026-001' }));

    expect((await screen.findAllByText('ERR-PRC-00404')).length).toBeGreaterThan(0);
  });
});

describe('the menu', () => {
  it('has a Procurement entry that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/procurement');

    expect(await screen.findByRole('heading', { name: 'Procurement' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Procurement' })).toBeInTheDocument();
  });
});

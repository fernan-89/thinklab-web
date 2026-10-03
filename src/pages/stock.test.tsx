import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { StockPage } from './Stock';

beforeEach(() => sessionStorage.clear());

const item = (over: Record<string, unknown> = {}) => ({
  id: 's1', organisationId: ORG, sku: 'TONER-85A', name: 'HP 85A toner', unit: 'unit', onHand: 10, reorderLevel: 3, belowReorderLevel: false,
  status: 'ACTIVE', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', ...over,
});
const entry = (action: string, quantity: number, balanceAfter: number, reason?: string) => ({
  occurredAt: '2026-10-03T12:00:00Z', action, executor: 'tester', quantity, balanceAfter, reason,
});
const server = (items: Record<string, unknown>[], extra: Handler = () => undefined): Handler => (r) => {
  const custom = extra(r);
  if (custom) return custom;
  if (r.url.pathname.endsWith('/low-stock/retrieve')) return { body: items.filter((i) => i.belowReorderLevel) };
  if (r.url.pathname.endsWith('/history/retrieve')) return { body: [entry('ISSUED', -2, 8, 'printers'), entry('INITIATED', 10, 10)] };
  if (r.url.pathname.endsWith('/retrieve') && r.url.pathname.split('/').length === 6) return { body: items[0] };
  if (r.url.pathname.endsWith('/retrieve')) return { body: items };
  return undefined;
};

describe('StockPage', () => {
  it('lists the items with a low flag, searches by SKU or name, and shows only low stock on request', async () => {
    const items = [item(), item({ id: 's2', sku: 'CABLE-1M', name: 'Patch cable', onHand: 2, belowReorderLevel: true })];
    const { impl, calls } = fakeFetch(server(items));
    renderWithSession(<StockPage />, impl);
    const user = userEvent.setup();

    expect(await screen.findByRole('button', { name: 'TONER-85A' })).toBeInTheDocument();
    expect(screen.getByText('2 unit')).toBeInTheDocument();
    expect(screen.getAllByText('low')).toHaveLength(1);

    await user.type(screen.getByLabelText('Search by SKU or name'), 'cable');
    expect(screen.queryByRole('button', { name: 'TONER-85A' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CABLE-1M' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search by SKU or name'));

    await user.click(screen.getByLabelText('Only low stock'));
    await waitFor(() => expect(calls.at(-1)!.url.pathname).toMatch(/low-stock\/retrieve$/));
    expect(screen.getByLabelText('Status')).toBeDisabled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'TONER-85A' })).not.toBeInTheDocument());
  });

  it('filters by status and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server([]));
    renderWithSession(<StockPage />, impl);
    const user = userEvent.setup();

    expect(await screen.findByText('No items match.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'DISCONTINUED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('DISCONTINUED'));
  });

  it('registers an item, selects it, and shows a refused duplicate SKU', async () => {
    let attempt = 0;
    const { impl, calls } = fakeFetch(server([item()], (r) => {
      if (r.method !== 'POST') return undefined;
      attempt += 1;
      return attempt === 1
        ? { status: 409, body: { title: 'Conflict', detail: 'SKU taken', error_code: 'ERR-STK-00409' } }
        : { status: 201, body: item({ id: 's9', sku: 'NEW-1' }) };
    }));
    renderWithSession(<StockPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New item' }));
    const form = screen.getByRole('form', { name: 'New stock item' });
    const submit = within(form).getByRole('button', { name: 'Register item' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('SKU'), 'new-1');
    await user.type(within(form).getByLabelText('Name'), 'New thing');
    await user.clear(within(form).getByLabelText('Reorder level'));
    await user.type(within(form).getByLabelText('Reorder level'), 'x');
    expect(submit).toBeDisabled();
    await user.clear(within(form).getByLabelText('Reorder level'));
    await user.type(within(form).getByLabelText('Reorder level'), '4');
    await user.clear(within(form).getByLabelText('Opening quantity'));
    await user.type(within(form).getByLabelText('Opening quantity'), '7');
    await user.click(submit);

    expect(await within(form).findByRole('alert')).toHaveTextContent('ERR-STK-00409');
    expect(within(form).getByLabelText('SKU')).toHaveValue('new-1');
    await user.click(within(form).getByRole('button', { name: 'Register item' }));

    expect(await screen.findByRole('complementary', { name: 'Stock item detail' })).toBeInTheDocument();
    const post = calls.filter((c) => c.method === 'POST').at(-1)!;
    expect(post.url.pathname).toBe('/api/consumable-inventory/v1/initiate');
    expect(post.body).toEqual({ sku: 'new-1', name: 'New thing', unit: 'unit', reorderLevel: 4, initialQuantity: 7 });
    expect(screen.queryByRole('form', { name: 'New stock item' })).not.toBeInTheDocument();
  });

  it('cancels the new item form', async () => {
    const { impl } = fakeFetch(server([item()]));
    renderWithSession(<StockPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New item' }));
    await user.click(within(screen.getByRole('form', { name: 'New stock item' })).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('form', { name: 'New stock item' })).not.toBeInTheDocument();
  });

  it('shows the item with its history and moves stock: receive, issue (a refusal is shown) and a counted adjustment', async () => {
    let issueAttempts = 0;
    const { impl, calls } = fakeFetch(server([item()], (r) => {
      if (r.method !== 'PUT') return undefined;
      if (r.url.pathname.endsWith('/movement/issue') && ++issueAttempts === 1) {
        return { status: 409, body: { title: 'Conflict', detail: 'Cannot issue 99: only 10 on hand.', error_code: 'ERR-STK-00409' } };
      }
      return { status: 204 };
    }));
    renderWithSession(<StockPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'TONER-85A' }));
    const detail = await screen.findByRole('complementary', { name: 'Stock item detail' });
    expect(await within(detail).findByText(/ISSUED/)).toBeInTheDocument();
    expect(within(detail).getByText(/- -2 \(balance 8\)/)).toBeInTheDocument();
    expect(within(detail).getByText(/INITIATED/)).toBeInTheDocument();
    expect(within(detail).getByText(/\+10 \(balance 10\)/)).toBeInTheDocument();

    const form = within(detail).getByRole('form', { name: 'Move stock' });
    const apply = within(form).getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    await user.type(within(form).getByLabelText('Quantity'), '5');
    await user.type(within(form).getByLabelText(/Reason/), 'delivery');
    await user.click(apply);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ quantity: 5, reason: 'delivery' }));
    expect(calls.find((c) => c.method === 'PUT')!.url.pathname).toMatch(/\/s1\/movement\/receive$/);
    await waitFor(() => expect(within(form).getByLabelText('Quantity')).toHaveValue(''));

    await user.selectOptions(within(form).getByLabelText('Movement'), 'issue');
    await user.type(within(form).getByLabelText('Quantity'), '99');
    await user.click(apply);
    expect(await within(detail).findByRole('alert')).toHaveTextContent('only 10 on hand');
    await user.click(apply);
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT' && c.url.pathname.endsWith('/movement/issue'))).toHaveLength(2));
    expect(calls.filter((c) => c.url.pathname.endsWith('/movement/issue'))[0].body).toEqual({ quantity: 99 });

    await user.selectOptions(within(form).getByLabelText('Movement'), 'adjust');
    await user.type(within(form).getByLabelText('Counted quantity'), '8');
    expect(apply).toBeDisabled();
    await user.type(within(form).getByLabelText('Reason (required)'), 'recount');
    await user.click(apply);
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/movement/adjust') && JSON.stringify(c.body) === JSON.stringify({ newQuantity: 8, reason: 'recount' }))).toBe(true));
  });

  it('discontinues an item, after which no movement form is offered, and closes the panel', async () => {
    let discontinued = false;
    const { impl, calls } = fakeFetch((r) => {
      if (r.method === 'PUT' && r.url.pathname.endsWith('/control/discontinue')) {
        discontinued = true;
        return { status: 204 };
      }
      return server([item({ status: discontinued ? 'DISCONTINUED' : 'ACTIVE' })])(r);
    });
    renderWithSession(<StockPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'TONER-85A' }));
    const detail = await screen.findByRole('complementary', { name: 'Stock item detail' });
    await user.click(await within(detail).findByRole('button', { name: 'Discontinue' }));

    await waitFor(() => expect(within(detail).queryByRole('form', { name: 'Move stock' })).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/discontinue'))).toBe(true);
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Stock item detail' })).not.toBeInTheDocument();
  });

  it('is reachable from the navigation', async () => {
    const { impl } = fakeFetch(server([item()]));
    renderWithSession(<App />, impl, undefined, '/stock');

    expect(await screen.findByRole('heading', { name: 'Stock' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock' })).toBeInTheDocument();
  });
});

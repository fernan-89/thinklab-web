import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { CloudInventoryPage } from './CloudInventory';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const resource = (over: Record<string, unknown> = {}) => ({
  id: 'r1', organisationId: ORG, accountId: 'a1', provider: 'AWS', externalId: 'arn:aws:ec2:us-east-1:123456789012:instance/i-0abc', name: 'web-1', kind: 'COMPUTE',
  region: 'us-east-1', state: 'RUNNING', tags: { environment: 'prod', owner: 'team-a' }, presence: 'PRESENT', firstSeenAt: '2026-10-01T10:00:00Z',
  lastSeenAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-10T09:00:00Z', ...over,
});

const summary = { total: 3, byProvider: { AWS: 2, AZURE: 1 }, byKind: { COMPUTE: 3 }, byState: { RUNNING: 2, TERMINATED: 1 }, byPresence: { PRESENT: 1, MISSING: 1, GONE: 1 } };

function server(resources: Record<string, unknown>[] = [resource()], extra: Handler = () => undefined) {
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/summary/retrieve')) return { body: summary };
    if (path.split('/').length === 5 && path.endsWith('/retrieve')) return { body: resources };
    if (path.endsWith('/retrieve')) return { body: resources.find((x) => path.includes(`/${x.id}/`)) ?? resources[0] };
    return undefined;
  };
  return handler;
}

describe('the list and the summary', () => {
  it('shows each resource with its kind, region, state and presence, and the tiles from the summary', async () => {
    const { impl } = fakeFetch(server([
      resource(),
      resource({ id: 'r2', name: 'vm1', provider: 'AZURE', region: 'brazilsouth', presence: 'MISSING' }),
      resource({ id: 'r3', name: 'old-db', kind: 'DATABASE', state: 'TERMINATED', presence: 'GONE' }),
    ]));
    renderWithSession(<CloudInventoryPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'web-1' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('PRESENT')).toBeInTheDocument();
    expect(within(row).getByText('us-east-1')).toBeInTheDocument();
    const azure = screen.getByRole('button', { name: 'vm1' }).closest('tr') as HTMLElement;
    expect(within(azure).getByText('MISSING')).toBeInTheDocument();
    expect(within(azure).getByText('brazilsouth')).toBeInTheDocument();
    const gone = screen.getByRole('button', { name: 'old-db' }).closest('tr') as HTMLElement;
    expect(within(gone).getByText('GONE')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    expect(await tiles.findByText('Total')).toBeInTheDocument();
    expect(tiles.getByText('Missing').previousElementSibling).toHaveTextContent('1');
    expect(tiles.getByText('AWS').previousElementSibling).toHaveTextContent('2');
    expect(tiles.getByText('Azure').previousElementSibling).toHaveTextContent('1');
  });

  it('shows zeros when the summary has no one of a kind, and dashes while it has not arrived', async () => {
    const { impl } = fakeFetch(server([], (r) => (r.url.pathname.endsWith('/summary/retrieve') ? { body: { total: 0, byProvider: {}, byKind: {}, byState: {}, byPresence: {} } } : undefined)));
    renderWithSession(<CloudInventoryPage />, impl, me);

    expect(await screen.findByText('No resources match.')).toBeInTheDocument();
    const tiles = within(screen.getByLabelText('Summary'));
    await waitFor(() => expect(tiles.getByText('Gone').previousElementSibling).toHaveTextContent('0'));
    expect(tiles.getByText('Azure').previousElementSibling).toHaveTextContent('0');
  });

  it('filters by provider, kind, state and presence, and asks the service for each', async () => {
    const { impl, calls } = fakeFetch(server([resource()]));
    renderWithSession(<CloudInventoryPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'web-1' });

    await user.selectOptions(screen.getByLabelText('Provider'), 'AZURE');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('provider')).toBe('AZURE'));
    await user.selectOptions(screen.getByLabelText('Kind'), 'DATABASE');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('kind')).toBe('DATABASE'));
    await user.selectOptions(screen.getByLabelText('State'), 'STOPPED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('state')).toBe('STOPPED'));
    await user.selectOptions(screen.getByLabelText('Presence'), 'MISSING');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('presence')).toBe('MISSING'));
    await user.selectOptions(screen.getByLabelText('Presence'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('presence')).toBeNull());
  });

  it('shows the problem when the inventory cannot be read', async () => {
    const { impl } = fakeFetch(server([], () => ({ status: 403, body: { title: 'Forbidden', error_code: 'ERR-INV-00403', detail: 'Staff only.' } })));
    renderWithSession(<CloudInventoryPage />, impl, me);

    expect((await screen.findAllByText('ERR-INV-00403')).length).toBeGreaterThan(0);
  });
});

describe('one resource', () => {
  it('opens the detail with the provider id, the account, the moments and the tags, and closes it', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<CloudInventoryPage />, impl, me);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'web-1' }));
    const detail = await screen.findByRole('complementary', { name: 'Resource detail' });
    expect(await within(detail).findByText('arn:aws:ec2:us-east-1:123456789012:instance/i-0abc')).toBeInTheDocument();
    expect(within(detail).getByText('a1')).toBeInTheDocument();
    expect(within(detail).getByText('AWS, compute, in us-east-1')).toBeInTheDocument();
    const tags = within(within(detail).getByLabelText('Tags'));
    expect(tags.getByText('environment')).toBeInTheDocument();
    expect(tags.getByText('team-a')).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Resource detail' })).not.toBeInTheDocument();
  });

  it('says so when a resource has no tags, and shows the problem when it cannot be read', async () => {
    const { impl } = fakeFetch(server([resource({ tags: {} })]));
    renderWithSession(<CloudInventoryPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'web-1' }));
    expect(await screen.findByText('No tags reported.')).toBeInTheDocument();
  });

  it('shows the problem when one resource cannot be read', async () => {
    const { impl } = fakeFetch(server([resource()], (r) => (/\/r1\/retrieve$/.test(r.url.pathname) ? { status: 404, body: { title: 'Not Found', error_code: 'ERR-INV-00404', detail: 'Gone.' } } : undefined)));
    renderWithSession(<CloudInventoryPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'web-1' }));

    expect((await screen.findAllByText('ERR-INV-00404')).length).toBeGreaterThan(0);
  });
});

describe('the menu', () => {
  it('has a Cloud inventory entry that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/cloud-inventory');

    expect(await screen.findByRole('heading', { name: 'Cloud inventory' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cloud inventory' })).toBeInTheDocument();
  });
});

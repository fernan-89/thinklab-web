import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeFetch, jwtWith, ORG, renderWithSession, type Handler } from '../test-utils';
import { App } from '../App';
import { AssetsPage } from './Assets';
import { AuditPage } from './Audit';
import { DiscoveryPage } from './Discovery';
import { LoginPage } from './Login';
import { TopologyPage } from './Topology';

beforeEach(() => sessionStorage.clear());

const asset = (over: Record<string, unknown> = {}) => ({
  id: 'a1', organisationId: ORG, name: 'Core switch', category: 'NETWORK_DEVICE', serialNumber: 'SN-1', status: 'READY',
  createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', ...over,
});


describe('LoginPage', () => {
  function renderLogin(handler: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(handler);
    renderWithSession(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/assets" element={<p>assets page</p>} />
      </Routes>,
      impl, null, '/login',
    );
    return calls;
  }

  it('only enables Continue for a valid organisation id and a name, then stores the session', async () => {
    renderLogin();
    const user = userEvent.setup();
    const submit = screen.getByRole('button', { name: 'Continue' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Organisation ID'), 'nope');
    expect(screen.getByText('That is not a valid UUID.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Organisation ID'));
    await user.type(screen.getByLabelText('Organisation ID'), ORG);
    await user.type(screen.getByLabelText(/Your name/), 'alice');
    await user.click(submit);

    expect(await screen.findByText('assets page')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('thinklab.session')!)).toEqual({ organisationId: ORG, executor: 'alice' });
  });

  it('signs in with an account and keeps the access token', async () => {
    const calls = renderLogin((r) => (r.url.pathname.endsWith('/session/initiate') ? { body: { accessToken: jwtWith({ sub: 'user-42' }), tokenType: 'Bearer', expiresIn: 900, refreshToken: 'r' } } : undefined));
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'Account' }));
    await user.type(screen.getByLabelText('Organisation ID'), ORG);
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('assets page')).toBeInTheDocument();
    expect(calls[0].body).toEqual({ organisationId: ORG, email: 'a@b.co', password: 'secret' });
    const stored = JSON.parse(sessionStorage.getItem('thinklab.session')!);
    expect(stored.accessToken).toBe(jwtWith({ sub: 'user-42' }));
    // Data minimisation: the executor sent to the platform is the opaque token subject, never the email.
    expect(stored.executor).toBe('user-42');
    expect(stored.displayName).toBe('a@b.co');
    expect(calls.every((c) => c.headers.get('X-Executor') !== 'a@b.co')).toBe(true);
  });

  it('shows the problem returned for bad credentials and stays on the page', async () => {
    renderLogin(() => ({ status: 401, body: { title: 'Unauthorized', detail: 'Invalid credentials', error_code: 'ERR-AUTH-00401' } }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'Account' }));
    await user.type(screen.getByLabelText('Organisation ID'), ORG);
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ERR-AUTH-00401');
    expect(screen.queryByText('assets page')).not.toBeInTheDocument();
  });
});

describe('App routing', () => {
  it('sends a visitor without a session to the login page', () => {
    const { impl } = fakeFetch(() => undefined);
    renderWithSession(<App />, impl, null, '/assets');

    expect(screen.getByRole('heading', { name: 'ThinkLab' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('shows the navigation for a signed-in user and signs out', async () => {
    const { impl } = fakeFetch(() => ({ body: [] }));
    renderWithSession(<App />, impl, undefined, '/assets');
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(sessionStorage.getItem('thinklab.session')).toBeNull();
  });
});

describe('AssetsPage', () => {
  it('lists assets, filters by status server-side, and searches client-side', async () => {
    const { impl, calls } = fakeFetch((r) =>
      r.url.pathname.endsWith('/it-asset-registry/v1/retrieve')
        ? { body: [asset(), asset({ id: 'a2', name: 'Edge router', serialNumber: 'SN-2' })] }
        : undefined);
    renderWithSession(<AssetsPage />, impl);
    const user = userEvent.setup();

    expect(await screen.findByText('Core switch')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search by name or serial'), 'router');
    expect(screen.queryByText('Core switch')).not.toBeInTheDocument();
    expect(screen.getByText('Edge router')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'DEPLOYED');
    await waitFor(() => expect(calls.at(-1)!.url.search).toBe('?status=DEPLOYED'));
  });

  it('opens an asset, offers only the legal transitions, runs one and reloads', async () => {
    let status = 'READY';
    const { impl, calls } = fakeFetch((r) => {
      if (r.method === 'PUT' && r.url.pathname.endsWith('/control/deploy')) { status = 'DEPLOYED'; return { status: 204 }; }
      if (r.url.pathname.endsWith('/a1/retrieve')) return { body: asset({ status, specifications: { cpu: 'Xeon' } }) };
      if (r.url.pathname.endsWith('/audit-log/retrieve')) return { body: [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'alice', toStatus: 'PROVISIONED' }] };
      if (r.url.pathname.endsWith('/retrieve')) return { body: [asset({ status })] };
      return undefined;
    });
    renderWithSession(<AssetsPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Core switch' }));
    const detail = await screen.findByRole('complementary', { name: 'Asset detail' });
    expect(await screen.findByText('Xeon')).toBeInTheDocument();
    expect(detail).toHaveTextContent('INITIATED');
    expect(screen.queryByRole('button', { name: 'Start maintenance' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deploy' }));

    expect(await screen.findByRole('button', { name: 'Start maintenance' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/a1/control/deploy'))).toBe(true);
  });

  it('shows the API problem when a transition is refused', async () => {
    const { impl } = fakeFetch((r) => {
      if (r.method === 'PUT') return { status: 409, body: { title: 'Conflict', detail: 'Illegal state transition', error_code: 'ERR-AST-00409' } };
      if (r.url.pathname.endsWith('/a1/retrieve')) return { body: asset() };
      if (r.url.pathname.endsWith('/audit-log/retrieve')) return { body: [] };
      return { body: [asset()] };
    });
    renderWithSession(<AssetsPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Core switch' }));
    await user.click(await screen.findByRole('button', { name: 'Deploy' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ERR-AST-00409');
  });

  it('says so when nothing matches', async () => {
    const { impl } = fakeFetch(() => ({ body: [] }));
    renderWithSession(<AssetsPage />, impl);

    expect(await screen.findByText('No assets match.')).toBeInTheDocument();
  });
});

describe('DiscoveryPage', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: 'd1', organisationId: ORG, source: 'manual', externalKey: 'host-1', name: 'host-1', status: 'DISCOVERED',
    rawAttributes: { os: 'linux' }, firstSeenAt: '2026-10-01T10:00:00Z', lastSeenAt: '2026-10-01T10:00:00Z',
    createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', ...over,
  });

  it('claims a discovered item for review', async () => {
    const { impl, calls } = fakeFetch((r) => {
      if (r.method === 'PUT') return { status: 204 };
      return { body: [item()] };
    });
    renderWithSession(<DiscoveryPage />, impl);
    const user = userEvent.setup();

    expect(await screen.findByText('linux')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Claim for review' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/d1/review/claim'))).toBe(true));
  });

  it('keeps Promote disabled until a category is saved, then shows the schema violations the registry returns', async () => {
    let suggestedCategory: string | undefined;
    const { impl, calls } = fakeFetch((r) => {
      if (r.url.pathname.endsWith('/review/update')) { suggestedCategory = (r.body as { suggestedCategory: string }).suggestedCategory; return { status: 204 }; }
      if (r.url.pathname.endsWith('/control/promote')) {
        return { status: 422, body: { title: 'Unprocessable Entity', detail: 'Schema violated', error_code: 'ERR-DSC-00422', violations: ['$.cpu: is missing'] } };
      }
      return { body: [item({ status: 'UNDER_REVIEW', suggestedCategory })] };
    });
    renderWithSession(<DiscoveryPage />, impl);
    const user = userEvent.setup();

    const promote = await screen.findByRole('button', { name: 'Promote to asset' });
    expect(promote).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Category'), 'SERVER');
    await user.click(screen.getByRole('button', { name: 'Save category' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Promote to asset' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Promote to asset' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ERR-DSC-00422');
    expect(alert).toHaveTextContent('$.cpu: is missing');
    expect(calls.some((c) => c.url.pathname.endsWith('/review/update') && (c.body as { suggestedCategory: string }).suggestedCategory === 'SERVER')).toBe(true);
  });

  it('shows the asset a promoted item became', async () => {
    const { impl } = fakeFetch(() => ({ body: [item({ status: 'PROMOTED', promotedAssetId: 'asset-77' })] }));
    renderWithSession(<DiscoveryPage />, impl);

    expect(await screen.findByText('asset-77')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim for review' })).not.toBeInTheDocument();
  });
});

describe('TopologyPage', () => {
  const n = (id: string, label: string) => ({ id, organisationId: ORG, nodeType: 'ASSET', externalId: id, label, status: 'ACTIVE', createdAt: '', updatedAt: '' });
  const e = (id: string, source: string, target: string) => ({ id, organisationId: ORG, relationshipType: 'DEPENDS_ON', sourceNodeId: source, targetNodeId: target, status: 'ACTIVE', createdAt: '', updatedAt: '' });

  it('shows an empty state for an empty graph', async () => {
    const { impl } = fakeFetch(() => ({ body: [] }));
    renderWithSession(<TopologyPage />, impl);

    expect(await screen.findByText(/The graph is empty/)).toBeInTheDocument();
  });

  it('selects a node, asks for its blast radius, and lists what is reached by hop', async () => {
    const { impl, calls } = fakeFetch((r) => {
      if (r.url.pathname.endsWith('/blast-radius/retrieve')) {
        return { body: { nodeId: 'db', maxHops: 3, direction: 'UPSTREAM', impactedNodes: [
          { nodeId: 'web', nodeType: 'ASSET', externalId: 'web', label: 'web', hops: 2, direction: 'UPSTREAM' },
          { nodeId: 'app', nodeType: 'ASSET', externalId: 'app', label: 'app', hops: 1, direction: 'UPSTREAM' },
        ] } };
      }
      if (r.url.pathname.endsWith('/edge/retrieve')) return { body: [e('1', 'web', 'app'), e('2', 'app', 'db')] };
      if (r.url.pathname.endsWith('/retrieve')) return { body: [n('web', 'web'), n('app', 'app'), n('db', 'db')] };
      return undefined;
    });
    renderWithSession(<TopologyPage />, impl);
    const user = userEvent.setup();

    const dbNode = await screen.findByRole('button', { name: /^db, ASSET/ });
    expect(screen.getByText('No node selected.')).toBeInTheDocument();
    await user.click(dbNode);

    const panel = await screen.findByRole('complementary', { name: 'Blast radius' });
    await waitFor(() => expect(panel.querySelectorAll('.impact-list li')).toHaveLength(2));
    const rows = [...panel.querySelectorAll('.impact-list li')].map((li) => li.textContent);
    expect(rows[0]).toContain('app');
    expect(rows[1]).toContain('web');
    expect(screen.getByRole('button', { name: /^app, ASSET, impacted at 1 hop$/ })).toBeInTheDocument();
    const radiusCall = calls.find((c) => c.url.pathname.endsWith('/db/blast-radius/retrieve'))!;
    expect(radiusCall.url.searchParams.get('direction')).toBe('UPSTREAM');
    expect(radiusCall.url.searchParams.get('maxHops')).toBe('3');

    await user.selectOptions(screen.getByLabelText('Direction'), 'DOWNSTREAM');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('direction')).toBe('DOWNSTREAM'));
  });

  it('says so when a node reaches nothing', async () => {
    const { impl } = fakeFetch((r) => {
      if (r.url.pathname.endsWith('/blast-radius/retrieve')) return { body: { nodeId: 'a', maxHops: 3, direction: 'UPSTREAM', impactedNodes: [] } };
      if (r.url.pathname.endsWith('/edge/retrieve')) return { body: [] };
      return { body: [n('a', 'alone')] };
    });
    renderWithSession(<TopologyPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^alone, ASSET/ }));

    expect(await screen.findByText('Nothing else is reached.')).toBeInTheDocument();
  });
});

describe('AuditPage', () => {
  const entry = (sequence: number, over: Record<string, unknown> = {}) => ({
    id: `e${sequence}`, organisationId: ORG, sequence, occurredAt: '2026-10-03T12:00:00Z', recordedAt: '2026-10-03T12:00:01Z', source: 'platform-gateway',
    actor: 'alice', action: 'PUT /it-asset-registry/v1/{id}/control/ready', resourceType: 'it-asset-registry', resourceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    detail: 'status=204', recordedBy: 'platform-gateway', previousHash: '0'.repeat(64), hash: 'f'.repeat(64), ...over,
  });

  it('lists the entries newest first with a short resource id, and filters by actor and resource type', async () => {
    const { impl, calls } = fakeFetch((r) => (r.url.pathname.endsWith('/retrieve') ? { body: [entry(2), entry(1, { actor: 'bob', resourceId: undefined })] } : undefined));
    renderWithSession(<AuditPage />, impl);
    const user = userEvent.setup();

    expect(await screen.findAllByText('PUT /it-asset-registry/v1/{id}/control/ready')).toHaveLength(2);
    expect(screen.getByText('aaaaaaaa')).toBeInTheDocument();
    expect(calls[0].url.searchParams.get('limit')).toBe('200');
    expect(calls[0].url.searchParams.get('actor')).toBeNull();

    await user.type(screen.getByLabelText('Actor'), ' alice ');
    await user.type(screen.getByLabelText('Resource type'), 'it-asset-registry');
    await user.click(screen.getByRole('button', { name: 'Filter' }));

    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('actor')).toBe('alice'));
    expect(calls.at(-1)!.url.searchParams.get('resourceType')).toBe('it-asset-registry');
  });

  it('says so when there are no entries', async () => {
    const { impl } = fakeFetch(() => ({ body: [] }));
    renderWithSession(<AuditPage />, impl);

    expect(await screen.findByText('No entries.')).toBeInTheDocument();
  });

  it('verifies the chain and reports an intact one with its head', async () => {
    const { impl } = fakeFetch((r) => (r.url.pathname.endsWith('/integrity-check/evaluate')
      ? { body: { valid: true, entriesChecked: 3, headSequence: 3, headHash: 'abcdef0123456789abcdef', anchorsVerified: 2 } }
      : { body: [entry(1)] }));
    renderWithSession(<AuditPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Verify integrity' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Intact.');
    expect(status).toHaveTextContent('3 entries checked');
    expect(status).toHaveTextContent('abcdef0123456789');
    expect(status).toHaveTextContent('Confirmed against 2 anchors published outside the database');
  });

  it('points at the broken entry, highlights its row, and says what is still trustworthy', async () => {
    const { impl } = fakeFetch((r) => (r.url.pathname.endsWith('/integrity-check/evaluate')
      ? { body: { valid: false, entriesChecked: 2, headSequence: 1, firstBrokenSequence: 2, reason: 'The content of the entry no longer matches its hash.' } }
      : { body: [entry(2), entry(1)] }));
    renderWithSession(<AuditPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Verify integrity' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Chain broken at entry #2.');
    expect(alert).toHaveTextContent('no longer matches its hash');
    expect(alert).toHaveTextContent('Everything up to #1');
    expect(screen.getByRole('cell', { name: '2' }).closest('tr')).toHaveClass('selected');
    expect(screen.getByRole('cell', { name: '1' }).closest('tr')).not.toHaveClass('selected');
  });

  it('says so in the singular for one anchor', async () => {
    const { impl } = fakeFetch((r) => (r.url.pathname.endsWith('/integrity-check/evaluate')
      ? { body: { valid: true, entriesChecked: 1, headSequence: 1, headHash: 'abcdef0123456789abcdef', anchorsVerified: 1 } }
      : { body: [] }));
    renderWithSession(<AuditPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Verify integrity' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Confirmed against 1 anchor published');
  });

  it('singular wording for a one-entry chain, and no head for an empty one', async () => {
    let verdict: Record<string, unknown> = { valid: true, entriesChecked: 1, headSequence: 1, headHash: '1234567890abcdef12' };
    const { impl } = fakeFetch((r) => (r.url.pathname.endsWith('/integrity-check/evaluate') ? { body: verdict } : { body: [] }));
    renderWithSession(<AuditPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Verify integrity' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 entry checked');

    verdict = { valid: true, entriesChecked: 0, headSequence: 0 };
    await user.click(screen.getByRole('button', { name: 'Verify integrity' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0 entries checked'));
    expect(screen.getByRole('status')).not.toHaveTextContent('Head');
    expect(screen.getByRole('status')).not.toHaveTextContent('Confirmed against');
  });

  it('shows the problem when verification itself fails', async () => {
    const { impl } = fakeFetch((r) => (r.url.pathname.endsWith('/integrity-check/evaluate')
      ? { status: 503, body: { title: 'Service Unavailable', detail: 'ledger unavailable', error_code: 'ERR-GTW-00502' } }
      : { body: [] }));
    renderWithSession(<AuditPage />, impl);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Verify integrity' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ERR-GTW-00502');
  });
});

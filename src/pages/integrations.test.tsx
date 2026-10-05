import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { IntegrationsPage } from './Integrations';

beforeEach(() => sessionStorage.clear());

const ME = '0a0a0a0a-0000-4000-8000-000000000001';
const ITEM = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const me = { organisationId: ORG, executor: ME };

const connection = (over: Record<string, unknown> = {}) => ({
  id: 'c1', organisationId: ORG, name: 'Jira prod', provider: 'JIRA', baseUrl: 'https://acme.atlassian.net', secretRef: 'JIRA_AUTH', secretConfigured: true,
  webhookSecretRef: 'JIRA_HOOK', webhookSecretConfigured: false, integrationActor: 'svc-thinklab', projectKey: 'ITSM', outboundStatus: {}, inboundActions: {},
  status: 'ACTIVE', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', ...over,
});

const link = (over: Record<string, unknown> = {}) => ({
  id: 'l1', organisationId: ORG, connectionId: 'c1', subjectType: 'INCIDENT', subjectId: ITEM, externalId: 'ITSM-1', externalUrl: 'https://acme.atlassian.net/browse/ITSM-1',
  status: 'LINKED', lastPushedStatus: 'NEW', syncedComments: 2, lastSyncedAt: '2026-10-05T11:00:00Z', lastDirection: 'OUTBOUND',
  createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T11:00:00Z', ...over,
});

const trail = [{ occurredAt: '2026-10-05T10:00:00Z', action: 'INITIATED', executor: 'x', detail: 'Connection to JIRA configured.' }];

/** A tiny connector server: one connection that switches, and a list of links. */
function server(opts: { connections?: Record<string, unknown>[]; links?: Record<string, unknown>[] } = {}, extra: Handler = () => undefined) {
  let connections = opts.connections ?? [connection()];
  const links = opts.links ?? [link()];
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: trail };
    if (r.method === 'GET' && path.endsWith('/connection/retrieve')) return { body: connections };
    if (r.method === 'POST' && path.endsWith('/connection/initiate')) return { status: 201, body: connection({ id: 'c2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/check/execute')) return { body: { secretConfigured: true, webhookSecretConfigured: true, reachable: true } };
    if (r.method === 'PUT' && path.endsWith('/control/disable')) {
      connections = connections.map((c) => ({ ...c, status: 'DISABLED' }));
      return { status: 204 };
    }
    if (r.method === 'PUT' && path.endsWith('/control/enable')) {
      connections = connections.map((c) => ({ ...c, status: 'ACTIVE' }));
      return { status: 204 };
    }
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: link({ id: 'l2' }) };
    if (r.method === 'PUT' && path.endsWith('/sync/execute')) return { body: link() };
    if (r.method === 'PUT' && path.endsWith('/control/detach')) return { status: 204 };
    if (r.method === 'GET' && path.endsWith('/retrieve')) return { body: links };
    return undefined;
  };
  return handler;
}

const section = (name: string) => screen.getByRole('table', { name });

describe('connections', () => {
  it('lists them with the provider, the address, whether the credentials are set on the server, and the status', async () => {
    const { impl } = fakeFetch(server({ connections: [connection(), connection({ id: 'c3', name: 'SNOW', provider: 'SERVICENOW', secretConfigured: false, status: 'DISABLED', projectKey: undefined })] }));
    renderWithSession(<IntegrationsPage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Jira prod' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('JIRA')).toBeInTheDocument();
    expect(within(row).getByText('https://acme.atlassian.net')).toBeInTheDocument();
    expect(within(row).getByText('set')).toBeInTheDocument();
    expect(within(row).getByText('ACTIVE')).toBeInTheDocument();
    const other = screen.getByRole('button', { name: 'SNOW' }).closest('tr') as HTMLElement;
    expect(within(other).getByText('not set')).toBeInTheDocument();
    expect(within(other).getByText('DISABLED')).toBeInTheDocument();
  });

  it('says so when there are none, and cannot link anything yet', async () => {
    const { impl } = fakeFetch(server({ connections: [], links: [] }));
    renderWithSession(<IntegrationsPage />, impl, me);

    expect(await screen.findByText('No connections yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link an item' })).toBeDisabled();
  });

  it('shows the names of the variables and warns about the ones that are not set; the secret itself is never shown', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Jira prod' }));

    const detail = await screen.findByRole('complementary', { name: 'Connection detail' });
    expect(within(detail).getByText('JIRA_AUTH')).toBeInTheDocument();
    expect(within(detail).getByText('JIRA_HOOK')).toBeInTheDocument();
    expect(within(detail).getByText('is set')).toBeInTheDocument();
    expect(within(detail).getByText('is not set on the server')).toBeInTheDocument();
    expect(within(detail).getByText(/ITSM/)).toBeInTheDocument();
    expect(await within(detail).findByText('INITIATED')).toBeInTheDocument();
  });

  it('checks the connection and says what it found, including a provider that does not answer', async () => {
    let answers = 0;
    const { impl } = fakeFetch(server({}, (r) => {
      if (!r.url.pathname.endsWith('/check/execute')) return undefined;
      answers += 1;
      return { body: answers === 1 ? { secretConfigured: true, webhookSecretConfigured: true, reachable: true }
        : { secretConfigured: true, webhookSecretConfigured: true, reachable: false, problem: 'Jira refused checking the connection (HTTP 401).' } };
    }));
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Jira prod' }));
    const detail = await screen.findByRole('complementary', { name: 'Connection detail' });

    await user.click(within(detail).getByRole('button', { name: 'Check connection' }));
    expect(await within(detail).findByText('The provider answers with these credentials.')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Check connection' }));
    expect(await within(detail).findByText('Not reachable: Jira refused checking the connection (HTTP 401).')).toBeInTheDocument();
  });

  it('a check that finds no problem text still says it is not reachable', async () => {
    const { impl } = fakeFetch(server({}, (r) => (r.url.pathname.endsWith('/check/execute')
      ? { body: { secretConfigured: false, webhookSecretConfigured: false, reachable: false } } : undefined)));
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Jira prod' }));
    const detail = await screen.findByRole('complementary', { name: 'Connection detail' });

    await user.click(within(detail).getByRole('button', { name: 'Check connection' }));
    expect(await within(detail).findByText('Not reachable.')).toBeInTheDocument();
  });

  it('disables and enables it', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Jira prod' }));
    const detail = await screen.findByRole('complementary', { name: 'Connection detail' });

    await user.click(within(detail).getByRole('button', { name: 'Disable' }));
    expect(await within(detail).findByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/connection/c1/control/disable'))).toBe(true);
    await user.click(within(detail).getByRole('button', { name: 'Enable' }));
    expect(await within(detail).findByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('shows the problem when an action is refused, and can be closed', async () => {
    const { impl } = fakeFetch(server({}, (r) => (r.url.pathname.endsWith('/control/disable')
      ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-ETK-00409', detail: 'Changed by someone else.' } } : undefined)));
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Jira prod' }));
    const detail = await screen.findByRole('complementary', { name: 'Connection detail' });

    await user.click(within(detail).getByRole('button', { name: 'Disable' }));
    expect(await within(detail).findByText('ERR-ETK-00409')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Connection detail' })).not.toBeInTheDocument();
  });
});

describe('the new connection form', () => {
  async function openForm() {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Jira prod' });
    await user.click(screen.getByRole('button', { name: 'New connection' }));
    const form = screen.getByRole('form', { name: 'New connection' });
    return { user, form, calls };
  }

  async function fill(user: ReturnType<typeof userEvent.setup>, form: HTMLElement, values: Record<string, string>) {
    for (const [label, value] of Object.entries(values)) await user.type(within(form).getByLabelText(label), value);
  }

  it('asks for names of variables, never secrets, and a Jira connection needs its project key', async () => {
    const { user, form } = await openForm();
    const submit = within(form).getByRole('button', { name: 'Register connection' });
    expect(within(form).getByText(/Secrets are never typed here/)).toBeInTheDocument();
    await fill(user, form, { Name: 'Jira staging', 'Address (https)': 'https://x.atlassian.net', 'Credentials variable (holds the whole Authorization header value)': 'J_AUTH', 'Webhook token variable': 'J_HOOK', 'Integration account (the account the credentials act as)': 'svc' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Project key'), 'itsm');
    expect(within(form).getByLabelText('Project key')).toHaveValue('ITSM');
    expect(submit).toBeEnabled();
  });

  it('a ServiceNow connection has no project key; creating it sends only the names and selects it', async () => {
    const { user, form, calls } = await openForm();
    await user.selectOptions(within(form).getByLabelText('Provider'), 'SERVICENOW');
    expect(within(form).queryByLabelText('Project key')).not.toBeInTheDocument();
    await fill(user, form, { Name: ' SNOW prod ', 'Address (https)': ' https://acme.service-now.com ', 'Credentials variable (holds the whole Authorization header value)': 'SNOW_AUTH', 'Webhook token variable': 'SNOW_HOOK', 'Integration account (the account the credentials act as)': 'svc.thinklab' });
    await user.click(within(form).getByRole('button', { name: 'Register connection' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New connection' })).not.toBeInTheDocument());
    const post = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/connection/initiate'))!;
    expect(post.body).toEqual({ name: 'SNOW prod', provider: 'SERVICENOW', baseUrl: 'https://acme.service-now.com', secretRef: 'SNOW_AUTH', webhookSecretRef: 'SNOW_HOOK', integrationActor: 'svc.thinklab', projectKey: undefined });
    expect(await screen.findByRole('complementary', { name: 'Connection detail' })).toBeInTheDocument();
  });

  it('shows why a connection is refused (an unsafe address, for instance) and keeps the form', async () => {
    const { impl } = fakeFetch(server({}, (r) => (r.method === 'POST' && r.url.pathname.endsWith('/connection/initiate')
      ? { status: 400, body: { title: 'Bad Request', error_code: 'ERR-VALIDATION-00400', detail: 'The base URL must be https.' } } : undefined)));
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Jira prod' });
    await user.click(screen.getByRole('button', { name: 'New connection' }));
    const form = screen.getByRole('form', { name: 'New connection' });
    await fill(user, form, { Name: 'n', 'Address (https)': 'http://x', 'Project key': 'ITSM', 'Credentials variable (holds the whole Authorization header value)': 'A_B', 'Webhook token variable': 'C_D', 'Integration account (the account the credentials act as)': 'svc' });
    await user.click(within(form).getByRole('button', { name: 'Register connection' }));

    expect(await within(form).findByText('ERR-VALIDATION-00400')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'New connection' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New connection' })).not.toBeInTheDocument();
  });
});

describe('linked tickets', () => {
  it('lists them with the connection name, the ticket (a link only when the address is http or https), the status and the direction of the last sync', async () => {
    const { impl } = fakeFetch(server({ links: [
      link(),
      link({ id: 'l3', subjectType: 'SERVICE_REQUEST', externalId: 'REC1', externalUrl: 'javascript:alert(1)', status: 'FAILED', lastDirection: 'INBOUND' }),
      link({ id: 'l4', subjectType: 'PROBLEM', externalId: undefined, externalUrl: undefined, status: 'PENDING', lastSyncedAt: undefined }),
      link({ id: 'l5', connectionId: 'unknown-connection-id' }),
    ] }));
    renderWithSession(<IntegrationsPage />, impl, me);

    const table = await screen.findByRole('table', { name: 'Linked tickets' });
    const first = within(table).getAllByRole('row')[1];
    expect(within(first).getByText('Jira prod')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'ITSM-1' })).toHaveAttribute('href', 'https://acme.atlassian.net/browse/ITSM-1');
    expect(within(first).getByText('LINKED')).toBeInTheDocument();
    expect(within(first).getByText(/to provider/)).toBeInTheDocument();
    const unsafe = within(table).getAllByRole('row')[2];
    expect(within(unsafe).queryByRole('link')).not.toBeInTheDocument();
    expect(within(unsafe).getByText('REC1')).toBeInTheDocument();
    expect(within(unsafe).getByText('FAILED')).toBeInTheDocument();
    expect(within(unsafe).getByText(/from provider/)).toBeInTheDocument();
    const pending = within(table).getAllByRole('row')[3];
    expect(within(pending).getByText('none yet')).toBeInTheDocument();
    expect(within(pending).getByText('never')).toBeInTheDocument();
    expect(within(table).getByText('unknown-')).toBeInTheDocument();
  });

  it('filters by connection and status, and says so when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server({ links: [] }));
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No linked tickets match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Connection'), 'c1');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('connectionId')).toBe('c1'));
    await user.selectOptions(screen.getByLabelText('Link status'), 'FAILED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('FAILED'));
    await user.selectOptions(screen.getByLabelText('Link status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });
});

describe('linking an item', () => {
  async function open(extra: Handler = () => undefined, connections?: Record<string, unknown>[]) {
    const { impl, calls } = fakeFetch(server({ connections }, extra));
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Linked tickets' });
    await user.click(screen.getByRole('button', { name: 'Link an item' }));
    return { user, calls, form: screen.getByRole('form', { name: 'Link an item' }) };
  }

  it('offers only active connections, needs a real id, warns about personal data and sends the link', async () => {
    const { user, form, calls } = await open(undefined, [connection(), connection({ id: 'c9', name: 'Old one', status: 'DISABLED' })]);
    const choices = within(within(form).getByLabelText('Connection')).getAllByRole('option').map((o) => o.textContent);
    expect(choices).toEqual(['Jira prod']);
    expect(within(form).getByText(/keep personal data out/)).toBeInTheDocument();
    const submit = within(form).getByRole('button', { name: 'Create the ticket' });
    await user.type(within(form).getByLabelText('Item id'), 'not-an-id');
    expect(submit).toBeDisabled();
    await user.clear(within(form).getByLabelText('Item id'));
    await user.type(within(form).getByLabelText('Item id'), ` ${ITEM} `);
    await user.selectOptions(within(form).getByLabelText('Kind of item'), 'PROBLEM');
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Link an item' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/initiate'))!.body).toEqual({ connectionId: 'c1', subjectType: 'PROBLEM', subjectId: ITEM });
  });

  it('when the provider refuses it shows why and refreshes the list, because the link was kept as FAILED', async () => {
    const { user, form, calls } = await open((r) => (r.method === 'POST' && r.url.pathname.endsWith('/initiate')
      ? { status: 502, body: { title: 'Bad Gateway', error_code: 'ERR-ETK-00502', detail: 'Jira refused creating the issue (HTTP 500).' } } : undefined));
    const before = calls.filter((c) => c.method === 'GET' && c.url.pathname.endsWith('/retrieve') && !c.url.pathname.includes('/connection/')).length;
    await user.type(within(form).getByLabelText('Item id'), ITEM);
    await user.click(within(form).getByRole('button', { name: 'Create the ticket' }));

    expect(await within(form).findByText('ERR-ETK-00502')).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url.pathname.endsWith('/retrieve') && !c.url.pathname.includes('/connection/')).length).toBeGreaterThan(before));
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Link an item' })).not.toBeInTheDocument();
  });
});

describe('a link in detail', () => {
  async function open(over: Record<string, unknown> = {}, extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server({ links: [link(over)] }, extra));
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Linked tickets' });
    await user.click(within(table).getByRole('button', { name: /INCIDENT/ }));
    const detail = await screen.findByRole('complementary', { name: 'Link detail' });
    await within(detail).findByText('INITIATED');
    return { user, calls, detail };
  }

  const actionsOf = (detail: HTMLElement) => within(detail).getByLabelText('Actions');

  it('shows what was last pushed, how many comments were sent, and the history', async () => {
    const { detail } = await open();

    expect(within(detail).getByText('ITSM-1')).toBeInTheDocument();
    expect(within(detail).getByText('NEW')).toBeInTheDocument();
    expect(within(detail).getByText('2')).toBeInTheDocument();
    expect(within(detail).queryByText('Last problem')).not.toBeInTheDocument();
  });

  it('syncs now, and reads the link again (the provider may have refused, which the link records)', async () => {
    const { user, detail, calls } = await open({ lastError: 'Jira has no transition to Done.' });
    expect(within(detail).getByText('Jira has no transition to Done.')).toBeInTheDocument();
    const before = calls.length;

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/l1/sync/execute'))).toBe(true));
    await waitFor(() => expect(calls.length).toBeGreaterThan(before + 1));
  });

  it('a link with no ticket yet offers to retry creating it, and a refusal is shown', async () => {
    const { user, detail } = await open({ externalId: undefined, externalUrl: undefined, status: 'FAILED', lastError: 'Jira could not be reached for creating the issue.' },
      (r) => (r.method === 'PUT' && r.url.pathname.endsWith('/sync/execute')
        ? { status: 502, body: { title: 'Bad Gateway', error_code: 'ERR-ETK-00502', detail: 'Still down.' } } : undefined));
    expect(within(detail).getByText('not created yet')).toBeInTheDocument();

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Retry creating the ticket' }));

    expect(await within(detail).findByText('ERR-ETK-00502')).toBeInTheDocument();
  });

  it('detaching takes a second click, and can be called off', async () => {
    const { user, detail, calls } = await open();

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Detach' }));
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Never mind' }));
    expect(calls.some((c) => c.url.pathname.endsWith('/control/detach'))).toBe(false);

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Detach' }));
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Detach for good' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/l1/control/detach'))).toBe(true));
  });

  it('a detached link has no actions, only history, and can be closed', async () => {
    const { user, detail } = await open({ status: 'DETACHED' });

    expect(within(detail).queryByLabelText('Actions')).not.toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Link detail' })).not.toBeInTheDocument();
  });

  it('says so when the link is gone', async () => {
    let listCalls = 0;
    const { impl } = fakeFetch(server({ links: [link()] }, (r) => {
      if (r.method !== 'GET' || !r.url.pathname.endsWith('/retrieve') || r.url.pathname.includes('/connection/')) return undefined;
      listCalls += 1;
      return listCalls === 1 ? undefined : { body: [] };
    }));
    renderWithSession(<IntegrationsPage />, impl, me);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Linked tickets' });
    await user.click(within(table).getByRole('button', { name: /INCIDENT/ }));

    expect(await screen.findByText('That link is no longer there.')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has an Integrations link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/integrations');
    expect(await screen.findByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Integrations' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Jira prod' })).toBeInTheDocument();
    expect(section('Connections')).toBeInTheDocument();
  });
});

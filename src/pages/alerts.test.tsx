import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { AlertsPage } from './Alerts';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r1', organisationId: ORG, name: 'Everything', impact: 'HIGH', urgency: 'MEDIUM', requesterId: 'u1', status: 'ACTIVE',
  createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z', ...over,
});

const alert = (over: Record<string, unknown> = {}) => ({
  id: 'a1', organisationId: ORG, ruleId: 'r1', checkId: 'k1', checkName: 'Intranet', status: 'OPEN', openedAt: '2026-10-06T12:00:00Z',
  incidentId: 'i1', lastError: 'timeout', updatedAt: '2026-10-06T12:00:00Z', ...over,
});

function server(rules: Record<string, unknown>[] = [rule()], alerts: Record<string, unknown>[] = [alert()], extra: Handler = () => undefined) {
  let current = rules;
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.includes('/it-health-monitoring/')) return { body: [{ id: 'k1', name: 'Intranet' }] };
    if (r.method === 'POST' && path.endsWith('/rule/initiate')) return { status: 201, body: rule({ id: 'r2', name: (r.body as { name: string }).name }) };
    if (r.method === 'PUT' && path.endsWith('/evaluation/execute')) return { body: { opened: 1, resolved: 2, incidentsOpened: 1 } };
    if (r.method === 'PUT' && path.endsWith('/control/pause')) { current = current.map((c) => ({ ...c, status: 'PAUSED' })); return { status: 204 }; }
    if (r.method === 'PUT' && path.endsWith('/control/resume')) { current = current.map((c) => ({ ...c, status: 'ACTIVE' })); return { status: 204 }; }
    if (path.endsWith('/rule/retrieve')) return { body: current };
    if (path.endsWith('/retrieve')) {
      const status = r.url.searchParams.get('status');
      return { body: status ? alerts.filter((a) => a.status === status) : alerts };
    }
    return undefined;
  };
  return handler;
}

describe('rules and alerts', () => {
  it('lists the rules (what they cover) and the alerts with their check, why, incident and rule', async () => {
    const { impl } = fakeFetch(server(
      [rule(), rule({ id: 'r3', name: 'Intranet only', checkId: 'k1', status: 'PAUSED' })],
      [alert(), alert({ id: 'a2', status: 'RESOLVED', resolvedAt: '2026-10-06T12:30:00Z', lastError: undefined }),
        alert({ id: 'a3', incidentId: undefined, problem: 'The incident service did not accept the incident (HTTP 503).', ruleId: 'gone' }),
        alert({ id: 'a4', incidentId: undefined })],
    ));
    renderWithSession(<AlertsPage />, impl, me);

    const rules = within(await screen.findByRole('table', { name: 'Rules' }));
    expect(rules.getByText('every check')).toBeInTheDocument();
    expect(rules.getByText('PAUSED')).toBeInTheDocument();
    const alerts = within(await screen.findByRole('table', { name: 'Alerts' }));
    expect(alerts.getAllByText('i1').length).toBe(2);
    expect(alerts.getByText('RESOLVED')).toBeInTheDocument();
    expect(alerts.getByText(/HTTP 503/)).toBeInTheDocument();
    expect(alerts.getByText('gone')).toBeInTheDocument();
    expect(alerts.getByText('not yet')).toBeInTheDocument();
    expect(alerts.getAllByText('Everything').length).toBeGreaterThan(0);
  });

  it('says so when there is no rule and no alert, and filters alerts by status', async () => {
    const { impl, calls } = fakeFetch(server([], []));
    renderWithSession(<AlertsPage />, impl, me);
    const user = userEvent.setup();
    expect(await screen.findByText('No rules yet: nothing will be opened.')).toBeInTheDocument();
    expect(await screen.findByText('No alerts match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Alert status'), 'OPEN');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('OPEN'));
    await user.selectOptions(screen.getByLabelText('Alert status'), '');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBeNull());
  });

  it('shows the problem when the rules cannot be read', async () => {
    const { impl } = fakeFetch(server([], [], (r) => (r.url.pathname.endsWith('/rule/retrieve')
      ? { status: 403, body: { title: 'Forbidden', error_code: 'ERR-ALR-00403', detail: 'Staff only.' } } : undefined)));
    renderWithSession(<AlertsPage />, impl, me);

    expect(await screen.findByText('ERR-ALR-00403')).toBeInTheDocument();
  });
});

describe('actions', () => {
  it('pauses and resumes a rule', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<AlertsPage />, impl, me);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    await user.click(await screen.findByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/control/resume'))).toBe(true));
    expect(calls.some((c) => c.url.pathname.endsWith('/control/pause'))).toBe(true);
  });

  it('evaluates now and says what it did; a failure is shown', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<AlertsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Evaluate now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 alert(s) opened, 2 resolved, 1 incident(s) filed.');
  });

  it('a failed evaluation shows why', async () => {
    const { impl } = fakeFetch(server([rule()], [alert()], (r) => (r.url.pathname.endsWith('/evaluation/execute')
      ? { status: 502, body: { title: 'Bad Gateway', error_code: 'ERR-ALR-00502', detail: 'The health monitor could not be read.' } } : undefined)));
    renderWithSession(<AlertsPage />, impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Evaluate now' }));
    expect(await screen.findByText('ERR-ALR-00502')).toBeInTheDocument();
  });
});

describe('a new rule', () => {
  async function open(extra: Handler = () => undefined) {
    const { impl, calls } = fakeFetch(server([rule()], [alert()], extra));
    renderWithSession(<AlertsPage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Rules' });
    await user.click(screen.getByRole('button', { name: 'New rule' }));
    return { user, calls, form: screen.getByRole('form', { name: 'New rule' }) };
  }

  it('needs a name and a requester; covers every check or one; sends what was chosen', async () => {
    const { user, form, calls } = await open();
    const submit = within(form).getByRole('button', { name: 'Create rule' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), ' Intranet down ');
    await within(form).findByRole('option', { name: 'Intranet' });
    await user.selectOptions(within(form).getByLabelText('Covers'), 'k1');
    await user.selectOptions(within(form).getByLabelText('Impact'), 'HIGH');
    await user.selectOptions(within(form).getByLabelText('Urgency'), 'LOW');
    await user.type(within(form).getByLabelText(/Requester/), ' u1 ');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('form', { name: 'New rule' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Intranet down', checkId: 'k1', impact: 'HIGH', urgency: 'LOW', requesterId: 'u1' });
  });

  it('a rule for every check sends no check id', async () => {
    const { user, form, calls } = await open();
    await user.type(within(form).getByLabelText('Name'), 'All');
    await user.type(within(form).getByLabelText(/Requester/), 'u1');
    await user.click(within(form).getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ name: 'All', impact: 'MEDIUM', urgency: 'MEDIUM' });
    expect(calls.find((c) => c.method === 'POST')!.body).not.toHaveProperty('checkId');
  });

  it('shows why a rule is refused and keeps the form; it can be cancelled', async () => {
    const { user, form } = await open((r) => (r.method === 'POST' ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-ALR-00409', detail: 'A rule with that name exists.' } } : undefined));
    await user.type(within(form).getByLabelText('Name'), 'Everything');
    await user.type(within(form).getByLabelText(/Requester/), 'u1');
    await user.click(within(form).getByRole('button', { name: 'Create rule' }));

    expect(await within(form).findByText('ERR-ALR-00409')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New rule' })).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has an Alerts link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/alerts');
    expect(await screen.findByRole('heading', { name: 'Alerts', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Rules' })).toBeInTheDocument();
  });
});

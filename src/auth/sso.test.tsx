import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client';
import { App } from '../App';
import { LoginPage } from '../pages/Login';
import { SsoCompletePage } from '../pages/SsoComplete';
import { fakeFetch, jwtWith, ORG, renderWithSession, type Handler } from '../test-utils';
import { claimsOf } from './jwt';
import { SessionProvider, useSession } from './session';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

const accessToken = (over: Record<string, unknown> = {}) => jwtWith({ sub: 'user-42', tid: ORG, role: 'OPERATOR', ...over });
const refreshOk = (token = accessToken(), expiresIn = 600): Handler => (r) => (r.url.pathname === '/api/gateway/v1/session/refresh' ? { body: { accessToken: token, tokenType: 'Bearer', expiresIn } } : undefined);
const refreshRefused: Handler = (r) => (r.url.pathname === '/api/gateway/v1/session/refresh' ? { status: 401, body: { title: 'Unauthorized', error_code: 'ERR-GTW-00401' } } : undefined);

describe('claimsOf', () => {
  it('reads subject, tenant and role from a token, and nothing from a malformed one', () => {
    expect(claimsOf(accessToken())).toEqual({ sub: 'user-42', tid: ORG, role: 'OPERATOR' });
    expect(claimsOf(jwtWith({ sub: 42, tid: '' }))).toEqual({ sub: undefined, tid: undefined, role: undefined });
    expect(claimsOf('not-a-jwt')).toEqual({});
    expect(claimsOf('a.%%%.c')).toEqual({});
  });
});

describe('LoginPage SSO', () => {
  function renderLogin(route = '/login') {
    const { impl, calls } = fakeFetch(() => undefined);
    renderWithSession(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      impl, null, route,
    );
    return calls;
  }

  it('sends the browser to the identity provider through the gateway, with only the organisation id', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const calls = renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'SSO' }));
    const submit = screen.getByRole('button', { name: 'Sign in with SSO' });
    expect(submit).toBeDisabled();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Organisation ID'), ORG);
    await user.click(submit);

    expect(assign).toHaveBeenCalledWith(`/api/identity-federation/v1/login/initiate?organisationId=${ORG}`);
    expect(calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('says why a federated sign-in failed using the error code only, falling back to a generic line for an unknown one', () => {
    renderLogin('/login?sso_error=ERR-FED-00403');
    expect(screen.getByRole('alert')).toHaveTextContent('not linked to a user of this organisation');
    expect(screen.getByRole('alert')).toHaveTextContent('ERR-FED-00403');
  });

  it.each([
    ['ERR-FED-00400', 'expired or was already used'],
    ['ERR-FED-00409', 'not enabled'],
    ['ERR-FED-00404', 'no single sign-on set up'],
    ['ERR-FED-00502', 'could not be reached'],
    ['ERR-FED-00503', 'not fully configured'],
    ['ERR-OTHER-00001', 'could not confirm your sign-in'],
  ])('maps %s to a readable message', (code, text) => {
    renderLogin(`/login?sso_error=${code}`);
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
});

describe('SsoCompletePage', () => {
  function renderComplete(handler: Handler) {
    const { impl, calls } = fakeFetch(handler);
    renderWithSession(
      <Routes>
        <Route path="/sso/complete" element={<SsoCompletePage />} />
        <Route path="/assets" element={<p>assets page</p>} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      impl, null, '/sso/complete',
    );
    return calls;
  }

  it('trades the cookie for an access token once, keeps it in memory only, and moves on to the assets', async () => {
    const calls = renderComplete(refreshOk());

    expect(await screen.findByText('assets page')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.get('X-Requested-With')).toBe('thinklab-web');
    const stored = JSON.parse(sessionStorage.getItem('thinklab.session')!);
    expect(stored).toMatchObject({ organisationId: ORG, executor: 'user-42', sso: true });
    expect(stored.accessToken).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('refresh');
  });

  it('goes back to the login page with an error code when the cookie is refused', async () => {
    renderComplete(refreshRefused);

    expect(await screen.findByRole('alert')).toHaveTextContent('ERR-FED-00401');
    expect(sessionStorage.getItem('thinklab.session')).toBeNull();
  });

  it('refuses a token that names no tenant or subject', async () => {
    renderComplete(refreshOk(jwtWith({ sub: 'user-42' })));

    expect(await screen.findByRole('alert')).toHaveTextContent('ERR-FED-00401');
    expect(sessionStorage.getItem('thinklab.session')).toBeNull();
  });
});

describe('a federated session across reloads, expiry and sign-out', () => {
  function Probe() {
    const { session, restoring, signOut } = useSession();
    return (
      <div>
        <p>{restoring ? 'restoring' : session ? `signed in as ${session.executor} token=${session.accessToken ?? 'none'}` : 'signed out'}</p>
        <button type="button" onClick={signOut}>sign out</button>
      </div>
    );
  }

  function mount(handler: Handler, stored?: Record<string, unknown>) {
    if (stored) sessionStorage.setItem('thinklab.session', JSON.stringify(stored));
    const { impl, calls } = fakeFetch(handler);
    render(
      <MemoryRouter>
        <SessionProvider client={(get) => new ApiClient(get, '/api', impl)}>
          <Probe />
        </SessionProvider>
      </MemoryRouter>,
    );
    return calls;
  }

  const federated = { organisationId: ORG, executor: 'user-42', sso: true };

  it('after a reload restores the access token from the cookie exactly once, without ever having stored it', async () => {
    const calls = mount(refreshOk(accessToken({ x: 1 })), federated);

    expect(screen.getByText('restoring')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/signed in as user-42 token=ey/)).toBeInTheDocument());
    expect(calls.filter((c) => c.url.pathname.endsWith('/session/refresh'))).toHaveLength(1);
    expect(JSON.parse(sessionStorage.getItem('thinklab.session')!).accessToken).toBeUndefined();
  });

  it('signs the person out when the cookie can no longer restore the session', async () => {
    mount(refreshRefused, federated);

    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
    expect(sessionStorage.getItem('thinklab.session')).toBeNull();
  });

  it('does not try to restore a password or local session, which have no cookie', () => {
    const calls = mount(() => undefined, { organisationId: ORG, executor: 'alice' });

    expect(screen.getByText(/signed in as alice/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('refreshes the access token at 80% of its life and signs out when the refresh is refused', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answers = [accessToken({ n: 1 }), accessToken({ n: 2 })];
    const calls = mount((r) => (r.url.pathname.endsWith('/session/refresh')
      ? (answers.length > 0 ? { body: { accessToken: answers.shift(), tokenType: 'Bearer', expiresIn: 100 } } : { status: 401, body: { title: 'Unauthorized' } })
      : undefined), federated);

    await waitFor(() => expect(screen.getByText(/signed in as user-42/)).toBeInTheDocument());
    expect(calls).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(81_000); });
    await waitFor(() => expect(calls).toHaveLength(2));

    answers = [];
    await act(async () => { await vi.advanceTimersByTimeAsync(81_000); });
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
  });

  it('signing out of a federated session revokes it at the gateway and clears the cookie; a local one calls nothing', async () => {
    const user = userEvent.setup();
    const calls = mount((r) => (r.url.pathname.endsWith('/session/logout') ? { status: 204 } : refreshOk()(r)), federated);
    await waitFor(() => expect(screen.getByText(/signed in as user-42/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/session/logout'))).toBe(true));
    expect(calls.find((c) => c.url.pathname.endsWith('/session/logout'))!.headers.get('X-Requested-With')).toBe('thinklab-web');
    expect(screen.getByText('signed out')).toBeInTheDocument();
  });

  it('a failing logout call still signs the page out', async () => {
    const user = userEvent.setup();
    mount((r) => (r.url.pathname.endsWith('/session/logout') ? { status: 500, body: { title: 'boom' } } : refreshOk()(r)), federated);
    await waitFor(() => expect(screen.getByText(/signed in as user-42/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'sign out' }));

    expect(screen.getByText('signed out')).toBeInTheDocument();
  });

  it('signing out of a local session calls no endpoint', async () => {
    const user = userEvent.setup();
    const calls = mount(() => undefined, { organisationId: ORG, executor: 'alice' });

    await user.click(screen.getByRole('button', { name: 'sign out' }));

    expect(screen.getByText('signed out')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('the app shows a loading line while a federated session is being restored', async () => {
    sessionStorage.setItem('thinklab.session', JSON.stringify(federated));
    const { impl } = fakeFetch((r) => (r.url.pathname.endsWith('/session/refresh') ? { body: { accessToken: accessToken(), tokenType: 'Bearer', expiresIn: 600 } } : { body: [] }));
    render(
      <MemoryRouter initialEntries={['/assets']}>
        <SessionProvider client={(get) => new ApiClient(get, '/api', impl)}>
          <App />
        </SessionProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Restoring your session...')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
  });
});

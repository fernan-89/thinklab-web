import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../api/client';
import { App } from '../App';
import { fakeFetch, jwtWith, ORG, type Handler } from '../test-utils';
import { SessionProvider } from './session';

beforeEach(() => sessionStorage.clear());

const refused: Handler = () => ({ status: 401, body: { title: 'Unauthorized', error_code: 'ERR-GTW-00401' } });

function mount(handler: Handler, stored: Record<string, unknown>) {
  sessionStorage.setItem('thinklab.session', JSON.stringify(stored));
  const { impl, calls } = fakeFetch(handler);
  render(
    <MemoryRouter initialEntries={['/assets']}>
      <SessionProvider client={(get) => new ApiClient(get, '/api', impl)}>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
  return calls;
}

describe('a password session whose access token the platform refuses', () => {
  it('goes back to the sign-in page with a notice, and forgets the session', async () => {
    mount(refused, { organisationId: ORG, executor: 'user-42', displayName: 'a@b.c', accessToken: jwtWith({ sub: 'user-42', tid: ORG }) });

    expect(await screen.findByText(/Your session has ended/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue|Sign in/ })).toBeInTheDocument();
    expect(sessionStorage.getItem('thinklab.session')).toBeNull();
  });

  it('is not signed out by a 401 on a local session, which carries no token', async () => {
    const calls = mount(refused, { organisationId: ORG, executor: 'alice' });

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(sessionStorage.getItem('thinklab.session')).not.toBeNull();
    expect(screen.queryByText(/Your session has ended/)).not.toBeInTheDocument();
  });

  it('is left to the cookie refresh when the session is federated', async () => {
    const calls = mount(refused, { organisationId: ORG, executor: 'user-42', sso: true, accessToken: jwtWith({ sub: 'user-42', tid: ORG }) });

    await waitFor(() => expect(calls.some((c) => c.headers.get('Authorization')?.startsWith('Bearer '))).toBe(true));
    expect(sessionStorage.getItem('thinklab.session')).not.toBeNull();
    expect(screen.queryByText(/Your session has ended/)).not.toBeInTheDocument();
  });
});

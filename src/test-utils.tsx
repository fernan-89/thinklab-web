import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ApiClient, type Session } from './api/client';
import { SessionProvider } from './auth/session';

export const ORG = '11111111-2222-3333-4444-555555555555';

export type Handler = (request: { method: string; url: URL; headers: Headers; body: unknown }) => { status?: number; body?: unknown } | undefined;

/** A fetch double that routes by method + path and records every call. */
export function fakeFetch(handler: Handler) {
  const calls: { method: string; url: URL; headers: Headers; body: unknown }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      method: init?.method ?? 'GET',
      url: new URL(String(input), 'http://localhost'),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const result = handler(call) ?? { status: 404, body: { title: 'Not Found', error_code: 'ERR-TEST-404' } };
    const status = result.status ?? 200;
    return new Response(status === 204 || result.body === undefined ? null : JSON.stringify(result.body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

export function renderWithSession(ui: ReactElement, impl: typeof fetch, session: Session | null = { organisationId: ORG, executor: 'tester' }, route = '/') {
  try {
    if (session) sessionStorage.setItem('thinklab.session', JSON.stringify(session));
    else sessionStorage.removeItem('thinklab.session');
  } catch {
    // jsdom always has storage
  }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider client={(get) => new ApiClient(get, '/api', impl)}>{ui}</SessionProvider>
    </MemoryRouter>,
  );
}

const b64url = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A syntactically valid (unsigned) JWT with the given claims, for tests of what the app reads from a token. */
export const jwtWith = (claims: object) => `${b64url({ alg: 'ES256' })}.${b64url(claims)}.signature`;

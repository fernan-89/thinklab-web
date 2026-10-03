import { describe, expect, it } from 'vitest';
import { fakeFetch, ORG } from '../test-utils';
import { ApiClient, ProblemError, buildUrl } from './client';

const session = { organisationId: ORG, executor: 'alice' };

describe('buildUrl', () => {
  it('appends only the query values that are set', () => {
    expect(buildUrl('/api', '/x', { a: '1', b: undefined, c: '', d: 3 })).toBe('/api/x?a=1&d=3');
    expect(buildUrl('/api', '/x')).toBe('/api/x');
  });
});

describe('ApiClient', () => {
  it('sends the tenant and executor headers, and a bearer token when the session has one', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: [] }));
    await new ApiClient(() => ({ ...session, accessToken: 'tok' }), '/api', impl).get('/it-asset-registry/v1/retrieve', { status: 'READY' });

    expect(calls[0].url.pathname).toBe('/api/it-asset-registry/v1/retrieve');
    expect(calls[0].url.search).toBe('?status=READY');
    expect(calls[0].headers.get('X-Tenant-Id')).toBe(ORG);
    expect(calls[0].headers.get('X-Executor')).toBe('alice');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer tok');
  });

  it('sends no identity headers without a session, and lets a caller override the executor', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: {} }));
    await new ApiClient(() => null, '/api', impl).post('/x', { a: 1 });
    await new ApiClient(() => session, '/api', impl).put('/y', undefined, { headers: { 'X-Executor': 'someone-else' } });

    expect(calls[0].headers.get('X-Tenant-Id')).toBeNull();
    expect(calls[0].headers.get('Content-Type')).toBe('application/json');
    expect(calls[0].body).toEqual({ a: 1 });
    expect(calls[1].headers.get('X-Executor')).toBe('someone-else');
    expect(calls[1].headers.get('Content-Type')).toBeNull();
  });

  it('resolves undefined for 204 and for an empty body', async () => {
    const { impl } = fakeFetch(() => ({ status: 204 }));
    await expect(new ApiClient(() => session, '/api', impl).put('/z')).resolves.toBeUndefined();
  });

  it('turns an RFC 7807 problem into a ProblemError carrying error_code and violations', async () => {
    const { impl } = fakeFetch(() => ({
      status: 422,
      body: { title: 'Unprocessable Entity', detail: 'Schema violated', error_code: 'ERR-AST-00422', violations: ['$.cpu: is missing'] },
    }));

    const failure = await new ApiClient(() => session, '/api', impl).post('/it-asset-registry/v1/initiate', {}).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ProblemError);
    const problem = failure as ProblemError;
    expect(problem.status).toBe(422);
    expect(problem.errorCode).toBe('ERR-AST-00422');
    expect(problem.violations).toEqual(['$.cpu: is missing']);
    expect(problem.message).toBe('Schema violated');
  });

  it('falls back to the status line when the error body is not a problem document', async () => {
    const impl = (async () => new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })) as typeof fetch;

    const problem = (await new ApiClient(() => session, '/api', impl).get('/x').catch((e: unknown) => e)) as ProblemError;

    expect(problem.status).toBe(502);
    expect(problem.title).toBe('Bad Gateway');
    expect(problem.errorCode).toBeUndefined();
    expect(problem.violations).toEqual([]);
  });
});

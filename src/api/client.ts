export interface Session {
  organisationId: string;
  executor: string;
  /** Present when the platform runs with security on; the gateway then derives tenant and executor from it. */
  accessToken?: string;
}

/** An RFC 7807 problem document as every platform service emits it (plus the platform's `error_code`/`violations`). */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string | undefined,
    readonly errorCode: string | undefined,
    readonly violations: string[],
  ) {
    super(detail ?? title);
    this.name = 'ProblemError';
  }
}

type Query = Record<string, string | number | undefined>;

interface RequestOptions {
  body?: unknown;
  query?: Query;
  /** Extra headers, e.g. a different X-Executor. */
  headers?: Record<string, string>;
}

export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
}

export class ApiClient {
  constructor(
    private readonly getSession: () => Session | null,
    private readonly baseUrl = '/api',
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T = void>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const session = this.getSession();
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (session) {
      headers['X-Tenant-Id'] = session.organisationId;
      headers['X-Executor'] ??= session.executor;
      if (session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(buildUrl(this.baseUrl, path, options.query), { method, headers, body });
    if (!response.ok) throw await toProblem(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

async function toProblem(response: Response): Promise<ProblemError> {
  let json: Record<string, unknown> = {};
  try {
    json = await response.json();
  } catch {
    // not a problem document (e.g. a proxy error page): fall back to the status line
  }
  const violations = Array.isArray(json.violations) ? json.violations.map(String) : [];
  return new ProblemError(
    response.status,
    typeof json.title === 'string' ? json.title : response.statusText || `HTTP ${response.status}`,
    typeof json.detail === 'string' ? json.detail : undefined,
    typeof json.error_code === 'string' ? json.error_code : undefined,
    violations,
  );
}

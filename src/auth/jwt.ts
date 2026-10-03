/**
 * The `sub` claim of a JWT, read without verifying it (the gateway verifies tokens; this only chooses what to send as
 * X-Executor). The platform identifies a signed-in person by this opaque subject, never by their email, so audit entries
 * and service logs do not accumulate personal data.
 */
export function subjectOf(token: string): string | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub !== '' ? sub : undefined;
  } catch {
    return undefined;
  }
}

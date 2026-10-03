import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi, ssoLoginUrl } from '../api/services';
import { subjectOf } from '../auth/jwt';
import { useSession } from '../auth/session';
import { ProblemBanner } from '../components/Feedback';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a failed federated sign-in says: only the error code travels back to this page, never the provider's words. */
const SSO_ERRORS: Record<string, string> = {
  'ERR-FED-00403': 'Your identity is not linked to a user of this organisation. Ask an administrator to link it.',
  'ERR-FED-00400': 'That sign-in expired or was already used. Start again.',
  'ERR-FED-00409': 'Single sign-on is not enabled for this organisation.',
  'ERR-FED-00404': 'This organisation has no single sign-on set up.',
  'ERR-FED-00502': 'The identity provider could not be reached. Try again in a moment.',
  'ERR-FED-00503': 'Single sign-on is not fully configured on the server.',
};
const SSO_ERROR_FALLBACK = 'The identity provider could not confirm your sign-in.';

export function LoginPage() {
  const { api, signIn } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ssoError = params.get('sso_error');
  const [mode, setMode] = useState<'local' | 'account' | 'sso'>('local');
  const [organisationId, setOrganisationId] = useState('');
  const [executor, setExecutor] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const orgValid = UUID.test(organisationId.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const organisation = organisationId.trim();
    try {
      if (mode === 'sso') {
        // A full-page navigation: the browser goes to the organisation's identity provider and comes back through the gateway.
        window.location.assign(ssoLoginUrl(organisation));
        return;
      }
      if (mode === 'local') {
        signIn({ organisationId: organisation, executor: executor.trim() });
      } else {
        setBusy(true);
        const tokens = await authApi(api).signIn(organisation, email.trim(), password);
        // The executor is the token's opaque subject, not the email: the email is personal data and must not travel into audit entries.
        signIn({ organisationId: organisation, executor: subjectOf(tokens.accessToken) ?? 'user', displayName: email.trim(), accessToken: tokens.accessToken });
      }
      navigate('/assets');
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setBusy(false);
    }
  }

  const ready = orgValid && (mode === 'sso' || (mode === 'local' ? executor.trim() !== '' : email.trim() !== '' && password !== ''));

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>ThinkLab</h1>
        <p className="muted">IT asset operations for your organisation.</p>

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'local'} onClick={() => setMode('local')}>
            Local stack
          </button>
          <button type="button" role="tab" aria-selected={mode === 'account'} onClick={() => setMode('account')}>
            Account
          </button>
          <button type="button" role="tab" aria-selected={mode === 'sso'} onClick={() => setMode('sso')}>
            SSO
          </button>
        </div>

        <label>
          Organisation ID
          <input value={organisationId} onChange={(e) => setOrganisationId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" />
        </label>
        {organisationId !== '' && !orgValid && <p className="field-error">That is not a valid UUID.</p>}

        {mode === 'sso' ? (
          <p className="muted">You will be sent to your organisation's identity provider to sign in.</p>
        ) : mode === 'local' ? (
          <label>
            Your name (recorded in every audit entry)
            <input value={executor} onChange={(e) => setExecutor(e.target.value)} autoComplete="username" />
          </label>
        ) : (
          <>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
          </>
        )}

        {ssoError && <div className="banner banner-error" role="alert">{SSO_ERRORS[ssoError] ?? SSO_ERROR_FALLBACK}<code className="code">{ssoError}</code></div>}
        <ProblemBanner error={error} />
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? 'Signing in…' : mode === 'sso' ? 'Sign in with SSO' : 'Continue'}
        </button>
        <p className="muted small">
          {mode === 'local'
            ? 'For a stack running with security off: the organisation and name are sent as X-Tenant-Id and X-Executor.'
            : mode === 'account'
              ? 'For a stack running with security on: you receive a token and the gateway derives your tenant and identity from it.'
              : 'Your session is kept by the platform in a cookie this page cannot read; only a short-lived token is held in memory.'}
        </p>
      </form>
    </div>
  );
}

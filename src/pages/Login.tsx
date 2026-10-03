import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/services';
import { useSession } from '../auth/session';
import { ProblemBanner } from '../components/Feedback';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function LoginPage() {
  const { api, signIn } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'local' | 'account'>('local');
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
      if (mode === 'local') {
        signIn({ organisationId: organisation, executor: executor.trim() });
      } else {
        setBusy(true);
        const tokens = await authApi(api).signIn(organisation, email.trim(), password);
        signIn({ organisationId: organisation, executor: email.trim(), accessToken: tokens.accessToken });
      }
      navigate('/assets');
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setBusy(false);
    }
  }

  const ready = orgValid && (mode === 'local' ? executor.trim() !== '' : email.trim() !== '' && password !== '');

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
        </div>

        <label>
          Organisation ID
          <input value={organisationId} onChange={(e) => setOrganisationId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" />
        </label>
        {organisationId !== '' && !orgValid && <p className="field-error">That is not a valid UUID.</p>}

        {mode === 'local' ? (
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

        <ProblemBanner error={error} />
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? 'Signing in…' : 'Continue'}
        </button>
        <p className="muted small">
          {mode === 'local'
            ? 'For a stack running with security off: the organisation and name are sent as X-Tenant-Id and X-Executor.'
            : 'For a stack running with security on: you receive a token and the gateway derives your tenant and identity from it.'}
        </p>
      </form>
    </div>
  );
}

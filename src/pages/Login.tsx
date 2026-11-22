import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi, ssoLoginUrl } from '../api/services';
import { subjectOf } from '../auth/jwt';
import { useSession } from '../auth/session';
import { ProblemBanner } from '../components/Feedback';
import type { MessageKey } from '../i18n/en';
import { hasMessage, useT } from '../i18n';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a failed federated sign-in says: only the error code travels back to this page, never the provider's words; the words are the app's own (login.sso.*). */
export function LoginPage() {
  const t = useT();
  const { api, signIn, expired } = useSession();
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
        <p className="muted">{t('login.tagline')}</p>

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'local'} onClick={() => setMode('local')}>
            {t('login.tab.local')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'account'} onClick={() => setMode('account')}>
            {t('login.tab.account')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'sso'} onClick={() => setMode('sso')}>
            {t('login.tab.sso')}
          </button>
        </div>

        <label>
          {t('login.organisationId')}
          <input value={organisationId} onChange={(e) => setOrganisationId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" />
        </label>
        {organisationId !== '' && !orgValid && <p className="field-error">{t('login.invalidUuid')}</p>}

        {mode === 'sso' ? (
          <p className="muted">{t('login.ssoHint')}</p>
        ) : mode === 'local' ? (
          <label>
            {t('login.name')}
            <input value={executor} onChange={(e) => setExecutor(e.target.value)} autoComplete="username" />
          </label>
        ) : (
          <>
            <label>
              {t('login.email')}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </label>
            <label>
              {t('login.password')}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
          </>
        )}

        {expired && <div className="banner banner-error" role="alert">{t('login.expired')}</div>}
        {ssoError && <div className="banner banner-error" role="alert">{hasMessage(`login.sso.${ssoError}`) ? t(`login.sso.${ssoError}` as MessageKey) : t('login.sso.fallback')}<code className="code">{ssoError}</code></div>}
        <ProblemBanner error={error} />
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? t('login.signingIn') : mode === 'sso' ? t('login.signInSso') : t('login.continue')}
        </button>
        <p className="muted small">
          {mode === 'local'
            ? t('login.help.local')
            : mode === 'account'
              ? t('login.help.account')
              : t('login.help.sso')}
        </p>
      </form>
    </div>
  );
}

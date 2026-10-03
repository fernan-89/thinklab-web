import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sessionApi } from '../api/services';
import { claimsOf } from '../auth/jwt';
import { useSession } from '../auth/session';

/**
 * Where the gateway sends the browser after a federated sign-in. The refresh token is already in an HttpOnly cookie the page cannot
 * read; this page only trades that cookie for a short-lived access token (kept in memory) and moves on. It does so exactly once: a
 * refresh token is single-use, and a second attempt with it would look like theft and end the session.
 */
export function SsoCompletePage() {
  const { api, signIn } = useSession();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    sessionApi(api).refresh().then(
      (refreshed) => {
        const claims = claimsOf(refreshed.accessToken);
        if (!claims.tid || !claims.sub) {
          navigate('/login?sso_error=ERR-FED-00401', { replace: true });
          return;
        }
        // The executor is the token's opaque subject, never the email (personal data must not travel into audit entries).
        signIn({ organisationId: claims.tid, executor: claims.sub, accessToken: refreshed.accessToken, sso: true, expiresAt: Date.now() + refreshed.expiresIn * 1000 });
        navigate('/assets', { replace: true });
      },
      () => navigate('/login?sso_error=ERR-FED-00401', { replace: true }),
    );
  }, [api, signIn, navigate]);

  return <p className="muted" style={{ padding: '2rem' }}>Signing you in...</p>;
}

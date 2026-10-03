import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiClient, type Session } from '../api/client';
import { sessionApi, type RefreshedSession } from '../api/services';

const STORAGE_KEY = 'thinklab.session';

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** A federated session never persists its access token: it is rebuilt from the HttpOnly cookie after a reload. */
function store(session: Session | null): void {
  try {
    if (!session) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session.sso ? { ...session, accessToken: undefined, expiresAt: undefined } : session));
  } catch {
    // storage unavailable (private window): the session just lives in memory
  }
}

/** The access token is refreshed when this share of its life has passed (and never sooner than 5 seconds from now). */
const REFRESH_AT = 0.8;
const MIN_DELAY_MS = 5000;

interface SessionContextValue {
  session: Session | null;
  /** True while a reloaded federated session is getting its access token back from the cookie. */
  restoring: boolean;
  api: ApiClient;
  signIn: (session: Session) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children, client }: { children: ReactNode; client?: (get: () => Session | null) => ApiClient }) {
  const [session, setSession] = useState<Session | null>(load);
  const [restoring, setRestoring] = useState(() => {
    const stored = load();
    return stored?.sso === true && !stored.accessToken;
  });
  // The client reads the live session through a ref, so it is never rebuilt on sign-in or sign-out.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const api = useMemo(() => (client ? client(() => sessionRef.current) : new ApiClient(() => sessionRef.current)), [client]);

  const signIn = useCallback((next: Session) => {
    store(next);
    setSession(next);
    setRestoring(false);
  }, []);
  const signOut = useCallback(() => {
    const federated = sessionRef.current?.sso === true;
    store(null);
    setSession(null);
    setRestoring(false);
    // Best effort: revoke the session behind the cookie and clear the cookie. The page is signed out either way.
    if (federated) sessionApi(api).logout().catch(() => undefined);
  }, [api]);

  const adopt = useCallback((refreshed: RefreshedSession) => {
    const current = sessionRef.current;
    if (current) signIn({ ...current, accessToken: refreshed.accessToken, expiresAt: Date.now() + refreshed.expiresIn * 1000, sso: true });
  }, [signIn]);
  const dropped = useCallback(() => {
    store(null);
    setSession(null);
    setRestoring(false);
  }, []);

  // After a reload the federated session has no access token: get one from the cookie. Exactly once - a refresh token is single-use, and
  // presenting it twice would look like theft and end the session (so the guard survives a development double-mount).
  const restoreStarted = useRef(false);
  useEffect(() => {
    if (!restoring || restoreStarted.current) return;
    restoreStarted.current = true;
    sessionApi(api).refresh().then(adopt, dropped);
  }, [restoring, api, adopt, dropped]);

  // Refresh the access token before it expires; a refusal means the cookie is dead, so the person signs in again.
  useEffect(() => {
    if (!session?.sso || !session.accessToken || !session.expiresAt) return undefined;
    const delay = Math.max((session.expiresAt - Date.now()) * REFRESH_AT, MIN_DELAY_MS);
    const timer = setTimeout(() => {
      sessionApi(api).refresh().then(adopt, dropped);
    }, delay);
    return () => clearTimeout(timer);
  }, [session, api, adopt, dropped]);

  const value = useMemo(() => ({ session, restoring, api, signIn, signOut }), [session, restoring, api, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}

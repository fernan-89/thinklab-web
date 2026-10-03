import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiClient, type Session } from '../api/client';

const STORAGE_KEY = 'thinklab.session';

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function store(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private window): the session just lives in memory
  }
}

interface SessionContextValue {
  session: Session | null;
  api: ApiClient;
  signIn: (session: Session) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children, client }: { children: ReactNode; client?: (get: () => Session | null) => ApiClient }) {
  const [session, setSession] = useState<Session | null>(load);
  // The client reads the live session through a ref, so it is never rebuilt on sign-in or sign-out.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const api = useMemo(() => (client ? client(() => sessionRef.current) : new ApiClient(() => sessionRef.current)), [client]);

  const signIn = useCallback((next: Session) => {
    store(next);
    setSession(next);
  }, []);
  const signOut = useCallback(() => {
    store(null);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, api, signIn, signOut }), [session, api, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';

export function Layout() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">ThinkLab</span>
        <nav aria-label="Main">
          <NavLink to="/assets">Assets</NavLink>
          <NavLink to="/discovery">Discovery</NavLink>
          <NavLink to="/topology">Topology</NavLink>
          <NavLink to="/audit">Audit</NavLink>
        </nav>
        <div className="who">
          <span title={session?.organisationId}>{session?.executor}</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              signOut();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

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
          <NavLink to="/incidents">Incidents</NavLink>
          <NavLink to="/problems">Problems</NavLink>
          <NavLink to="/requests">Requests</NavLink>
          <NavLink to="/approvals">Approvals</NavLink>
          <NavLink to="/stock">Stock</NavLink>
          <NavLink to="/topology">Topology</NavLink>
          <NavLink to="/audit">Audit</NavLink>
          <NavLink to="/plan">Plan</NavLink>
        </nav>
        <div className="who">
          <span title={session?.organisationId}>{session?.displayName ?? session?.executor}</span>
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
      <div className="productband">
        <div className="productband-inner">
          <span className="logo" aria-hidden="true" />
          <span className="product">Platform</span>
        </div>
      </div>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

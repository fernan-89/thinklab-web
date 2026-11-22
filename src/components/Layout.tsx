import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n';

const NAV: ReadonlyArray<readonly [string, MessageKey]> = [
  ['/assets', 'nav.assets'],
  ['/discovery', 'nav.discovery'],
  ['/incidents', 'nav.incidents'],
  ['/problems', 'nav.problems'],
  ['/knowledge', 'nav.knowledge'],
  ['/requests', 'nav.requests'],
  ['/integrations', 'nav.integrations'],
  ['/health', 'nav.health'],
  ['/alerts', 'nav.alerts'],
  ['/backups', 'nav.backups'],
  ['/recovery', 'nav.recovery'],
  ['/patches', 'nav.patches'],
  ['/capacity', 'nav.capacity'],
  ['/vendors', 'nav.vendors'],
  ['/licenses', 'nav.licenses'],
  ['/procurement', 'nav.procurement'],
  ['/network', 'nav.network'],
  ['/cloud-costs', 'nav.cloudCosts'],
  ['/cloud-inventory', 'nav.cloudInventory'],
  ['/approvals', 'nav.approvals'],
  ['/stock', 'nav.stock'],
  ['/topology', 'nav.topology'],
  ['/audit', 'nav.audit'],
  ['/quick-install', 'nav.quickInstall'],
  ['/plan', 'nav.plan'],
];
export function Layout() {
  const t = useT();
  const { session, signOut } = useSession();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">ThinkLab</span>
        <nav aria-label={t('shell.mainNav')}>
          {NAV.map(([to, key]) => (
            <NavLink key={to} to={to}>
              {t(key)}
            </NavLink>
          ))}
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
            {t('shell.signOut')}
          </button>
        </div>
      </header>
      <div className="productband">
        <div className="productband-inner">
          <span className="logo" aria-hidden="true" />
          <span className="product">{t('shell.platform')}</span>
        </div>
      </div>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

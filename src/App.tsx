import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './auth/session';
import { Layout } from './components/Layout';
import { AssetsPage } from './pages/Assets';
import { ApprovalsPage } from './pages/Approvals';
import { DiscoveryPage } from './pages/Discovery';
import { IncidentsPage } from './pages/Incidents';
import { KnowledgePage } from './pages/Knowledge';
import { IntegrationsPage } from './pages/Integrations';
import { HealthPage } from './pages/Health';
import { AlertsPage } from './pages/Alerts';
import { BackupsPage } from './pages/Backups';
import { ProblemsPage } from './pages/Problems';
import { ServiceRequestsPage } from './pages/ServiceRequests';
import { LoginPage } from './pages/Login';
import { SsoCompletePage } from './pages/SsoComplete';
import { AuditPage } from './pages/Audit';
import { PlanPage } from './pages/Plan';
import { StockPage } from './pages/Stock';
import { TopologyPage } from './pages/Topology';

export function App() {
  const { session, restoring } = useSession();
  if (restoring) return <p className="muted" style={{ padding: '2rem' }}>Restoring your session...</p>;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/sso/complete" element={<SsoCompletePage />} />
      <Route element={session ? <Layout /> : <Navigate to="/login" replace />}>
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/backups" element={<BackupsPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/problems" element={<ProblemsPage />} />
        <Route path="/requests" element={<ServiceRequestsPage />} />
        <Route path="/discovery" element={<DiscoveryPage />} />
        <Route path="/topology" element={<TopologyPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/stock" element={<StockPage />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/assets' : '/login'} replace />} />
    </Routes>
  );
}

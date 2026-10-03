import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './auth/session';
import { Layout } from './components/Layout';
import { AssetsPage } from './pages/Assets';
import { DiscoveryPage } from './pages/Discovery';
import { LoginPage } from './pages/Login';
import { AuditPage } from './pages/Audit';
import { PlanPage } from './pages/Plan';
import { StockPage } from './pages/Stock';
import { TopologyPage } from './pages/Topology';

export function App() {
  const { session } = useSession();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={session ? <Layout /> : <Navigate to="/login" replace />}>
        <Route path="/assets" element={<AssetsPage />} />
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

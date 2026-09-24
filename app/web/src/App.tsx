import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import { startEventStream } from './lib/events';
import { AppShell } from './components/AppShell';
import Login from './pages/Login';
import Create from './pages/Create';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Cast from './pages/Cast';
import Locations from './pages/Locations';
import LocationDetail from './pages/LocationDetail';
import LoRAs from './pages/LoRAs';
import SettingsPage from './pages/Settings';

function useAuth() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((r) => !cancelled && setState(r.authenticated ? 'in' : 'out'))
      .catch(() => !cancelled && setState('out'));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    if (auth === 'in') startEventStream(qc);
  }, [auth, qc]);

  if (auth === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-0)]">
        <div className="size-8 animate-spin rounded-full border-2 border-white/10 border-t-[var(--color-amber-400)]" />
      </div>
    );
  }
  if (auth === 'out') return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Create />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/cast" element={<Cast />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/locations/:id" element={<LocationDetail />} />
        <Route path="/loras" element={<LoRAs />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

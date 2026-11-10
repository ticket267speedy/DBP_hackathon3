import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { PublicOnly, RequireAuth, RequirePermission } from './auth/guards';
import { Spinner } from './components/Screens';
import AppLayout from './layout/AppLayout';
import EstadoPage from './pages/EstadoPage';
import FilesPage from './pages/FilesPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import RegisterPage from './pages/RegisterPage';

// La grilla del CP2 se carga aparte (code splitting): no está en el bundle inicial de /login.
const RefinePage = lazy(() => import('./pages/RefinePage'));
const RefinersPage = lazy(() => import('./personnel/RefinersPage').then(m => ({ default: m.RefinersPage })));
const RefinerEditPage = lazy(() => import('./personnel/RefinerEditPage').then(m => ({ default: m.RefinerEditPage })));
const BadgePage = lazy(() => import('./personnel/BadgePage').then(m => ({ default: m.BadgePage })));
const IncidentsPage = lazy(() => import('./incidents/IncidentsPage').then(m => ({ default: m.IncidentsPage })));
const NewIncidentPage = lazy(() => import('./incidents/NewIncidentPage').then(m => ({ default: m.NewIncidentPage })));

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route
            path="/files"
            element={
              <RequirePermission permission="files:read">
                <FilesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/files/:id/refine"
            element={
              <RequirePermission permission="files:read">
                <Suspense fallback={<Spinner label="Cargando la grilla…" />}>
                  <RefinePage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route path="/estado" element={<EstadoPage />} />
          <Route path="/refiners" element={<RequirePermission permission="refiners:read"><Suspense fallback={<Spinner label="Cargando expedientes…" />}><RefinersPage /></Suspense></RequirePermission>} />
          <Route path="/refiners/:id/edit" element={<RequirePermission permission="refiners:write"><Suspense fallback={<Spinner label="Cargando expediente…" />}><RefinerEditPage /></Suspense></RequirePermission>} />
          <Route path="/refiners/:id/badge" element={<RequirePermission permission="refiners:write"><RequirePermission permission="media:upload"><Suspense fallback={<Spinner label="Cargando fotocheck…" />}><BadgePage /></Suspense></RequirePermission></RequirePermission>} />
          <Route path="/incidents" element={<RequirePermission permission="incidents:read"><Suspense fallback={<Spinner label="Cargando incidencias…" />}><IncidentsPage /></Suspense></RequirePermission>} />
          <Route path="/incidents/new" element={<RequirePermission permission="incidents:create"><RequirePermission permission="media:upload"><Suspense fallback={<Spinner label="Cargando formulario…" />}><NewIncidentPage /></Suspense></RequirePermission></RequirePermission>} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

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
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

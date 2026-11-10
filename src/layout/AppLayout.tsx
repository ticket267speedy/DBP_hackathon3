import { lazy, Suspense } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { BUILD_ID } from '../config';
const RealtimeProvider = lazy(() => import('../realtime/RealtimeProvider').then(m => ({ default: m.RealtimeProvider })));

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive
    ? 'rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--mdr-accent)]/15 text-[var(--mdr-accent)]'
    : 'rounded-md px-3 py-1.5 text-sm text-[var(--mdr-muted)] hover:text-[var(--mdr-ink)]';
}

export default function AppLayout() {
  const { me, can, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function onLogout() {
    // logout() cierra la sesión en todas las pestañas en el acto y luego la revoca en el servidor.
    // Se navega en el mismo tick: el login no recuerda la ruta anterior (fue una salida voluntaria).
    void logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-[var(--mdr-bg)] text-[var(--mdr-ink)]">
      <a href="#contenido" className="mdr-skip">
        Saltar al contenido
      </a>
      <header className="border-b border-[var(--mdr-line)] bg-[var(--mdr-panel)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="font-mono text-sm font-semibold tracking-[0.2em] uppercase">Lumon · MDR</span>
          <nav aria-label="Principal" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={navClass}>
              Inicio
            </NavLink>
            {can('files:read') && (
              <NavLink to="/files" className={navClass}>
                Archivos
              </NavLink>
            )}
            <NavLink to="/estado" className={navClass}>
              Estado
            </NavLink>
            {can('refiners:read') && <NavLink to="/refiners" className={navClass}>Expedientes</NavLink>}
            {can('incidents:read') && <NavLink to="/incidents" className={navClass}>Incidencias</NavLink>}
            {can('incidents:create') && <NavLink to="/incidents/new" className={navClass}>Reportar</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {me && (
              <span className="text-[var(--mdr-muted)]">
                <span className="text-[var(--mdr-ink)]">{me.displayName}</span> · {me.team.code} · {me.role.name}
              </span>
            )}
            <button type="button" className="mdr-btn-ghost" onClick={onLogout}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>
      <main id="contenido" className="mx-auto max-w-7xl px-4 py-6">
        <Suspense fallback={<p role="status">Cargando consola…</p>}>
          <RealtimeProvider><ErrorBoundary key={location.pathname}><Outlet /></ErrorBoundary></RealtimeProvider>
        </Suspense>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-6 font-mono text-xs text-[var(--mdr-muted)]">build {BUILD_ID}</footer>
    </div>
  );
}

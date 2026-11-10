import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Permission } from '../api/types';
import { FullScreen } from '../components/Screens';
import ForbiddenPage from '../pages/ForbiddenPage';
import { useAuth } from './AuthContext';

/** Lee `from` del state de la navegación sin confiar en su forma. Solo rutas internas. */
export function readFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null;
  const from = (state as { from: unknown }).from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : null;
}

function RestoreFailed() {
  const { state, retryRestore, logout } = useAuth();
  return (
    <FullScreen title="No pudimos verificar tu sesión">
      <p>{state.status === 'restore-failed' ? state.message : ''}</p>
      <div className="flex justify-center gap-3">
        <button type="button" className="mdr-btn" onClick={retryRestore}>
          Reintentar
        </button>
        <button type="button" className="mdr-btn-ghost" onClick={() => void logout()}>
          Cerrar sesión
        </button>
      </div>
    </FullScreen>
  );
}

/** Rutas privadas: guarda la ruta pedida (con su query string) para volver después del login. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'restoring') return <FullScreen title="Verificando tu sesión…" />;
  if (state.status === 'restore-failed') return <RestoreFailed />;
  if (state.status === 'anonymous') {
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <Outlet />;
}

/** Login y registro: con sesión, vuelven a la ruta que se quería abrir. */
export function PublicOnly() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'restoring') return <FullScreen title="Verificando tu sesión…" />;
  if (state.status === 'restore-failed') return <RestoreFailed />;
  if (state.status === 'authenticated') return <Navigate to={readFrom(location.state) ?? '/'} replace />;
  return <Outlet />;
}

/** La interfaz se decide por `permissions` (nunca por el rol). Sin permiso: página "sin permiso". */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return <ForbiddenPage permission={permission} />;
  return <>{children}</>;
}

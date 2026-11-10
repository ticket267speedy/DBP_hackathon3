import { Link } from 'react-router';
import type { Permission } from '../api/types';
import { useAuth } from '../auth/AuthContext';

const PERMISSIONS: Array<{ id: Permission; label: string }> = [
  { id: 'files:read', label: 'Ver archivos' },
  { id: 'files:refine', label: 'Refinar grupos' },
  { id: 'refiners:read', label: 'Ver expedientes' },
  { id: 'refiners:write', label: 'Editar expedientes' },
  { id: 'media:upload', label: 'Subir imágenes' },
  { id: 'incidents:read', label: 'Ver incidencias' },
  { id: 'incidents:create', label: 'Reportar incidencias' },
  { id: 'team:manage', label: 'Gestionar el equipo' },
];

export default function HomePage() {
  const { me, can } = useAuth();
  if (!me) return null;
  return (
    <div className="space-y-6">
      <section aria-labelledby="home-title" className="mdr-panel">
        <p className="font-mono text-xs tracking-[0.3em] text-[var(--mdr-muted)] uppercase">{me.team.code}</p>
        <h1 id="home-title" className="mt-2 text-2xl font-semibold">
          Bienvenida al piso, {me.displayName}
        </h1>
        <p className="mt-1 text-[var(--mdr-muted)]">
          Cuadrilla {me.team.name} · Rol: {me.role.name}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {can('files:read') ? (
            <Link to="/files" className="mdr-btn">
              Abrir archivos de datos
            </Link>
          ) : (
            <p className="text-sm text-[var(--mdr-muted)]">Tu rol no puede ver los archivos de datos.</p>
          )}
          <Link to="/estado" className="mdr-btn-ghost">
            Estado del piso
          </Link>
        </div>
      </section>

      <section aria-labelledby="perm-title" className="mdr-panel">
        <h2 id="perm-title" className="text-lg font-semibold">
          Tus permisos
        </h2>
        <p className="mt-1 text-sm text-[var(--mdr-muted)]">
          La consola muestra u oculta acciones según estos permisos (no según el rol).
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {PERMISSIONS.map((perm) => {
            const granted = can(perm.id);
            return (
              <li
                key={perm.id}
                className="flex items-center justify-between gap-3 rounded-md border border-[var(--mdr-line)] px-3 py-2"
              >
                <span>
                  {perm.label} <code className="font-mono text-xs text-[var(--mdr-muted)]">{perm.id}</code>
                </span>
                <span className={granted ? 'mdr-chip mdr-chip-ok' : 'mdr-chip'}>{granted ? 'Sí' : 'No'}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="clear-title" className="mdr-panel">
        <h2 id="clear-title" className="text-lg font-semibold">
          Piso de Pruebas
        </h2>
        <p className="mt-1 text-[var(--mdr-muted)]">
          {me.clearance.granted
            ? `Abierto desde ${new Date(me.clearance.grantedAt ?? '').toLocaleString()}.`
            : 'Cerrado. Se abre con la revisión automática desde la página Estado de la app desplegada.'}
        </p>
      </section>
    </div>
  );
}

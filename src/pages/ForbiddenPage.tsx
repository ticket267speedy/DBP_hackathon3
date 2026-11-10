import { Link } from 'react-router';
import type { Permission } from '../api/types';

export default function ForbiddenPage({ permission }: { permission?: Permission }) {
  return (
    <section className="mx-auto max-w-lg py-16 text-center" aria-labelledby="forbidden-title">
      <p className="font-mono text-xs tracking-[0.3em] text-[var(--mdr-muted)] uppercase">Acceso restringido</p>
      <h1 id="forbidden-title" className="mt-3 text-2xl font-semibold">
        Sin permiso
      </h1>
      <p className="mt-3 text-[var(--mdr-muted)]">
        Tu cuenta no tiene acceso a esta sección
        {permission ? (
          <>
            {' '}
            (requiere <code className="font-mono">{permission}</code>)
          </>
        ) : null}
        . Pídele a tu supervisión que te asigne un rol con ese permiso.
      </p>
      <Link to="/" className="mdr-btn mt-6 inline-block">
        Volver al inicio
      </Link>
    </section>
  );
}

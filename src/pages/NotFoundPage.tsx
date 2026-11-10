import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--mdr-bg)] px-4 text-[var(--mdr-ink)]">
      <section className="max-w-md text-center" aria-labelledby="nf-title">
        <p className="font-mono text-6xl font-semibold text-[var(--mdr-accent)]" aria-hidden="true">
          404
        </p>
        <h1 id="nf-title" className="mt-4 text-2xl font-semibold">
          Esta sala no existe
        </h1>
        <p className="mt-2 text-[var(--mdr-muted)]">Revisa la dirección o vuelve al piso principal.</p>
        <Link to="/" className="mdr-btn mt-6 inline-block">
          Ir al inicio
        </Link>
      </section>
    </main>
  );
}

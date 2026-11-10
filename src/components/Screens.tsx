import type { ReactNode } from 'react';

/** Pantalla completa centrada (verificando sesión, conectando, errores globales). */
export function FullScreen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--mdr-bg)] px-4 text-[var(--mdr-ink)]">
      <div className="w-full max-w-md text-center" role="status" aria-live="polite">
        <p className="font-mono text-xs tracking-[0.3em] text-[var(--mdr-muted)] uppercase">Lumon Industries</p>
        <h1 className="mt-3 text-2xl font-semibold text-balance">{title}</h1>
        {children && <div className="mt-4 space-y-4 text-[var(--mdr-muted)]">{children}</div>}
      </div>
    </main>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-[var(--mdr-muted)]" role="status">
      <span className="mdr-spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

export function ErrorBox({ message, onRetry, retryLabel = 'Reintentar' }: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--mdr-danger)]/50 bg-[var(--mdr-danger)]/10 p-4" role="alert">
      <p className="text-[var(--mdr-ink)]">{message}</p>
      {onRetry && (
        <button type="button" className="mdr-btn mt-3" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

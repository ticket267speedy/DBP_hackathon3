import type { ReactNode } from 'react';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--mdr-bg)] px-4 py-10 text-[var(--mdr-ink)]">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-[var(--mdr-line)] bg-[var(--mdr-panel)] p-6 shadow-xl">
        <div>
          <p className="font-mono text-xs tracking-[0.3em] text-[var(--mdr-muted)] uppercase">Lumon · MDR</p>
          <h1 className="mt-2 text-2xl font-semibold text-balance">{title}</h1>
          <p className="mt-1 text-sm text-[var(--mdr-muted)]">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

export function Field(props: {
  id: string;
  label: string;
  type: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
  hint?: string;
}) {
  const describedBy = props.error ? `${props.id}-error` : props.hint ? `${props.id}-hint` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="block text-sm font-medium">
        {props.label}
      </label>
      <input
        id={props.id}
        name={props.id}
        type={props.type}
        className="mdr-input"
        value={props.value}
        autoComplete={props.autoComplete}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.hint && !props.error && (
        <p id={`${props.id}-hint`} className="text-xs text-[var(--mdr-muted)]">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={`${props.id}-error`} className="text-sm text-[var(--mdr-danger)]">
          {props.error}
        </p>
      )}
    </div>
  );
}

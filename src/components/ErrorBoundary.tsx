import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Un error de render en una ruta no deja la app en blanco. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error de render', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section className="mx-auto max-w-lg py-16 text-center" role="alert">
        <h1 className="text-2xl font-semibold">Algo falló en esta pantalla</h1>
        <p className="mt-2 text-[var(--mdr-muted)]">{this.state.error.message}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" className="mdr-btn" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
          <a href="/" className="mdr-btn-ghost">
            Volver al inicio
          </a>
        </div>
      </section>
    );
  }
}

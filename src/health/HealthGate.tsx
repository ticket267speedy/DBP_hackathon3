import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { onNetworkFailure, rawRequest } from '../api/http';
import type { Health } from '../api/types';
import { FullScreen } from '../components/Screens';
import { CONFIG_OK } from '../config';

const HEALTH_TIMEOUT_MS = 8000;

/** Espera creciente: 1 s, 2 s, 4 s, 8 s, 16 s y luego 30 s como tope (con un poco de azar). */
function retryDelay(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

type Phase =
  | { kind: 'checking'; attempt: number }
  | { kind: 'up' }
  | { kind: 'down'; attempt: number; retryAt: number };

async function checkHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const { data } = await rawRequest<Health>('/meta/health', { signal: controller.signal });
    return data.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Antes de mostrar la app, GET /meta/health. Si no responde: "Conectando con Lumon…", que reintenta
 * sola con espera creciente y permite reintentar a mano. Si más tarde una request falla por red,
 * se vuelve a revisar sin desmontar la app (se muestra encima).
 */
export function HealthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking', attempt: 0 });
  const [everUp, setEverUp] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const checking = useRef(false);

  const runCheck = useCallback(async (attempt: number) => {
    if (checking.current) return;
    checking.current = true;
    const ok = await checkHealth();
    checking.current = false;
    if (ok) {
      setEverUp(true);
      setPhase({ kind: 'up' });
    } else {
      setPhase({ kind: 'down', attempt: attempt + 1, retryAt: Date.now() + retryDelay(attempt) });
    }
  }, []);

  // checking → hace la request
  useEffect(() => {
    if (phase.kind === 'checking') void runCheck(phase.attempt);
  }, [phase, runCheck]);

  // down → reintento automático al llegar retryAt, y un reloj para la cuenta regresiva
  useEffect(() => {
    if (phase.kind !== 'down') return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    const retry = setTimeout(
      () => setPhase({ kind: 'checking', attempt: phase.attempt }),
      Math.max(0, phase.retryAt - Date.now()),
    );
    return () => {
      clearInterval(tick);
      clearTimeout(retry);
    };
  }, [phase]);

  // Ya conectados: un corte de red en cualquier request dispara una revisión.
  useEffect(
    () =>
      onNetworkFailure(() => {
        setPhase((prev) => (prev.kind === 'up' ? { kind: 'checking', attempt: 0 } : prev));
      }),
    [],
  );

  if (!CONFIG_OK) {
    return (
      <FullScreen title="Falta configurar la API">
        <p>
          Define <code className="font-mono">VITE_API_BASE_URL</code> en <code className="font-mono">.env</code> (o en
          las variables del hosting) y vuelve a construir la app.
        </p>
      </FullScreen>
    );
  }

  const connecting = (
    <FullScreen title="Conectando con Lumon…">
      {phase.kind === 'down' ? (
        <>
          <p>
            La API no responde. Reintentaremos en {Math.max(0, Math.ceil((phase.retryAt - now) / 1000))} s (intento{' '}
            {phase.attempt}).
          </p>
          <button
            type="button"
            className="mdr-btn"
            onClick={() => setPhase({ kind: 'checking', attempt: phase.attempt })}
          >
            Reintentar ahora
          </button>
        </>
      ) : (
        <p>Comprobando el estado del servicio…</p>
      )}
    </FullScreen>
  );

  if (!everUp) return phase.kind === 'up' ? <>{children}</> : connecting;

  return (
    <>
      {children}
      {phase.kind === 'down' && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Conectando con Lumon">
          {connecting}
        </div>
      )}
    </>
  );
}

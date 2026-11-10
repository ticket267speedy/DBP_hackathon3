import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { ApiError, errorMessage } from '../api/errors';
import { rawRequest } from '../api/http';
import type { ClearanceCheckResult, ClearanceInfo, Health, IntegrationStatus } from '../api/types';
import { ErrorBox, Spinner } from '../components/Screens';
import { BUILD_ID } from '../config';
import { notifyFloorOpened } from '../realtime/events';

interface Snapshot {
  health: boolean;
  integrations: IntegrationStatus | null;
  clearance: ClearanceInfo | null;
  error: string | null;
}

const CHECK_LABELS: Record<string, string> = {
  DEPLOY: 'Despliegue',
  SESSION: 'Sesión',
  GRID: 'Grilla',
  REFINE: 'Refinamiento',
};

/** Página /estado: build desplegado, API, integraciones, clearance y la revisión automática (CP3). */
export default function EstadoPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<ClearanceCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [chaosSaving, setChaosSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load(): Promise<Snapshot> {
      const health = await rawRequest<Health>('/meta/health', { signal })
        .then((r) => r.data.status === 'ok')
        .catch(() => false);
      const [integrations, clearance] = await Promise.all([
        api<IntegrationStatus>('/integrations/status', { signal, retries: 2 }).catch(() => null),
        api<ClearanceInfo>('/clearance', { signal, retries: 2 }).catch(() => null),
      ]);
      return {
        health,
        integrations,
        clearance,
        error: integrations && clearance ? null : 'No se pudo leer todo el estado. Reintenta.',
      };
    }
    load()
      .then((result) => {
        if (!signal.aborted) setSnapshot(result);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [reload]);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const result = await api<ClearanceCheckResult>('/clearance/check', { method: 'POST' });
      setCheckResult(result);
      if (result.granted) notifyFloorOpened();
      setReload((n) => n + 1);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CHECK_FROM_APP_REQUIRED') {
        setCheckError('La revisión solo cuenta desde la app desplegada en el dominio verificado (no desde localhost).');
      } else {
        setCheckError(errorMessage(error));
      }
    } finally {
      setChecking(false);
    }
  }, []);

  const setChaos = useCallback(async (level: 0 | 1 | 2) => {
    setChaosSaving(true);
    try {
      await api<{ level: number }>('/workspace/chaos', { method: 'PUT', body: { level } });
      setReload((n) => n + 1);
    } catch (error) {
      setCheckError(errorMessage(error));
    } finally {
      setChaosSaving(false);
    }
  }, []);

  const checks = checkResult?.checks ?? snapshot?.clearance?.checks ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Estado</h1>
      {!snapshot ? (
        <Spinner label="Leyendo el estado…" />
      ) : (
        <>
          {snapshot.error && <ErrorBox message={snapshot.error} onRetry={() => setReload((n) => n + 1)} />}
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="mdr-panel">
              <dt className="text-sm text-[var(--mdr-muted)]">Build desplegado</dt>
              <dd className="mt-1 font-mono text-lg">{BUILD_ID}</dd>
            </div>
            <div className="mdr-panel">
              <dt className="text-sm text-[var(--mdr-muted)]">API</dt>
              <dd className="mt-1 text-lg">{snapshot.health ? 'Responde' : 'No responde'}</dd>
            </div>
            <div className="mdr-panel">
              <dt className="text-sm text-[var(--mdr-muted)]">Dominio verificado</dt>
              <dd className="mt-1 break-all">{snapshot.integrations?.deploy.origin ?? 'Sin verificar'}</dd>
            </div>
            <div className="mdr-panel">
              <dt className="text-sm text-[var(--mdr-muted)]">Storage</dt>
              <dd className="mt-1">
                {snapshot.integrations?.storage.provider ?? 'Sin configurar'}
                {snapshot.integrations?.storage.verifiedAt ? ' · verificado' : ''}
              </dd>
            </div>
          </dl>

          <section className="mdr-panel space-y-4" aria-labelledby="piso-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="piso-title" className="text-lg font-semibold">
                  Piso de Pruebas: {snapshot.clearance?.granted ? 'abierto' : 'cerrado'}
                </h2>
                <p className="text-sm text-[var(--mdr-muted)]">
                  Workspace {snapshot.clearance?.workspace.kind ?? '—'} · caos nivel{' '}
                  {snapshot.clearance?.workspace.chaosLevel ?? '—'}
                </p>
              </div>
              <button type="button" className="mdr-btn" onClick={() => void runCheck()} disabled={checking}>
                {checking ? 'Revisando…' : 'Abrir el Piso de Pruebas'}
              </button>
            </div>
            {snapshot.clearance?.workspace.kind === 'DEV' && (
              <fieldset className="flex flex-wrap items-center gap-2" disabled={chaosSaving}>
                <legend className="mb-2 text-sm text-[var(--mdr-muted)]">Modo caos (para probar)</legend>
                {([0, 1, 2] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={snapshot.clearance?.workspace.chaosLevel === level ? 'mdr-btn' : 'mdr-btn-ghost'}
                    aria-pressed={snapshot.clearance?.workspace.chaosLevel === level}
                    onClick={() => void setChaos(level)}
                  >
                    Nivel {level}
                  </button>
                ))}
              </fieldset>
            )}
            {checkError && <ErrorBox message={checkError} />}
            {checks.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {checks.map((check) => (
                  <li key={check.name} className="rounded-md border border-[var(--mdr-line)] p-3">
                    <p className="flex items-center justify-between gap-2 font-medium">
                      {CHECK_LABELS[check.name] ?? check.name}
                      <span className={check.passed ? 'mdr-chip mdr-chip-ok' : 'mdr-chip mdr-chip-bad'}>
                        {check.passed ? 'Pasa' : 'No pasa'}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-[var(--mdr-muted)]">{check.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

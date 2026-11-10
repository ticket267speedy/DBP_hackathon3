import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { errorMessage, isAbortError } from '../api/errors';
import type { FilePage } from '../api/types';
import { ErrorBox } from '../components/Screens';
import {
  FILE_SIZES,
  parseFilesQuery,
  toSearchParams,
  type FileSize,
  type FileSort,
  type FilesQuery,
} from '../files/filesQuery';
import { useDebouncedValue } from '../lib/useDebouncedValue';

/** Caché en memoria por URL: volver desde la grilla pinta el listado al instante. */
const pageCache = new Map<string, FilePage>();

const ROW_HEIGHT_REM = 3.25;

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export default function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseFilesQuery(searchParams);
  const key = toSearchParams(query).toString();

  const [result, setResult] = useState<{ key: string; data: FilePage } | null>(() => {
    const cached = pageCache.get(key);
    return cached ? { key, data: cached } : null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [text, setText] = useState(query.q);
  const debouncedText = useDebouncedValue(text, 350);

  /** Cambiar filtro, búsqueda, orden o tamaño vuelve a la página 0: nunca se queda en una página que no existe. */
  const update = useCallback(
    (changes: Partial<FilesQuery>, replace = false) => {
      setSearchParams((prev) => toSearchParams({ ...parseFilesQuery(prev), page: 0, ...changes }), { replace });
    },
    [setSearchParams],
  );

  // URL inválida o no canónica (?page=-3&size=7…) → se reemplaza por la versión saneada, sin romper la vista.
  useEffect(() => {
    if (searchParams.toString() !== key) setSearchParams(new URLSearchParams(key), { replace: true });
  }, [searchParams, key, setSearchParams]);

  // Una request por estado de la URL. La anterior se cancela (AbortController) y su respuesta se ignora:
  // una respuesta vieja nunca pisa a una nueva.
  useEffect(() => {
    const controller = new AbortController();
    const q = parseFilesQuery(new URLSearchParams(key));
    setLoading(true);
    setError(null);
    api<FilePage>('/files', {
      signal: controller.signal,
      retries: 3,
      query: { page: q.page, size: q.size, status: q.status, q: q.q, sort: q.sort },
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        pageCache.set(key, data);
        setResult({ key, data });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [key, retryTick]);

  // Búsqueda: la URL cambia solo cuando se deja de teclear.
  useEffect(() => {
    const next = debouncedText.trim().slice(0, 60);
    if (next !== parseFilesQuery(searchParams).q) update({ q: next });
  }, [debouncedText]);

  // Atrás/adelante o un enlace cambian q: el input se sincroniza con la URL.
  useEffect(() => {
    setText((prev) => (prev.trim() === query.q ? prev : query.q));
  }, [query.q]);

  // Página fuera de rango (p. ej. ?page=999): a la última página que existe.
  const data = result?.data ?? null;
  useEffect(() => {
    if (!result || result.key !== key) return;
    const last = Math.max(0, result.data.totalPages - 1);
    if (query.page > last) {
      setSearchParams(toSearchParams({ ...query, page: last }), { replace: true });
    }
  }, [result, key, query, setSearchParams]);

  const goToPage = (page: number) => setSearchParams(toSearchParams({ ...query, page }));
  const totalPages = data?.totalPages ?? 0;
  const showingStale = loading && result !== null && result.key !== key;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Archivos de datos</h1>
          <p className="text-sm text-[var(--mdr-muted)]">
            {data ? `${data.totalElements} archivo${data.totalElements === 1 ? '' : 's'}` : 'Cargando…'}
          </p>
        </div>
      </div>

      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: text.trim().slice(0, 60) });
        }}
      >
        <div>
          <label htmlFor="files-q" className="mb-1 block text-sm font-medium">
            Buscar
          </label>
          <input
            id="files-q"
            className="mdr-input"
            type="search"
            maxLength={60}
            placeholder="Nombre del archivo"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="files-status" className="mb-1 block text-sm font-medium">
            Estado
          </label>
          <select
            id="files-status"
            className="mdr-input"
            value={query.status}
            onChange={(event) => update({ status: event.target.value === 'ACTIVE' || event.target.value === 'COMPLETE' ? event.target.value : '' })}
          >
            <option value="">Todos</option>
            <option value="ACTIVE">En curso</option>
            <option value="COMPLETE">Completados</option>
          </select>
        </div>
        <div>
          <label htmlFor="files-sort" className="mb-1 block text-sm font-medium">
            Orden
          </label>
          <select
            id="files-sort"
            className="mdr-input"
            value={query.sort}
            onChange={(event) => update({ sort: event.target.value as FileSort })}
          >
            <option value="updatedAt,desc">Actualizados recientemente</option>
            <option value="progress,desc">Mayor progreso</option>
            <option value="name,asc">Nombre (A–Z)</option>
          </select>
        </div>
        <div>
          <label htmlFor="files-size" className="mb-1 block text-sm font-medium">
            Por página
          </label>
          <select
            id="files-size"
            className="mdr-input"
            value={query.size}
            onChange={(event) => update({ size: Number(event.target.value) as FileSize })}
          >
            {FILE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </form>

      {/* Alto mínimo fijo: loading, error y "sin resultados" no mueven el layout. */}
      <div
        className="relative overflow-x-auto rounded-lg border border-[var(--mdr-line)] bg-[var(--mdr-panel)]"
        style={{ minHeight: `${(query.size + 1) * ROW_HEIGHT_REM}rem` }}
        aria-busy={loading}
      >
        {error ? (
          <div className="p-4">
            <ErrorBox message={error} onRetry={() => setRetryTick((n) => n + 1)} />
          </div>
        ) : !data ? (
          <p className="p-6 text-[var(--mdr-muted)]">Cargando archivos…</p>
        ) : data.content.length === 0 && !showingStale ? (
          <div className="p-6">
            <p className="font-medium">Sin resultados</p>
            <p className="text-sm text-[var(--mdr-muted)]">Ningún archivo coincide con estos filtros.</p>
          </div>
        ) : (
          <table className={`w-full min-w-[720px] text-left text-sm ${showingStale ? 'opacity-50' : ''}`}>
            <caption className="sr-only">Archivos de datos</caption>
            <thead className="border-b border-[var(--mdr-line)] text-[var(--mdr-muted)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Archivo</th>
                <th scope="col" className="px-4 py-3 font-medium">Tamaño</th>
                <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                <th scope="col" className="px-4 py-3 font-medium">Progreso</th>
                <th scope="col" className="px-4 py-3 font-medium">Grupos</th>
                <th scope="col" className="px-4 py-3 font-medium">Errores</th>
              </tr>
            </thead>
            <tbody>
              {data.content.map((file) => (
                <tr key={file.id} className="border-b border-[var(--mdr-line)] last:border-0" style={{ height: `${ROW_HEIGHT_REM}rem` }}>
                  <td className="px-4">
                    <Link to={`/files/${file.id}/refine`} className="mdr-link font-medium">
                      {file.name}
                    </Link>
                  </td>
                  <td className="px-4 font-mono tabular-nums">
                    {file.rows} × {file.cols}
                  </td>
                  <td className="px-4">
                    <span className={file.status === 'COMPLETE' ? 'mdr-chip mdr-chip-ok' : 'mdr-chip'}>
                      {file.status === 'COMPLETE' ? 'Completo' : 'En curso'}
                    </span>
                  </td>
                  <td className="px-4">
                    <div className="flex items-center gap-2">
                      <div className="mdr-bar w-28" aria-hidden="true">
                        <span style={{ width: percent(file.progress.overall) }} />
                      </div>
                      <span className="tabular-nums">{percent(file.progress.overall)}</span>
                    </div>
                  </td>
                  <td className="px-4 tabular-nums">
                    {file.refinedGroups} / {file.totalGroups}
                  </td>
                  <td className="px-4 tabular-nums">{file.mistakes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loading && data && (
          <p className="absolute top-2 right-3 text-xs text-[var(--mdr-muted)]" aria-live="polite">
            Actualizando…
          </p>
        )}
      </div>

      <nav className="flex items-center justify-between gap-3" aria-label="Paginación">
        <button type="button" className="mdr-btn-ghost" disabled={query.page === 0} onClick={() => goToPage(query.page - 1)}>
          ← Anterior
        </button>
        <p className="text-sm text-[var(--mdr-muted)] tabular-nums">
          Página {totalPages === 0 ? 0 : query.page + 1} de {totalPages}
        </p>
        <button
          type="button"
          className="mdr-btn-ghost"
          disabled={query.page + 1 >= totalPages}
          onClick={() => goToPage(query.page + 1)}
        >
          Siguiente →
        </button>
      </nav>
    </div>
  );
}

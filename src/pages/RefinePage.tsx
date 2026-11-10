import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api, apiRaw } from '../api/client';
import {
  ApiError,
  detailHolder,
  detailNumber,
  detailString,
  detailTiles,
  errorMessage,
  isAbortError,
} from '../api/errors';
import type { RawResponse } from '../api/http';
import { BIN_CODES, type BinCode, type CellRef, type DataFile, type RefineResult, type Rules, type Tile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Spinner } from '../components/Screens';
import { backoffDelay, newIdempotencyKey, sleep } from '../lib/async';
import { BinsPanel } from '../refine/BinsPanel';
import { findGroup, isScary, tilesOfCells, type GroupInfo } from '../refine/groups';
import { TileStore } from '../refine/tiles';
import { useGroupDrag } from '../refine/useGroupDrag';
import { VirtualGrid } from '../refine/VirtualGrid';
import { record, useLumonEvent } from '../realtime/events';
import { useFloor } from '../realtime/useFloor';
import ForbiddenPage from './ForbiddenPage';

// ----------------------------------------------------------------------------------------------
// Carga del archivo y sus reglas
// ----------------------------------------------------------------------------------------------

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; file: DataFile; rules: Rules };

export default function RefinePage() {
  const { id } = useParams();
  const fileId = /^\d{1,9}$/.test(id ?? '') ? Number(id) : 0;
  if (fileId < 1) return <MissingFile />;
  return <RefineLoader key={fileId} fileId={fileId} />;
}

function MissingFile() {
  return (
    <section className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold">Archivo no encontrado</h1>
      <p className="mt-2 text-[var(--mdr-muted)]">No existe o no pertenece a tu workspace.</p>
      <Link to="/files" className="mdr-btn mt-6 inline-block">
        Ver archivos
      </Link>
    </section>
  );
}

function RefineLoader({ fileId }: { fileId: number }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setState({ status: 'loading' });
    Promise.all([
      api<DataFile>(`/files/${fileId}`, { signal, retries: 3 }),
      // Las reglas cambian por archivo y por workspace: siempre se leen del servidor.
      api<Rules>(`/files/${fileId}/rules`, { signal, retries: 3 }),
    ])
      .then(([file, rules]) => {
        if (!signal.aborted) setState({ status: 'ready', file, rules });
      })
      .catch((error: unknown) => {
        if (!signal.aborted && !isAbortError(error)) setState({ status: 'error', error });
      });
    return () => controller.abort();
  }, [fileId, attempt]);

  if (state.status === 'loading') return <Spinner label="Abriendo el archivo…" />;
  if (state.status === 'error') {
    if (state.error instanceof ApiError && state.error.status === 404) return <MissingFile />;
    if (state.error instanceof ApiError && state.error.status === 403) return <ForbiddenPage permission="files:read" />;
    return <ErrorBox message={errorMessage(state.error)} onRetry={() => setAttempt((n) => n + 1)} />;
  }
  return <RefineWorkspace initialFile={state.file} rules={state.rules} />;
}

// ----------------------------------------------------------------------------------------------
// Espacio de trabajo
// ----------------------------------------------------------------------------------------------

type Selection =
  | { state: 'loading'; origin: CellRef }
  | { state: 'ready'; group: GroupInfo }
  | { state: 'error'; message: string };

type Feedback =
  | { kind: 'idle' }
  | { kind: 'sending'; bin: BinCode; attempt: number }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string; retryBin: BinCode | null };

const MAX_REFINE_RETRIES = 6;

function parsePosition(params: URLSearchParams, rows: number, cols: number): CellRef {
  const read = (name: string, max: number) => {
    const raw = params.get(name) ?? '';
    return /^\d{1,6}$/.test(raw) ? Math.min(Number(raw), max - 1) : 0;
  };
  return { r: read('r', rows), c: read('c', cols) };
}

/**
 * POST /files/{id}/refinements con la MISMA Idempotency-Key en cada reintento (503, corte de red):
 * si el servidor ya lo había guardado, responde la repetición guardada (Idempotent-Replayed: true).
 */
async function sendRefinement(
  fileId: number,
  key: string,
  body: { bin: BinCode; cells: CellRef[] },
  onRetry: (attempt: number) => void,
  isMounted: () => boolean,
): Promise<RawResponse<RefineResult>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await apiRaw<RefineResult>(`/files/${fileId}/refinements`, {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': key },
      });
    } catch (error) {
      const retryable = error instanceof ApiError && (error.status === 0 || error.status >= 500);
      if (!retryable || attempt >= MAX_REFINE_RETRIES || !isMounted()) throw error;
      onRetry(attempt + 1);
      await sleep(Math.max(error.retryAfterMs ?? 0, backoffDelay(attempt, 700, 8000)));
    }
  }
}

function RefineWorkspace({ initialFile, rules }: { initialFile: DataFile; rules: Rules }) {
  const { can } = useAuth();
  const canRefine = can('files:refine');
  const [file, setFile] = useState(initialFile);
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialCell] = useState(() => parsePosition(searchParams, initialFile.rows, initialFile.cols));
  const [active, setActive] = useState<CellRef>(initialCell);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' });
  const [showGridAnyway, setShowGridAnyway] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { status: floorStatus, message: floorMessage, members, claims, claimMessage, select: selectOnFloor, cursor } =
    useFloor(file.id, file.status !== 'COMPLETE' || showGridAnyway);
  const reloadFile = useRef<AbortController | null>(null);

  const [store] = useState(
    () =>
      new TileStore({
        rows: initialFile.rows,
        cols: initialFile.cols,
        tileSize: initialFile.tileSize,
        fetchTile: (tileRow, tileCol, signal) =>
          api<Tile>(`/files/${initialFile.id}/tiles/${tileRow}/${tileCol}`, { signal }),
      }),
  );

  const selectionRef = useRef<Selection | null>(null);
  const selectAbort = useRef<AbortController | null>(null);
  const intentRef = useRef<{ key: string; signature: string } | null>(null);
  const sendingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    mounted.current = true;
    store.resume();
    return () => {
      mounted.current = false;
      selectAbort.current?.abort();
      reloadFile.current?.abort();
      store.suspend();
    };
  }, [store]);

  // La URL indica la posición (?r=&c=). replace: el scroll y el teclado no llenan el historial.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('r', String(active.r));
          next.set('c', String(active.c));
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [active.r, active.c, setSearchParams]);

  // Contadores de bloques y cuenta regresiva visible mientras se espera un Retry-After.
  useSyncExternalStore(store.subscribe, store.getVersion);
  const paused = store.pausedUntil > now;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ---- selección de grupo ----
  const clearSelection = useCallback(() => {
    selectAbort.current?.abort();
    setSelection(null);
  }, []);

  const selectAt = useCallback(
    (cell: CellRef) => {
      selectAbort.current?.abort();
      const info = store.cell(cell.r, cell.c);
      if (info && !isScary(info.tremor, rules)) {
        setSelection(null);
        return;
      }
      const controller = new AbortController();
      selectAbort.current = controller;
      setSelection({ state: 'loading', origin: cell });
      findGroup(store, rules, cell, controller.signal)
        .then((group) => {
          if (controller.signal.aborted) return;
          setSelection(group ? { state: 'ready', group } : null);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return;
          setSelection({
            state: 'error',
            message: `No se pudo cargar una parte del grupo: ${error instanceof Error ? error.message : 'error'}`,
          });
        });
    },
    [store, rules],
  );

  // Los cambios de otros refinadores se aplican a la caché; un reset recupera la foto por HTTP.
  useLumonEvent(({ kind, data }) => {
    if (kind !== 'stream.reset' && data.fileId !== file.id) return;
    if (kind === 'stream.reset') {
      store.invalidateAll();
      if (!sendingRef.current) clearSelection();
    } else if (kind === 'refinement.created') {
      const bin = BIN_CODES.find((code) => code === data.bin);
      if (bin && Array.isArray(data.cells)) {
        const cells = data.cells.map(record).flatMap((cell) =>
          typeof cell?.r === 'number' && typeof cell.c === 'number' ? [{ r: cell.r, c: cell.c }] : [],
        );
        store.applyRefinement(cells, bin);
        const selected = selectionRef.current;
        if (!sendingRef.current && selected?.state === 'ready'
            && cells.some(({ r, c }) => selected.group.ids.has(r * store.cols + c))) {
          clearSelection();
        }
      }
    } else if (kind !== 'file.completed') {
      return;
    }
    reloadFile.current?.abort();
    const request = new AbortController();
    reloadFile.current = request;
    void api<DataFile>(`/files/${file.id}`, { signal: request.signal, retries: 3 })
      .then((fresh) => {
        if (!request.signal.aborted) setFile((prev) => fresh.updatedAt >= prev.updatedAt ? fresh : prev);
      })
      .catch(() => { /* El próximo evento volverá a pedir el estado del archivo. */ });
  });

  useEffect(() => { cursor(active); }, [active, cursor]);

  // ---- refinar ----
  const refine = useCallback(
    async (bin: BinCode) => {
      // Doble clic, doble Enter o doble tecla: mientras hay un envío en vuelo, se ignora.
      if (sendingRef.current) return;
      const current = selectionRef.current;
      if (!canRefine || current?.state !== 'ready') return;
      const group = current.group;
      if (group.noise || group.refinedBin || group.partiallyRefined) return;

      const ids = Array.from(group.ids).sort((a, b) => a - b);
      const signature = `${bin}|${ids.join(',')}`;
      // Una Idempotency-Key por INTENCIÓN (este grupo → esta caja). Reintentar la misma intención la reutiliza.
      if (intentRef.current?.signature !== signature) intentRef.current = { key: newIdempotencyKey(), signature };
      const { key } = intentRef.current;

      sendingRef.current = true;
      setFeedback({ kind: 'sending', bin, attempt: 0 });
      try {
        const response = await sendRefinement(
          file.id,
          key,
          { bin, cells: group.cells },
          (attempt) => {
            if (mounted.current) setFeedback({ kind: 'sending', bin, attempt });
          },
          () => mounted.current,
        );
        if (!mounted.current) return;
        const result = response.data;
        store.applyRefinement(group.cells, bin); // se marcan las celdas sin volver a pedir la grilla
        setFile((prev) => ({ ...prev, ...result.file })); // progreso que devuelve el servidor
        setSelection(null);
        intentRef.current = null;
        const replayed = response.headers.get('Idempotent-Replayed') === 'true';
        setFeedback({
          kind: 'success',
          message: `Grupo de ${result.size} celdas llevado a ${result.bin}.${
            replayed ? ' Confirmado tras un reintento: no se refinó dos veces.' : ''
          }`,
        });
      } catch (error) {
        if (!mounted.current) return;
        handleRefineError(error, bin, group);
      } finally {
        sendingRef.current = false;
      }
    },
    [canRefine, file.id, store],
  );

  function handleRefineError(error: unknown, bin: BinCode, group: GroupInfo) {
    if (!(error instanceof ApiError)) {
      setFeedback({ kind: 'error', message: errorMessage(error), retryBin: bin });
      return;
    }
    switch (error.code) {
      case 'WRONG_BIN': {
        const mistakes = detailNumber(error, 'mistakes');
        if (mistakes !== null) setFile((prev) => ({ ...prev, mistakes }));
        setFeedback({
          kind: 'error',
          message: `Ese grupo no va en ${bin}. Lumon anotó el error (errores del archivo: ${mistakes ?? '—'}). Prueba otra caja.`,
          retryBin: null,
        });
        return;
      }
      case 'GROUP_INVALID': {
        const reason = detailString(error, 'reason');
        const missing = detailNumber(error, 'missing');
        const messages: Record<string, string> = {
          BELOW_THRESHOLD: 'Alguna celda ya no da miedo.',
          NOT_CONNECTED: 'Las celdas no forman un solo grupo conectado.',
          INCOMPLETE: `Faltan ${missing ?? 'algunas'} celdas del grupo.`,
          SIZE_OUT_OF_RANGE: 'Ese grupo es ruido: su tamaño está fuera del rango permitido.',
        };
        // Los datos locales pueden estar viejos: se vuelven a pedir los bloques del grupo.
        store.invalidate(tilesOfCells(group.cells, store.tileSize));
        setSelection(null);
        intentRef.current = null;
        setFeedback({
          kind: 'error',
          message: `${messages[reason ?? ''] ?? 'El grupo no es válido.'} Actualizamos los bloques: vuelve a seleccionarlo.`,
          retryBin: null,
        });
        return;
      }
      case 'ALREADY_REFINED':
        store.invalidate(detailTiles(error));
        setSelection(null);
        intentRef.current = null;
        setFeedback({
          kind: 'error',
          message: 'Parte de ese grupo ya estaba refinada (quizá desde otra pestaña). Actualizamos los bloques afectados.',
          retryBin: null,
        });
        return;
      case 'GROUP_CLAIMED':
        setFeedback({
          kind: 'error',
          message: `${detailHolder(error) ?? 'Otro refinador'} tiene reservado ese grupo. Espera a que lo libere y reintenta.`,
          retryBin: bin,
        });
        return;
      case 'FORBIDDEN':
        setFeedback({ kind: 'error', message: 'Tu rol no tiene permiso para refinar.', retryBin: null });
        return;
      case 'IDEMPOTENCY_KEY_REUSED':
        intentRef.current = null;
        setFeedback({ kind: 'error', message: 'Vuelve a intentarlo.', retryBin: bin });
        return;
      default:
        setFeedback({
          kind: 'error',
          message: `${errorMessage(error)} Reintentar es seguro: se usa la misma clave y nunca se refina dos veces.`,
          retryBin: error.status === 0 || error.status >= 500 ? bin : null,
        });
    }
  }

  const onBinKey = useCallback((index: number) => void refine(BIN_CODES[index]), [refine]);

  const group = selection?.state === 'ready' ? selection.group : null;
  useEffect(() => {
    const eligible = canRefine && group && !group.noise && !group.refinedBin && !group.partiallyRefined;
    selectOnFloor(eligible ? group.cells[0] : null);
  }, [canRefine, group, selectOnFloor]);

  const canSend =
    canRefine && group !== null && !group.noise && !group.refinedBin && !group.partiallyRefined && feedback.kind !== 'sending';
  const { drag, start: startDrag } = useGroupDrag((bin) => void refine(bin), canSend);
  const sendingBin = feedback.kind === 'sending' ? feedback.bin : null;
  const retryBin = feedback.kind === 'error' ? feedback.retryBin : null;

  // ---- archivo completado ----
  const complete = file.status === 'COMPLETE';
  if (complete && !showGridAnyway) {
    return (
      <section className="mx-auto max-w-xl space-y-4 py-12 text-center" aria-labelledby="done-title">
        <p className="font-mono text-xs tracking-[0.3em] text-[var(--mdr-muted)] uppercase">Archivo completado</p>
        <h1 id="done-title" className="text-3xl font-semibold">
          {file.name}: 100 %
        </h1>
        <p className="text-[var(--mdr-muted)]">
          {file.refinedGroups} de {file.totalGroups} grupos refinados · {file.mistakes} errores de refinamiento.
        </p>
        <div className="flex justify-center gap-3">
          <Link to="/files" className="mdr-btn">
            Volver a los archivos
          </Link>
          <button type="button" className="mdr-btn-ghost" onClick={() => setShowGridAnyway(true)}>
            Ver la grilla
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/files" className="mdr-link text-sm">
            ← Archivos
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{file.name}</h1>
          <p className="text-sm text-[var(--mdr-muted)] tabular-nums">
            {file.rows} × {file.cols} · {file.refinedGroups}/{file.totalGroups} grupos · {file.mistakes} errores ·{' '}
            {Math.round(file.progress.overall * 100)} % total
          </p>
        </div>
        <p className="text-xs text-[var(--mdr-muted)] tabular-nums">
          Umbral {rules.tremorThreshold} · conectividad {rules.connectivity} · grupos de {rules.minGroupSize} a{' '}
          {rules.maxGroupSize} · {rules.binning.strategy === 'DIGIT_SUM_MOD' ? 'suma de dígitos' : 'dígito máximo'} % 4 →{' '}
          {rules.binning.order.join(', ')}
        </p>
      </header>

      {!canRefine && (
        <p className="rounded-md border border-[var(--mdr-line)] p-3 text-sm text-[var(--mdr-muted)]">
          Modo lectura: tu rol no tiene el permiso <code className="font-mono">files:refine</code>.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-2">
          <p id="grid-help" className="text-xs text-[var(--mdr-muted)]">
            Flechas, RePág/AvPág, Inicio/Fin para moverte. Enter elige el grupo. Arrástralo a una caja o pulsa 1–4. Esc
            lo suelta.
          </p>
          <div className="space-y-1 text-xs text-[var(--mdr-muted)]">
            <p role="status">
              {floorStatus === 'connected' ? 'Piso compartido conectado.' : floorMessage || 'Conectando al piso compartido…'}
            </p>
            {members.length > 0 && <p>En el archivo: {members.map((member) => member.displayName).join(', ')}</p>}
            {claimMessage && <p role="status">{claimMessage}</p>}
          </div>
          <VirtualGrid
            store={store}
            rules={rules}
            label={`Grilla del archivo ${file.name}`}
            describedBy="grid-help"
            active={active}
            initialCenter={initialCell}
            selection={group?.ids ?? null}
            floorMembers={members}
            floorClaims={claims}
            onCursor={cursor}
            onActiveChange={setActive}
            onActivateCell={selectAt}
            onClearSelection={clearSelection}
            onBinKey={onBinKey}
            onSelectedPointerDown={startDrag}
          />
          <p className="flex flex-wrap items-center gap-3 text-xs text-[var(--mdr-muted)] tabular-nums" aria-live="polite">
            <span>
              Celda {active.r}, {active.c}
            </span>
            <span>Bloques pedidos: {store.requested}</span>
            {paused && <span>Esperando Retry-After: {Math.ceil((store.pausedUntil - now) / 1000)} s</span>}
            {store.erroredWanted > 0 && (
              <button type="button" className="mdr-link" onClick={() => store.retryErrors()}>
                Reintentar {store.erroredWanted} bloque(s) con error
              </button>
            )}
          </p>
        </div>

        <aside className="space-y-4" aria-label="Grupo y cajas">
          <section className="mdr-panel space-y-2" aria-live="polite">
            <h2 className="text-sm font-semibold">Grupo seleccionado</h2>
            {!selection && <p className="text-sm text-[var(--mdr-muted)]">Elige una celda que tiemble.</p>}
            {selection?.state === 'loading' && <Spinner label="Buscando el grupo completo…" />}
            {selection?.state === 'error' && <p className="text-sm text-[var(--mdr-danger)]">{selection.message}</p>}
            {group && (
              <>
                <p className="text-sm">
                  {group.truncated ? `Más de ${rules.maxGroupSize}` : group.size} celdas
                </p>
                {group.refinedBin ? (
                  <p className="text-sm">Ya está en la caja {group.refinedBin}.</p>
                ) : group.partiallyRefined ? (
                  <p className="text-sm">Parte del grupo ya está refinada.</p>
                ) : group.noise ? (
                  <p className="text-sm text-[var(--mdr-warn)]">
                    Es ruido (debe tener entre {rules.minGroupSize} y {rules.maxGroupSize} celdas): no se puede refinar.
                  </p>
                ) : (
                  <>
                    <p className="text-sm">
                      Caja según las reglas: <strong className="font-mono">{group.bin}</strong>
                    </p>
                    <button
                      type="button"
                      className="mdr-drag-handle"
                      disabled={!canSend}
                      onPointerDown={startDrag}
                      aria-label="Arrastrar el grupo hacia una caja"
                    >
                      ⠿ Arrastrar grupo
                    </button>
                  </>
                )}
              </>
            )}
          </section>

          <BinsPanel
            progress={file.progress}
            suggestedBin={group?.bin ?? null}
            overBin={drag?.overBin ?? null}
            canSend={canSend}
            sendingBin={sendingBin}
            onSend={(bin) => void refine(bin)}
          />

          <div aria-live="polite">
            {feedback.kind === 'sending' && (
              <Spinner
                label={feedback.attempt > 0 ? `Reintentando con la misma clave (intento ${feedback.attempt})…` : `Enviando a ${feedback.bin}…`}
              />
            )}
            {feedback.kind === 'success' && <p className="text-sm text-[var(--mdr-ok)]">{feedback.message}</p>}
            {feedback.kind === 'error' && (
              <ErrorBox message={feedback.message} onRetry={retryBin && group ? () => void refine(retryBin) : undefined} />
            )}
          </div>
        </aside>
      </div>

      {drag && group && (
        <div className="mdr-ghost" style={{ left: drag.x + 14, top: drag.y + 14 }} aria-hidden="true">
          Grupo · {group.size} celdas{drag.overBin ? ` → ${drag.overBin}` : ''}
        </div>
      )}
    </div>
  );
}

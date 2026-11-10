import { ApiError, abortError, errorMessage, isAbortError } from '../api/errors';
import type { BinCode, CellRef, Tile } from '../api/types';
import { backoffDelay } from '../lib/async';

/** Bloque ya decodificado: un byte por celda, en el mismo orden (por filas) que la API. */
export interface DecodedTile {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  digits: Uint8Array;
  tremor: Uint8Array;
  bins: Uint8Array;
  version: number;
}

export interface CellInfo {
  digit: number;
  tremor: number;
  bin: BinCode | null;
}

export type TileStatus = 'idle' | 'queued' | 'loading' | 'ready' | 'error';

const BIN_BY_CHAR_CODE = new Map<number, BinCode>([
  ['W'.charCodeAt(0), 'WO'],
  ['F'.charCodeAt(0), 'FC'],
  ['D'.charCodeAt(0), 'DR'],
  ['M'.charCodeAt(0), 'MA'],
]);

export const CHAR_BY_BIN: Record<BinCode, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' };

/** `values`: un dígito por celda · `tremor`: base64, un byte (0–100) por celda · `bins`: `.WFDM`. */
export function decodeTile(tile: Tile): DecodedTile {
  const size = tile.rows * tile.cols;
  const tremorRaw = atob(tile.tremor);
  if (tile.values.length !== size || tile.bins.length !== size || tremorRaw.length !== size) {
    throw new Error(`El bloque (${tile.tileRow}, ${tile.tileCol}) llegó con un tamaño inesperado.`);
  }
  const digits = new Uint8Array(size);
  const tremor = new Uint8Array(size);
  const bins = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    digits[i] = tile.values.charCodeAt(i) - 48;
    tremor[i] = tremorRaw.charCodeAt(i);
    bins[i] = tile.bins.charCodeAt(i);
  }
  return {
    tileRow: tile.tileRow,
    tileCol: tile.tileCol,
    originRow: tile.originRow,
    originCol: tile.originCol,
    rows: tile.rows,
    cols: tile.cols,
    digits,
    tremor,
    bins,
    version: tile.version,
  };
}

/** Máximo de requests de bloques en vuelo a la vez. */
const MAX_IN_FLIGHT = 4;
/** El servidor permite 40 bloques cada 10 s por sesión: el cliente se limita antes, con margen. */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 34;
/** Un bloque que solo "pasa" por la vista durante un scroll rápido no llega a pedirse. */
const SETTLE_MS = 120;
/** Reintentos automáticos de un bloque ante 503 / corte de red (con espera creciente). */
const MAX_RETRIES = 5;

interface QueueItem {
  key: string;
  readyAt: number;
  pinned: boolean;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

type FetchTile = (tileRow: number, tileCol: number, signal: AbortSignal) => Promise<Tile>;

function isRetryableStatus(status: number): boolean {
  return status === 0 || status >= 500;
}

/**
 * Caché y planificador de bloques de un archivo.
 * - Solo se piden los bloques que la vista necesita (`setWanted`) o que la búsqueda de un grupo fija (`load`).
 * - Nunca hay dos requests en vuelo para el mismo bloque.
 * - Los bloques que salen de la vista antes de responder se cancelan (AbortController).
 * - 429: nadie pide bloques hasta que pase `Retry-After`. 503: reintento con espera creciente.
 * - Una versión vieja de un bloque nunca pisa a una más nueva.
 */
export class TileStore {
  readonly rows: number;
  readonly cols: number;
  readonly tileSize: number;
  readonly tileRows: number;
  readonly tileCols: number;

  private readonly fetchTile: FetchTile;
  private readonly tiles = new Map<string, DecodedTile>();
  private readonly errors = new Map<string, string>();
  private readonly stale = new Set<string>();
  private readonly inflight = new Map<string, AbortController>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly attempts = new Map<string, number>();
  private readonly pins = new Map<string, number>();
  private readonly waiters = new Map<string, Waiter[]>();
  /** Celdas refinadas por esta pestaña (confirmadas por el servidor): se pintan sin volver a pedir el bloque. */
  private readonly localBins = new Map<number, number>();
  private readonly listeners = new Set<() => void>();
  private queue: QueueItem[] = [];
  private wanted = new Set<string>();
  private sentAt: number[] = [];
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;
  private active = true;

  /** Fin de la espera por `429` (ms desde epoch). */
  pausedUntil = 0;
  /** Bloques pedidos al servidor (para mostrarlo en la interfaz). */
  requested = 0;

  constructor(options: { rows: number; cols: number; tileSize: number; fetchTile: FetchTile }) {
    this.rows = options.rows;
    this.cols = options.cols;
    this.tileSize = options.tileSize;
    this.tileRows = Math.ceil(options.rows / options.tileSize);
    this.tileCols = Math.ceil(options.cols / options.tileSize);
    this.fetchTile = options.fetchTile;
  }

  static key(tileRow: number, tileCol: number): string {
    return `${tileRow}:${tileCol}`;
  }

  private static parse(key: string): [number, number] {
    const [row, col] = key.split(':');
    return [Number(row), Number(col)];
  }

  // ---- suscripción (useSyncExternalStore) ----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  // ---- lectura ----
  tileOf(cell: CellRef): [number, number] {
    return [Math.floor(cell.r / this.tileSize), Math.floor(cell.c / this.tileSize)];
  }

  tileStatus(tileRow: number, tileCol: number): TileStatus {
    const key = TileStore.key(tileRow, tileCol);
    if (this.tiles.has(key)) return 'ready';
    if (this.inflight.has(key)) return 'loading';
    if (this.errors.has(key)) return 'error';
    if (this.retryTimers.has(key) || this.queue.some((item) => item.key === key)) return 'queued';
    return 'idle';
  }

  getTile(tileRow: number, tileCol: number): DecodedTile | undefined {
    return this.tiles.get(TileStore.key(tileRow, tileCol));
  }

  /** Datos de una celda (coordenadas globales) o null si su bloque no está en caché. */
  cell(r: number, c: number): CellInfo | null {
    const tile = this.tiles.get(TileStore.key(Math.floor(r / this.tileSize), Math.floor(c / this.tileSize)));
    if (!tile) return null;
    return this.cellInTile(tile, r, c);
  }

  cellInTile(tile: DecodedTile, r: number, c: number): CellInfo {
    const index = (r - tile.originRow) * tile.cols + (c - tile.originCol);
    const code = this.localBins.get(r * this.cols + c) ?? tile.bins[index];
    return { digit: tile.digits[index], tremor: tile.tremor[index], bin: BIN_BY_CHAR_CODE.get(code) ?? null };
  }

  get erroredWanted(): number {
    let count = 0;
    for (const key of this.wanted) if (this.errors.has(key)) count += 1;
    return count;
  }

  // ---- qué se necesita ----
  private isPinned(key: string): boolean {
    return (this.pins.get(key) ?? 0) > 0;
  }

  private needsFetch(key: string): boolean {
    return !this.errors.has(key) && (!this.tiles.has(key) || this.stale.has(key));
  }

  private enqueue(key: string, readyAt: number, pinned: boolean): void {
    if (!this.needsFetch(key) || this.inflight.has(key) || this.retryTimers.has(key)) return;
    const existing = this.queue.find((item) => item.key === key);
    if (existing) {
      if (pinned) {
        existing.pinned = true;
        existing.readyAt = Math.min(existing.readyAt, readyAt);
      }
      return;
    }
    this.queue.push({ key, readyAt, pinned });
  }

  /** Bloques que intersectan la vista. Cancela los que salieron de ella (si no están fijados). */
  setWanted(keys: Iterable<string>): void {
    const next = new Set(keys);
    for (const [key, controller] of this.inflight) {
      if (!next.has(key) && !this.isPinned(key)) {
        controller.abort();
        this.inflight.delete(key);
      }
    }
    const now = Date.now();
    for (const key of next) if (!this.wanted.has(key)) this.enqueue(key, now + SETTLE_MS, false);
    this.wanted = next;
    this.pump();
    this.bump();
  }

  /** Pide un bloque fuera de la vista (búsqueda de un grupo que cruza bloques). El scroll no lo cancela. */
  load(tileRow: number, tileCol: number): Promise<void> {
    const key = TileStore.key(tileRow, tileCol);
    if (this.tiles.has(key) && !this.stale.has(key)) return Promise.resolve();
    if (!this.active) return Promise.reject(abortError());
    this.errors.delete(key);
    this.attempts.delete(key);
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
    const promise = new Promise<void>((resolve, reject) => {
      const list = this.waiters.get(key) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(key, list);
    });
    const unpin = () => {
      const left = (this.pins.get(key) ?? 1) - 1;
      if (left <= 0) this.pins.delete(key);
      else this.pins.set(key, left);
    };
    promise.then(unpin, unpin);
    this.enqueue(key, Date.now(), true);
    this.pump();
    this.bump();
    return promise;
  }

  /** Tras un 409 ALREADY_REFINED: los bloques afectados se vuelven a pedir. */
  invalidate(tiles: Array<[number, number]>): void {
    for (const [tileRow, tileCol] of tiles) {
      if (tileRow < 0 || tileCol < 0 || tileRow >= this.tileRows || tileCol >= this.tileCols) continue;
      const key = TileStore.key(tileRow, tileCol);
      if (this.wanted.has(key)) {
        this.stale.add(key);
        this.enqueue(key, Date.now(), false);
      } else {
        this.tiles.delete(key);
      }
    }
    this.pump();
    this.bump();
  }

  /** Reintento manual de los bloques visibles que fallaron. */
  retryErrors(): void {
    const now = Date.now();
    for (const key of this.wanted) {
      if (!this.errors.has(key)) continue;
      this.errors.delete(key);
      this.attempts.delete(key);
      this.enqueue(key, now, false);
    }
    this.pump();
    this.bump();
  }

  /** Marca las celdas con su caja tras un refinamiento exitoso, sin volver a pedir la grilla. */
  applyRefinement(cells: CellRef[], bin: BinCode): void {
    const code = CHAR_BY_BIN[bin].charCodeAt(0);
    for (const cell of cells) this.localBins.set(cell.r * this.cols + cell.c, code);
    this.bump();
  }

  // ---- ciclo de vida (StrictMode monta, desmonta y vuelve a montar) ----
  resume(): void {
    this.active = true;
    const now = Date.now();
    for (const key of this.wanted) this.enqueue(key, now, false);
    this.pump();
  }

  suspend(): void {
    this.active = false;
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    this.queue = [];
    for (const key of Array.from(this.waiters.keys())) this.settle(key, abortError());
  }

  // ---- planificador ----
  private schedulePump(delayMs: number): void {
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.pump();
    }, Math.max(0, delayMs));
  }

  private pump(): void {
    if (!this.active) return;
    const now = Date.now();
    if (now < this.pausedUntil) {
      this.schedulePump(this.pausedUntil - now);
      return;
    }
    this.sentAt = this.sentAt.filter((time) => now - time < RATE_WINDOW_MS);
    this.queue = this.queue.filter(
      (item) =>
        (item.pinned || this.isPinned(item.key) || this.wanted.has(item.key)) &&
        this.needsFetch(item.key) &&
        !this.inflight.has(item.key),
    );
    while (this.inflight.size < MAX_IN_FLIGHT && this.queue.length > 0) {
      if (this.sentAt.length >= RATE_MAX) {
        this.schedulePump(RATE_WINDOW_MS - (now - this.sentAt[0]) + 20);
        return;
      }
      let index = this.queue.findIndex((item) => item.pinned);
      if (index === -1) index = this.queue.findIndex((item) => item.readyAt <= now);
      if (index === -1) {
        const nextReady = Math.min(...this.queue.map((item) => item.readyAt));
        this.schedulePump(nextReady - now);
        return;
      }
      const [item] = this.queue.splice(index, 1);
      this.start(item.key);
    }
  }

  private start(key: string): void {
    const [tileRow, tileCol] = TileStore.parse(key);
    const controller = new AbortController();
    this.inflight.set(key, controller);
    this.sentAt.push(Date.now());
    this.requested += 1;

    this.fetchTile(tileRow, tileCol, controller.signal)
      .then((tile) => {
        if (this.inflight.get(key) !== controller) return; // cancelada o reemplazada
        this.inflight.delete(key);
        const decoded = decodeTile(tile);
        const previous = this.tiles.get(key);
        if (!previous || decoded.version >= previous.version) this.tiles.set(key, decoded);
        this.stale.delete(key);
        this.errors.delete(key);
        this.attempts.delete(key);
        this.settle(key, null);
      })
      .catch((error: unknown) => {
        if (this.inflight.get(key) === controller) this.inflight.delete(key);
        if (controller.signal.aborted || isAbortError(error)) return; // salió de la vista
        this.handleFailure(key, error);
      })
      .finally(() => {
        this.bump();
        this.pump();
      });
    this.bump();
  }

  private handleFailure(key: string, error: unknown): void {
    if (error instanceof ApiError && error.status === 429) {
      // Respeta Retry-After: ningún bloque se pide hasta que pase la espera.
      this.pausedUntil = Math.max(this.pausedUntil, Date.now() + (error.retryAfterMs ?? 1000));
      this.enqueue(key, 0, this.isPinned(key));
      return;
    }
    const attempt = this.attempts.get(key) ?? 0;
    if (error instanceof ApiError && isRetryableStatus(error.status) && attempt < MAX_RETRIES) {
      this.attempts.set(key, attempt + 1);
      const wait = Math.max(error.retryAfterMs ?? 0, backoffDelay(attempt, 600, 20_000));
      const timer = setTimeout(() => {
        this.retryTimers.delete(key);
        this.enqueue(key, 0, this.isPinned(key));
        this.pump();
        this.bump();
      }, wait);
      this.retryTimers.set(key, timer);
      return;
    }
    const message = error instanceof Error && !(error instanceof ApiError) ? error.message : errorMessage(error);
    this.errors.set(key, message);
    this.settle(key, new Error(message));
  }

  private settle(key: string, error: Error | null): void {
    const list = this.waiters.get(key);
    if (!list) return;
    this.waiters.delete(key);
    for (const waiter of list) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }
}

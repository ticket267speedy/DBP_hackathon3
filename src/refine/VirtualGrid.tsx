import {
  memo,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { CellRef, Rules } from '../api/types';
import { isScary } from './groups';
import { CHAR_BY_BIN, TileStore, type DecodedTile } from './tiles';

export const CELL_PX = 32;
const OVERSCAN = 1;
/** Límite del enunciado: nunca más de 2 500 celdas en el DOM a la vez. */
export const MAX_DOM_CELLS = 2500;

interface Range {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

const EMPTY_RANGE: Range = { r0: 0, r1: 0, c0: 0, c1: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sameRange(a: Range, b: Range): boolean {
  return a.r0 === b.r0 && a.r1 === b.r1 && a.c0 === b.c0 && a.c1 === b.c1;
}

/** Ventana de filas/columnas visibles (+1 de margen). Se recorta si pasara del límite de celdas. */
function computeRange(el: HTMLElement, rows: number, cols: number): Range {
  const r0 = Math.max(0, Math.floor(el.scrollTop / CELL_PX) - OVERSCAN);
  let r1 = Math.min(rows, Math.ceil((el.scrollTop + el.clientHeight) / CELL_PX) + OVERSCAN);
  const c0 = Math.max(0, Math.floor(el.scrollLeft / CELL_PX) - OVERSCAN);
  let c1 = Math.min(cols, Math.ceil((el.scrollLeft + el.clientWidth) / CELL_PX) + OVERSCAN);
  // Se reserva 1 lugar para la celda con foco, que siempre está en el DOM.
  while ((r1 - r0) * (c1 - c0) > MAX_DOM_CELLS - 1) {
    if (r1 - r0 >= c1 - c0) r1 -= 1;
    else c1 -= 1;
  }
  return { r0, r1, c0, c1 };
}

function isCellVisible(el: HTMLElement, cell: CellRef): boolean {
  const top = cell.r * CELL_PX;
  const left = cell.c * CELL_PX;
  return (
    top >= el.scrollTop &&
    top + CELL_PX <= el.scrollTop + el.clientHeight &&
    left >= el.scrollLeft &&
    left + CELL_PX <= el.scrollLeft + el.clientWidth
  );
}

function scrollCellIntoView(el: HTMLElement, cell: CellRef): void {
  const top = cell.r * CELL_PX;
  const left = cell.c * CELL_PX;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + CELL_PX > el.scrollTop + el.clientHeight) el.scrollTop = top + CELL_PX - el.clientHeight;
  if (left < el.scrollLeft) el.scrollLeft = left;
  else if (left + CELL_PX > el.scrollLeft + el.clientWidth) el.scrollLeft = left + CELL_PX - el.clientWidth;
}

/** Intensidad del temblor (1–5) según cuánto pasa el umbral. */
function tremorLevel(tremor: number, threshold: number): number {
  const span = Math.max(1, 100 - threshold);
  return clamp(1 + Math.floor(((tremor - threshold) / span) * 5), 1, 5);
}

interface RowProps {
  r: number;
  c0: number;
  c1: number;
  extraCol: number | null;
  activeCol: number | null;
  store: TileStore;
  rules: Rules;
  version: number;
  selection: ReadonlySet<number> | null;
}

const GridRow = memo(function GridRow({ r, c0, c1, extraCol, activeCol, store, rules, selection }: RowProps) {
  const columns: number[] = [];
  for (let c = c0; c < c1; c += 1) columns.push(c);
  if (extraCol !== null) columns.push(extraCol);

  const tileRow = Math.floor(r / store.tileSize);
  let currentTileCol = -1;
  let tile: DecodedTile | undefined;
  const cells: ReactNode[] = [];

  for (const c of columns) {
    const tileCol = Math.floor(c / store.tileSize);
    if (tileCol !== currentTileCol) {
      currentTileCol = tileCol;
      tile = store.getTile(tileRow, tileCol);
    }
    const isActive = activeCol === c;
    const position = `Fila ${r + 1}, columna ${c + 1}`;

    if (!tile) {
      // Placeholder del mismo tamaño: el layout no salta mientras llega el bloque.
      const failed = store.tileStatus(tileRow, tileCol) === 'error';
      cells.push(
        <div
          key={c}
          role="gridcell"
          aria-colindex={c + 1}
          aria-label={`${position}: ${failed ? 'no se pudo cargar' : 'cargando'}`}
          data-r={r}
          data-c={c}
          tabIndex={isActive ? 0 : -1}
          className={`mdr-cell ${failed ? 'is-error' : 'is-pending'}`}
          style={{ left: c * CELL_PX }}
        >
          {failed ? '!' : ''}
        </div>,
      );
      continue;
    }

    const info = store.cellInTile(tile, r, c);
    const scary = isScary(info.tremor, rules);
    const selected = selection?.has(r * store.cols + c) ?? false;
    const classes = ['mdr-cell'];
    if (info.bin) classes.push(`bin-${CHAR_BY_BIN[info.bin]}`);
    else if (scary) classes.push('is-scary');
    if (selected) classes.push('is-selected');
    const trembles = scary && !info.bin;
    const level = trembles ? tremorLevel(info.tremor, rules.tremorThreshold) : 0;

    cells.push(
      <div
        key={c}
        role="gridcell"
        aria-colindex={c + 1}
        aria-selected={selected}
        aria-label={`${position}: ${info.digit}${trembles ? `, da miedo (temblor ${info.tremor})` : ''}${
          info.bin ? `, en la caja ${info.bin}` : ''
        }`}
        data-r={r}
        data-c={c}
        tabIndex={isActive ? 0 : -1}
        className={classes.join(' ')}
        style={{ left: c * CELL_PX }}
      >
        <span className={trembles ? `mdr-digit tremble t${level}` : 'mdr-digit'} aria-hidden="true">
          {info.digit}
        </span>
      </div>,
    );
  }

  return (
    <div role="row" aria-rowindex={r + 1} className="mdr-row" style={{ top: r * CELL_PX }}>
      {cells}
    </div>
  );
});

export interface VirtualGridProps {
  store: TileStore;
  rules: Rules;
  label: string;
  describedBy?: string;
  active: CellRef;
  initialCenter: CellRef;
  selection: ReadonlySet<number> | null;
  onActiveChange: (cell: CellRef) => void;
  onActivateCell: (cell: CellRef) => void;
  onClearSelection: () => void;
  onBinKey: (index: number) => void;
  onSelectedPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * Grilla virtualizada con elementos del DOM y el patrón ARIA "grid".
 * Solo se renderizan las celdas visibles (+ la celda con foco), posicionadas en absoluto dentro de un
 * lienzo del tamaño total del archivo: el scroll es real en ambos ejes y el layout nunca salta.
 */
export function VirtualGrid(props: VirtualGridProps) {
  const { store, rules, active, selection } = props;
  const { rows, cols } = store;
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<Range>(EMPTY_RANGE);
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const focusPending = useRef(false);
  const latest = useRef({ props, active });

  useLayoutEffect(() => {
    latest.current = { props, active };
  });

  // Medición, scroll inicial (centrado en ?r=&c=) y listeners de scroll/resize.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const center = latest.current.props.initialCenter;
    el.scrollTop = Math.max(0, center.r * CELL_PX - el.clientHeight / 2 + CELL_PX / 2);
    el.scrollLeft = Math.max(0, center.c * CELL_PX - el.clientWidth / 2 + CELL_PX / 2);

    const measure = () => {
      const next = computeRange(el, rows, cols);
      setRange((prev) => (sameRange(prev, next) ? prev : next));
    };
    measure();

    let frame = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const onScrollIdle = () => {
      // Si la celda activa quedó fuera de la vista, la activa pasa a ser la del centro (y la URL la sigue).
      const current = latest.current.active;
      if (isCellVisible(el, current)) return;
      const next = {
        r: clamp(Math.floor((el.scrollTop + el.clientHeight / 2) / CELL_PX), 0, rows - 1),
        c: clamp(Math.floor((el.scrollLeft + el.clientWidth / 2) / CELL_PX), 0, cols - 1),
      };
      if (el.contains(document.activeElement)) focusPending.current = true;
      latest.current.props.onActiveChange(next);
    };
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(onScrollIdle, 160);
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      resizeObserver.disconnect();
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(idleTimer);
    };
  }, [rows, cols]);

  // Bloques que la vista necesita: solo esos se piden.
  useEffect(() => {
    if (range.r1 <= range.r0 || range.c1 <= range.c0) return;
    const size = store.tileSize;
    const keys: string[] = [];
    for (let tileRow = Math.floor(range.r0 / size); tileRow <= Math.floor((range.r1 - 1) / size); tileRow += 1) {
      for (let tileCol = Math.floor(range.c0 / size); tileCol <= Math.floor((range.c1 - 1) / size); tileCol += 1) {
        keys.push(TileStore.key(tileRow, tileCol));
      }
    }
    store.setWanted(keys);
  }, [range, store]);

  // Después de moverse con el teclado, el foco va a la nueva celda (que siempre está en el DOM).
  useLayoutEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-r="${active.r}"][data-c="${active.c}"]`);
    node?.focus({ preventScroll: true });
  }, [active.r, active.c, range]);

  function moveTo(target: CellRef) {
    const el = containerRef.current;
    if (!el) return;
    const next = { r: clamp(target.r, 0, rows - 1), c: clamp(target.c, 0, cols - 1) };
    focusPending.current = true;
    scrollCellIntoView(el, next);
    props.onActiveChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (!el) return;
    const pageRows = Math.max(1, Math.floor(el.clientHeight / CELL_PX) - 1);
    const { r, c } = active;
    const ctrl = event.ctrlKey || event.metaKey;
    switch (event.key) {
      case 'ArrowUp':
        moveTo({ r: r - 1, c });
        break;
      case 'ArrowDown':
        moveTo({ r: r + 1, c });
        break;
      case 'ArrowLeft':
        moveTo({ r, c: c - 1 });
        break;
      case 'ArrowRight':
        moveTo({ r, c: c + 1 });
        break;
      case 'PageUp':
        moveTo({ r: r - pageRows, c });
        break;
      case 'PageDown':
        moveTo({ r: r + pageRows, c });
        break;
      case 'Home':
        moveTo(ctrl ? { r: 0, c: 0 } : { r, c: 0 });
        break;
      case 'End':
        moveTo(ctrl ? { r: rows - 1, c: cols - 1 } : { r, c: cols - 1 });
        break;
      case 'Enter':
      case ' ':
        props.onActivateCell(active);
        break;
      case 'Escape':
        props.onClearSelection();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        props.onBinKey(Number(event.key) - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const node = event.target.closest<HTMLElement>('[data-r]');
    if (!node) return;
    const cell = { r: Number(node.dataset.r), c: Number(node.dataset.c) };
    props.onActiveChange(cell);
    if (selection?.has(cell.r * cols + cell.c)) {
      // Celda del grupo seleccionado: puede empezar un arrastre hacia una caja.
      props.onSelectedPointerDown(event);
      return;
    }
    props.onActivateCell(cell);
  }

  const activeOutsideRows = active.r < range.r0 || active.r >= range.r1;
  const activeOutsideCols = active.c < range.c0 || active.c >= range.c1;
  const rowIndexes: number[] = [];
  for (let r = range.r0; r < range.r1; r += 1) rowIndexes.push(r);
  if (activeOutsideRows) rowIndexes.push(active.r);

  return (
    <div
      ref={containerRef}
      className="mdr-grid"
      role="grid"
      aria-label={props.label}
      aria-describedby={props.describedBy}
      aria-rowcount={rows}
      aria-colcount={cols}
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <div role="rowgroup" className="mdr-grid-canvas" style={{ width: cols * CELL_PX, height: rows * CELL_PX }}>
        {rowIndexes.map((r) => {
          const inRange = r >= range.r0 && r < range.r1;
          const isActiveRow = r === active.r;
          return (
            <GridRow
              key={r}
              r={r}
              c0={inRange ? range.c0 : 0}
              c1={inRange ? range.c1 : 0}
              extraCol={isActiveRow && (!inRange || activeOutsideCols) ? active.c : null}
              activeCol={isActiveRow ? active.c : null}
              store={store}
              rules={rules}
              version={version}
              selection={selection}
            />
          );
        })}
      </div>
    </div>
  );
}

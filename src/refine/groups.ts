import { abortError } from '../api/errors';
import type { BinCode, CellRef, Rules } from '../api/types';
import type { TileStore } from './tiles';

export interface GroupInfo {
  cells: CellRef[];
  /** ids globales (r * cols + c) para pintar la selección rápido. */
  ids: Set<number>;
  size: number;
  /** La búsqueda se detuvo al pasar maxGroupSize: es ruido seguro. */
  truncated: boolean;
  noise: boolean;
  /** Caja que corresponde según las reglas del archivo (null si es ruido). */
  bin: BinCode | null;
  /** El grupo completo ya está en esta caja. */
  refinedBin: BinCode | null;
  partiallyRefined: boolean;
}

const NEIGHBORS_4: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const NEIGHBORS_8: ReadonlyArray<readonly [number, number]> = [
  ...NEIGHBORS_4,
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** Una celda "da miedo" si su temblor alcanza el umbral del archivo. */
export function isScary(tremor: number, rules: Rules): boolean {
  return tremor >= rules.tremorThreshold;
}

/** DIGIT_SUM_MOD: suma de dígitos % 4 · MAX_DIGIT_MOD: dígito máximo % 4 → binning.order[índice]. */
export function binFor(digitSum: number, maxDigit: number, rules: Rules): BinCode {
  const index = (rules.binning.strategy === 'DIGIT_SUM_MOD' ? digitSum : maxDigit) % 4;
  return rules.binning.order[index];
}

/**
 * Componente conexo (BFS) de celdas que dan miedo a partir de `start`, con la conectividad del archivo.
 * Si el grupo cruza bloques que no están en caché, los pide (fijados) y sigue.
 * Se detiene al pasar maxGroupSize: a partir de ahí ya es ruido.
 * Devuelve null si `start` no da miedo.
 */
export async function findGroup(
  store: TileStore,
  rules: Rules,
  start: CellRef,
  signal: AbortSignal,
): Promise<GroupInfo | null> {
  const { rows, cols, tileSize } = store;
  const neighbors = rules.connectivity === 8 ? NEIGHBORS_8 : NEIGHBORS_4;
  const limit = rules.maxGroupSize + 1;
  const startId = start.r * cols + start.c;
  const visited = new Set<number>([startId]);
  const members: number[] = [];
  const binCounts = new Map<BinCode | null, number>();
  let digitSum = 0;
  let maxDigit = 0;
  let truncated = false;
  let frontier: number[] = [startId];

  while (frontier.length > 0 && !truncated) {
    if (signal.aborted) throw abortError();
    const missingTiles = new Map<string, [number, number]>();
    const deferred: number[] = [];
    const next: number[] = [];

    for (const id of frontier) {
      const r = Math.floor(id / cols);
      const c = id % cols;
      const info = store.cell(r, c);
      if (!info) {
        const tileRow = Math.floor(r / tileSize);
        const tileCol = Math.floor(c / tileSize);
        missingTiles.set(`${tileRow}:${tileCol}`, [tileRow, tileCol]);
        deferred.push(id);
        continue;
      }
      if (!isScary(info.tremor, rules)) continue;

      members.push(id);
      digitSum += info.digit;
      if (info.digit > maxDigit) maxDigit = info.digit;
      binCounts.set(info.bin, (binCounts.get(info.bin) ?? 0) + 1);
      if (members.length >= limit) {
        truncated = true;
        break;
      }

      for (const [dr, dc] of neighbors) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nid = nr * cols + nc;
        if (visited.has(nid)) continue;
        visited.add(nid);
        next.push(nid);
      }
    }

    if (truncated) break;
    if (missingTiles.size > 0) {
      await Promise.all(Array.from(missingTiles.values(), ([tileRow, tileCol]) => store.load(tileRow, tileCol)));
      if (signal.aborted) throw abortError();
    }
    frontier = [...deferred, ...next];
  }

  if (members.length === 0) return null;

  const size = members.length;
  const noise = truncated || size < rules.minGroupSize || size > rules.maxGroupSize;
  const refinedKinds = Array.from(binCounts.keys()).filter((bin): bin is BinCode => bin !== null);
  const unrefined = binCounts.get(null) ?? 0;
  const refinedBin = refinedKinds.length === 1 && unrefined === 0 ? refinedKinds[0] : null;

  return {
    cells: members.map((id) => ({ r: Math.floor(id / cols), c: id % cols })),
    ids: new Set(members),
    size,
    truncated,
    noise,
    bin: noise ? null : binFor(digitSum, maxDigit, rules),
    refinedBin,
    partiallyRefined: refinedKinds.length > 0 && refinedBin === null,
  };
}

/** Bloques que tocan las celdas de un grupo. */
export function tilesOfCells(cells: CellRef[], tileSize: number): Array<[number, number]> {
  const seen = new Map<string, [number, number]>();
  for (const cell of cells) {
    const tileRow = Math.floor(cell.r / tileSize);
    const tileCol = Math.floor(cell.c / tileSize);
    seen.set(`${tileRow}:${tileCol}`, [tileRow, tileCol]);
  }
  return Array.from(seen.values());
}

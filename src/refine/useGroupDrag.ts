import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BIN_CODES, type BinCode } from '../api/types';

export interface DragState {
  x: number;
  y: number;
  overBin: BinCode | null;
}

const DRAG_THRESHOLD_PX = 6;

function binAt(x: number, y: number): BinCode | null {
  const node = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-bin]');
  const value = node?.dataset.bin;
  return BIN_CODES.find((bin) => bin === value) ?? null;
}

/**
 * Arrastre del grupo seleccionado hacia una caja con Pointer Events (sin librerías).
 * pointerdown captura el puntero; pasado un umbral de 6 px empieza el arrastre; al soltar sobre
 * un elemento [data-bin] se llama a onDrop. Escape o pointercancel lo cancelan.
 */
export function useGroupDrag(onDrop: (bin: BinCode) => void, enabled: boolean) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      cleanup.current?.();
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // algunos navegadores no permiten capturar; el arrastre igual funciona mientras el puntero esté encima
      }

      const finish = (dropAt: { x: number; y: number } | null) => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
        cleanup.current = null;
        setDrag(null);
        if (dragging && dropAt) {
          const bin = binAt(dropAt.x, dropAt.y);
          if (bin) onDropRef.current(bin);
        }
      };
      const onMove = (move: PointerEvent) => {
        if (!dragging && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        setDrag({ x: move.clientX, y: move.clientY, overBin: binAt(move.clientX, move.clientY) });
      };
      const onUp = (up: PointerEvent) => finish({ x: up.clientX, y: up.clientY });
      const onCancel = () => finish(null);
      const onKey = (key: KeyboardEvent) => {
        if (key.key === 'Escape') finish(null);
      };

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
      cleanup.current = () => finish(null);
    },
    [enabled],
  );

  return { drag, start };
}

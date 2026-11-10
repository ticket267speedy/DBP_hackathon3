import { BIN_CODES, type BinCode, type Progress } from '../api/types';

interface BinsPanelProps {
  progress: Progress;
  suggestedBin: BinCode | null;
  overBin: BinCode | null;
  canSend: boolean;
  sendingBin: BinCode | null;
  onSend: (bin: BinCode) => void;
}

/**
 * Las cuatro cajas. Son a la vez botones (teclado: Tab + Enter, o las teclas 1–4 en la grilla)
 * y zonas donde soltar el grupo arrastrado ([data-bin]). La barra muestra el progreso que devuelve el servidor.
 */
export function BinsPanel({ progress, suggestedBin, overBin, canSend, sendingBin, onSend }: BinsPanelProps) {
  return (
    <ul className="grid grid-cols-2 gap-3" aria-label="Cajas">
      {BIN_CODES.map((bin, index) => {
        const value = Math.round(progress[bin] * 100);
        const classes = ['mdr-bin'];
        if (overBin === bin) classes.push('is-over');
        if (suggestedBin === bin) classes.push('is-suggested');
        return (
          <li key={bin}>
            <button
              type="button"
              data-bin={bin}
              className={classes.join(' ')}
              disabled={!canSend}
              aria-keyshortcuts={String(index + 1)}
              aria-label={`Llevar el grupo a la caja ${bin} (tecla ${index + 1}). Progreso ${value} %`}
              onClick={() => onSend(bin)}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-lg font-semibold">{bin}</span>
                <span className="font-mono text-xs text-[var(--mdr-muted)]">{index + 1}</span>
              </span>
              <span
                className="mdr-bar mt-2"
                role="progressbar"
                aria-label={`Progreso de ${bin}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
              >
                <span style={{ width: `${value}%` }} />
              </span>
              <span className="mt-1 block text-xs tabular-nums text-[var(--mdr-muted)]">
                {sendingBin === bin ? 'Enviando…' : `${value} %`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

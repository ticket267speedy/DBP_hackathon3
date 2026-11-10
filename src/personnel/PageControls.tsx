export function PageControls({ page, total, change }: { page: number; total: number; change: (page: number) => void }) {
  return <nav aria-label="Paginación" className="flex flex-wrap items-center gap-3">
    <button type="button" className="mdr-btn-ghost" disabled={page <= 0} onClick={() => change(page - 1)}>Anterior</button>
    <span>Página {total ? page + 1 : 0} de {total}</span>
    <button type="button" className="mdr-btn-ghost" disabled={page + 1 >= total} onClick={() => change(page + 1)}>Siguiente</button>
  </nav>;
}

export function readPage(value: string | null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}



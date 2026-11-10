import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Spinner } from '../components/Screens';
import { useLumonEvent } from '../realtime/events';
import { useRecord, webUrl, type Department, type Page, type Refiner } from './data';

import { PageControls, readPage } from './PageControls';

export function RefinersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const page = readPage(params.get('page'));
  const size = ['10', '25', '50'].includes(params.get('size') ?? '') ? params.get('size')! : '10';
  const q = (params.get('q') ?? '').slice(0, 60);
  const dept = params.get('departmentId') ?? '';
  const query = new URLSearchParams({ q, size, page: String(page), departmentId: /^[1-9]\d*$/.test(dept) ? dept : '' });
  const result = useRecord<Page<Refiner>>('/refiners', query.toString(), refresh);
  const departments = useRecord<Department[]>('/departments', '', refresh);
  useLumonEvent((event) => {
    if (event.kind === 'refiner.updated' || event.kind === 'stream.reset') setRefresh((value) => value + 1);
  });

  function change(field: string, value: string) {
    const next = new URLSearchParams(query);
    next.set(field, value);
    if (field !== 'page') next.set('page', '0');
    for (const [key, entry] of Array.from(next)) if (!entry) next.delete(key);
    setParams(next, { replace: field === 'q' });
  }

  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">Directorio de refinadores</h1>
    <form role="search" className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => event.preventDefault()}>
      <label>Buscar por nombre, cargo o anexo
        <input className="mdr-input" type="search" maxLength={60} value={q} onChange={(event) => change('q', event.target.value)} />
      </label>
      <label>Departamento
        <select className="mdr-input" value={dept} onChange={(event) => change('departmentId', event.target.value)}>
          <option value="">Todos</option>
          {departments?.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>Resultados por página
        <select className="mdr-input" value={size} onChange={(event) => change('size', event.target.value)}>
          {[10, 25, 50].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
    </form>
    {result?.error ? <ErrorBox message={result.error} onRetry={() => setRefresh(refresh + 1)} /> : !result ? <Spinner label="Cargando expedientes…" /> : null}
    {result?.data && <>
      <p role="status">{result.data.totalElements ? `${result.data.totalElements} expedientes` : 'No hay expedientes para estos filtros.'}</p>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {result.data.content.map((item) => {
          const profile = webUrl(item.profileUrl);
          const badge = webUrl(item.badge?.url ?? null);
          return <li key={item.id} className="mdr-panel min-w-0 space-y-2 wrap-anywhere">
            {badge && <img src={badge} alt={`Fotocheck de ${item.fullName}`} width={64} height={64} className="rounded" loading="lazy" />}
            <h2 className="font-semibold">{item.fullName}</h2>
            <p>{item.title} · {item.department.name} · Anexo {item.extension}</p>
            <p className="text-[var(--mdr-muted)]">{item.bio}</p>
            <div className="flex flex-wrap gap-3">
              {profile && <a className="mdr-link" href={profile} target="_blank" rel="noopener noreferrer">Perfil externo</a>}
              {can('refiners:write') && <Link className="mdr-link" to={`/refiners/${item.id}/edit`} aria-label={`Editar a ${item.fullName}`}>Editar</Link>}
              {can('refiners:write') && can('media:upload') && <Link className="mdr-link" to={`/refiners/${item.id}/badge`} aria-label={`Cambiar fotocheck de ${item.fullName}`}>Cambiar fotocheck</Link>}
            </div>
          </li>;
        })}
      </ul>
      <PageControls page={page} total={result.data.totalPages} change={(value) => change('page', String(value))} />
    </>}
  </div>;
}


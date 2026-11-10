import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Spinner } from '../components/Screens';
import { readPage, PageControls } from '../personnel/PageControls';
import { useRecord, webUrl, type Page } from '../personnel/data';
import { severityLabels, type Incident } from './data';

export function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const [retry, setRetry] = useState(0);
  const { can } = useAuth();
  const page = readPage(params.get('page'));
  const response = useRecord<Page<Incident>>('/incidents', `page=${page}&size=10`, retry);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Incidencias</h1>
      {can('incidents:create') && can('media:upload') && <Link className="mdr-btn" to="/incidents/new">Reportar incidencia</Link>}
    </div>
    {response?.error ? <ErrorBox message={response.error} onRetry={() => setRetry(retry + 1)} /> : !response ? <Spinner label="Cargando incidencias…" /> : null}
    {response?.data && <>
      {response.data.totalElements === 0 && <p role="status">Aún no hay incidencias registradas.</p>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {response.data.content.map((item) => <li className="mdr-panel min-w-0 space-y-3 wrap-anywhere" key={item.id}>
          <h2 className="text-lg font-semibold">{item.title}</h2>
          <p className="text-sm text-[var(--mdr-muted)]">Severidad {severityLabels[item.severity]} · {item.createdBy.displayName} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('es-PE')}</time></p>
          {item.file && <p>Archivo {item.file.name}</p>}
          <p className="whitespace-pre-wrap">{item.description}</p>
          <div className="flex flex-wrap gap-3">
            {item.photos.map((photo, index) => {
              const src = webUrl(photo.url);
              return src && <a href={src} target="_blank" rel="noopener noreferrer" key={photo.mediaId}>
                <img src={src} loading="lazy" className="h-24 w-24 rounded object-cover" width={96} height={96} alt={`Abrir evidencia ${index + 1} de ${item.title}`} />
              </a>;
            })}
          </div>
        </li>)}
      </ul>
      <PageControls page={page} total={response.data.totalPages} change={(value) => setParams({ page: String(value) })} />
    </>}
  </div>;
}


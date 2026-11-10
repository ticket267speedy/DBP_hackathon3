import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { ApiError, fieldErrors, isRecord } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox } from '../components/Screens';
import { prepareIncidentPhoto } from '../media/photo';
import { storageReady, uploadError, uploadPhoto } from '../media/upload';
import { severityLabels, type Incident, type Severity } from './data';

interface PendingPhoto {
  id: string;
  file: File;
  status: 'preparing' | 'uploading' | 'confirming' | 'confirmed' | 'error' | 'cancelled';
  progress?: number;
  mediaId?: number;
  error?: string;
}

const statuses: Record<PendingPhoto['status'], string> = {
  preparing: 'Preparando imagen',
  uploading: 'Subiendo',
  confirming: 'Verificando con Lumon',
  confirmed: 'Foto confirmada',
  error: 'No se pudo subir',
  cancelled: 'Subida cancelada',
};

export function NewIncidentPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState(false);
  const requests = useRef(new Map<string, AbortController>());
  const submitRequest = useRef<AbortController>(null);

  useEffect(() => {
    const pending = requests.current;
    return () => {
      pending.forEach((request) => request.abort());
      pending.clear();
      submitRequest.current?.abort();
    };
  }, []);

  function patch(id: string, changes: Partial<PendingPhoto>) {
    setPhotos((previous) => previous.map((photo) => photo.id === id ? { ...photo, ...changes } : photo));
  }

  async function send(photo: PendingPhoto) {
    if (requests.current.has(photo.id)) return;
    const active = new AbortController();
    requests.current.set(photo.id, active);
    patch(photo.id, { status: 'preparing', progress: 0, mediaId: undefined, error: undefined });
    try {
      const prepared = await prepareIncidentPhoto(photo.file, active.signal);
      active.signal.throwIfAborted();
      patch(photo.id, { status: 'uploading' });
      const saved = await uploadPhoto(prepared, 'INCIDENT', active.signal,
        (progress) => patch(photo.id, { progress }),
        () => patch(photo.id, { status: 'confirming' }),
      );
      patch(photo.id, { status: 'confirmed', mediaId: saved.mediaId });
    } catch (cause) {
      if (active.signal.aborted) patch(photo.id, { status: 'cancelled' });
      else patch(photo.id, { status: 'error', error: uploadError(cause) });
    } finally {
      requests.current.delete(photo.id);
    }
  }

  function choose(files: FileList | null) {
    if (!files?.length) return;
    if (photos.length + files.length > 3) {
      setSelectionError('Puedes adjuntar hasta tres fotos.');
      return;
    }
    setSelectionError('');
    const next = Array.from(files, (file): PendingPhoto => ({ file, id: crypto.randomUUID(), status: 'preparing' }));
    setPhotos((previous) => [...previous, ...next]);
    next.forEach((photo) => void send(photo));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitRequest.current || photos.length === 0 || photos.some((photo) => !photo.mediaId)) return;
    const active = new AbortController();
    submitRequest.current = active;
    const form = new FormData(event.currentTarget);
    setError('');
    setFields({});
    setBusy(true);
    try {
      const fileId = Number(form.get('fileId'));
      await api<Incident>('/incidents', {
        method: 'POST', signal: active.signal,
        body: {
          title: String(form.get('title') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          severity: form.get('severity'),
          fileId: fileId || null,
          mediaIds: photos.map((photo) => photo.mediaId),
        },
      });
      if (can('incidents:read')) navigate('/incidents');
      else setCreated(true);
    } catch (cause) {
      if (active.signal.aborted) return;
      setError(uploadError(cause));
      if (cause instanceof ApiError) {
        setFields(fieldErrors(cause));
        if (cause.code === 'MEDIA_NOT_USABLE' && isRecord(cause.details) && Array.isArray(cause.details.mediaIds)) {
          const rejected = new Set<unknown>(cause.details.mediaIds);
          for (const photo of photos) if (rejected.has(photo.mediaId)) {
            patch(photo.id, { status: 'error', mediaId: undefined, error: 'Vuelve a subir esta foto para obtener una referencia nueva.' });
          }
        }
      }
    } finally {
      submitRequest.current = null;
      setBusy(false);
    }
  }

  const configured = storageReady();
  const allConfirmed = photos.length > 0 && photos.every((photo) => photo.status === 'confirmed');
  return <div className="space-y-4">
    {can('incidents:read') && <Link className="mdr-link" to="/incidents">Volver a incidencias</Link>}
    <h1 className="text-2xl font-semibold">Reportar incidencia</h1>
    {!configured && <ErrorBox message="Configura la URL HTTPS y la clave pública de Supabase para adjuntar fotos." />}
    {created ? <p role="status">Incidencia registrada.</p> : <form className="mdr-panel max-w-2xl space-y-4" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">Título<input name="title" className="mdr-input" required minLength={3} maxLength={120} /></label>
        <label className="block">Descripción<textarea name="description" className="mdr-input" required maxLength={4000} rows={5} /></label>
        <label className="block">Severidad<select name="severity" className="mdr-input" defaultValue="MEDIUM">
          {(Object.keys(severityLabels) as Severity[]).map((severity) => <option key={severity} value={severity}>{severityLabels[severity]}</option>)}
        </select></label>
        <label className="block">ID del archivo relacionado (opcional)<input name="fileId" className="mdr-input" type="number" min={1} step={1} defaultValue={search.get('fileId') ?? ''} /></label>
        <label className="block">Fotos de evidencia (1 a 3)
          <input type="file" className="mdr-input" accept="image/*" multiple disabled={!configured || photos.length >= 3}
            onChange={(event) => { choose(event.target.files); event.target.value = ''; }} />
        </label>
        {selectionError && <ErrorBox message={selectionError} />}
        <ul className="space-y-2">
          {photos.map((photo) => {
            const running = ['preparing', 'uploading', 'confirming'].includes(photo.status);
            return <li className="space-y-2 rounded border border-[var(--mdr-line)] p-3 wrap-anywhere" key={photo.id}>
              <p className="font-medium">{photo.file.name}</p>
              <p role="status">{statuses[photo.status]}{photo.status === 'uploading' ? ` · ${photo.progress ?? 0}%` : ''}</p>
              {photo.status === 'uploading' && <progress max={100} value={photo.progress ?? 0} aria-label={`Progreso de ${photo.file.name}`} />}
              {photo.error && <p role="alert" className="text-[var(--mdr-danger)]">{photo.error}</p>}
              <div className="flex flex-wrap gap-2">
                {running && <button type="button" className="mdr-btn-ghost" onClick={() => requests.current.get(photo.id)?.abort()}>Cancelar</button>}
                {(photo.status === 'error' || photo.status === 'cancelled') && <button type="button" className="mdr-btn-ghost" onClick={() => void send(photo)}>Reintentar foto</button>}
                <button type="button" className="mdr-btn-ghost" onClick={() => {
                  requests.current.get(photo.id)?.abort();
                  setPhotos((previous) => previous.filter((item) => item.id !== photo.id));
                  setSelectionError('');
                }}>Quitar</button>
              </div>
            </li>;
          })}
        </ul>
        <button type="submit" className="mdr-btn" disabled={!allConfirmed || busy}>{busy ? 'Registrando…' : 'Registrar incidencia'}</button>
      </fieldset>
      {error && <ErrorBox message={error} />}
      {Object.keys(fields).length > 0 && <ul role="alert" className="text-[var(--mdr-danger)]">
        {Object.entries(fields).map(([key, message]) => <li key={key}>{message}</li>)}
      </ul>}
    </form>}
  </div>;
}

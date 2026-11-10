import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { apiRaw } from '../api/client';
import { ApiError } from '../api/errors';
import { ErrorBox, Spinner } from '../components/Screens';
import { decodeImage, encodeWebp } from '../media/photo';
import { storageReady, uploadError, uploadPhoto, type ConfirmedPhoto } from '../media/upload';
import { loadRefiner, useRecord, webUrl, type Refiner } from './data';

const center = { x: 0.5, y: 0.5, zoom: 1 };
const clamp = (value: number) => Math.min(1, Math.max(0, value));

function Cropper({ refiner, etag }: { refiner: Refiner; etag: string }) {
  const [base, setBase] = useState({ data: refiner, etag });
  const [conflict, setConflict] = useState<typeof base>();
  const [image, setImage] = useState<HTMLImageElement>();
  const [crop, setCrop] = useState(center);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<AbortController>(null);
  const confirmed = useRef<ConfirmedPhoto>(null);
  const decodeSequence = useRef(0);
  const drag = useRef<{ x: number; y: number }>(null);
  const path = `/refiners/${refiner.id}`;

  useEffect(() => () => {
    controller.current?.abort();
    decodeSequence.current += 1;
  }, []);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!image || !context) return;
    const side = Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom;
    const x = (image.naturalWidth - side) * crop.x;
    const y = (image.naturalHeight - side) * crop.y;
    context.clearRect(0, 0, 512, 512);
    context.drawImage(image, x, y, side, side, 0, 0, 512, 512);
  }, [image, crop]);

  function adjust(x: number, y: number, zoom = 0) {
    confirmed.current = null;
    setCrop((previous) => ({ x: clamp(previous.x + x), y: clamp(previous.y + y), zoom: Math.max(1, Math.min(4, previous.zoom + zoom)) }));
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    const sequence = ++decodeSequence.current;
    setImage(undefined);
    setStatus('');
    setError('');
    confirmed.current = null;
    try {
      const next = await decodeImage(file);
      if (decodeSequence.current !== sequence) return;
      setCrop(center);
      setImage(next);
    } catch (cause) {
      if (decodeSequence.current === sequence) setError(uploadError(cause));
    }
  }

  async function save() {
    if (!canvas.current || controller.current || conflict) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      if (!confirmed.current) {
        setStatus('Preparando WebP…');
        const photo = await encodeWebp(canvas.current, 120 * 1024);
        if (!photo) throw new Error('La imagen supera los 120 KB. Prueba un recorte diferente.');
        setStatus('Subiendo fotocheck…');
        confirmed.current = await uploadPhoto(photo, 'BADGE', active.signal, setProgress, () => setStatus('Verificando fotocheck…'));
      }
      setStatus('Asociando fotocheck al expediente…');
      const response = await apiRaw<Refiner>(path, {
        method: 'PATCH', signal: active.signal, headers: { 'If-Match': base.etag }, body: { badgeMediaId: confirmed.current.mediaId },
      });
      setBase({ data: response.data, etag: response.headers.get('ETag') ?? `"${response.data.version}"` });
      confirmed.current = null;
      setImage(undefined);
      setStatus('Fotocheck guardado.');
    } catch (cause) {
      setStatus(active.signal.aborted ? 'Subida cancelada.' : '');
      if (!active.signal.aborted) {
        if (cause instanceof ApiError && cause.status === 412) {
          try { setConflict(await loadRefiner(path, active.signal)); }
          catch (error) { if (!active.signal.aborted) setError(uploadError(error)); }
        } else {
          if (cause instanceof ApiError && cause.code === 'MEDIA_NOT_USABLE') confirmed.current = null;
          setError(uploadError(cause));
        }
      }
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  const configured = storageReady();
  const previousBadge = webUrl(base.data.badge?.url ?? null);
  const currentBadge = webUrl(conflict?.data.badge?.url ?? null);
  return <div className="mdr-panel max-w-2xl space-y-4">
    {!configured && <ErrorBox message="Configura la URL HTTPS y la clave pública de Supabase para subir el fotocheck." />}
    {previousBadge && <img src={previousBadge} alt="Fotocheck leído inicialmente" width={80} height={80} className="rounded" />}
    <label className="block">Seleccionar imagen
      <input className="mdr-input" type="file" accept="image/*" disabled={!configured || busy || Boolean(conflict)} onChange={(event) => void choose(event.target.files?.[0])} />
    </label>
    {image && <>
      <p id="crop-help">Arrastra para mover el recorte o usa las flechas. Usa + y − para acercar o alejar.</p>
      <canvas ref={canvas} width={512} height={512} tabIndex={0} aria-label="Vista previa del recorte cuadrado" aria-describedby="crop-help"
        className="aspect-square w-full max-w-80 touch-none rounded border border-[var(--mdr-line)]"
        onKeyDown={(event) => {
          if (busy || conflict) return;
          switch (event.key) {
            case 'ArrowLeft': adjust(-0.025, 0); break;
            case 'ArrowRight': adjust(0.025, 0); break;
            case 'ArrowUp': adjust(0, -0.025); break;
            case 'ArrowDown': adjust(0, 0.025); break;
            case '+': case '=': adjust(0, 0, 0.1); break;
            case '-': adjust(0, 0, -0.1); break;
            default: return;
          }
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (busy || conflict) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (!drag.current || busy || conflict) return;
          const width = event.currentTarget.clientWidth;
          adjust((drag.current.x - event.clientX) / width, (drag.current.y - event.clientY) / width);
          drag.current = { x: event.clientX, y: event.clientY };
        }}
        onLostPointerCapture={() => { drag.current = null; }}
      />
      <label className="block">Zoom {crop.zoom.toFixed(1)}×
        <input type="range" className="block w-full max-w-80" min={1} max={4} step={0.05} value={crop.zoom} disabled={busy || Boolean(conflict)}
          onChange={(event) => adjust(0, 0, Number(event.target.value) - crop.zoom)} />
      </label>
      <button type="button" className="mdr-btn" disabled={busy || Boolean(conflict)} onClick={() => void save()}>Guardar fotocheck</button>
    </>}
    {busy && <div className="flex flex-wrap items-center gap-3">
      <progress aria-label="Progreso de subida del fotocheck" max={100} value={progress} />
      <button className="mdr-btn-ghost" type="button" onClick={() => controller.current?.abort()}>Cancelar</button>
    </div>}
    {status && <p role="status">{status}</p>}
    {error && <ErrorBox message={error} />}
    {conflict && <section className="space-y-3" aria-labelledby="badge-conflict">
      <h2 id="badge-conflict" className="font-semibold">El expediente cambió a la versión {conflict.data.version}</h2>
      {currentBadge ? <img src={currentBadge} alt="Fotocheck actual del expediente" width={80} height={80} /> : <p>El expediente actual no tiene fotocheck.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="mdr-btn-ghost" onClick={() => {
          setBase(conflict); setConflict(undefined); setImage(undefined); confirmed.current = null;
        }}>Conservar actual</button>
        <button type="button" className="mdr-btn" onClick={() => {
          setBase(conflict); setConflict(undefined); setStatus('Revisa tu recorte y vuelve a guardar.');
        }}>Usar mi recorte</button>
      </div>
    </section>}
  </div>;
}

export function BadgePage() {
  const { id } = useParams();
  const [retry, setRetry] = useState(0);
  const entry = useRecord<Refiner>(`/refiners/${encodeURIComponent(id ?? '')}`, '', retry);
  return <div className="space-y-4">
    <Link className="mdr-link" to="/refiners">Volver al directorio</Link>
    <h1 className="text-2xl font-semibold">Cambiar fotocheck{entry?.data ? ` · ${entry.data.fullName}` : ''}</h1>
    {entry?.error ? <ErrorBox message={entry.error} onRetry={() => setRetry(retry + 1)} /> : entry?.data
      ? <Cropper key={entry.data.id} refiner={entry.data} etag={entry.etag ?? `"${entry.data.version}"`} />
      : <Spinner label="Cargando expediente…" />}
  </div>;
}


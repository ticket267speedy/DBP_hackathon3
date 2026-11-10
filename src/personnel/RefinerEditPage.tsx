import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { apiRaw } from '../api/client';
import { ApiError, errorMessage, fieldErrors } from '../api/errors';
import { ErrorBox, Spinner } from '../components/Screens';
import { loadRefiner, useRecord, type Department, type Refiner } from './data';

const labels = { title: 'Cargo', extension: 'Anexo', bio: 'Biografía', departmentId: 'Departamento' };
type Field = keyof typeof labels;
const fields = Object.keys(labels) as Field[];

function editable(data: Refiner) {
  return { title: data.title, extension: data.extension, bio: data.bio, departmentId: data.department.id };
}

type Draft = ReturnType<typeof editable>;

function Editor({ data, etag, departments }: { data: Refiner; etag: string; departments: Department[] }) {
  const [base, setBase] = useState({ data, etag });
  const [draft, setDraft] = useState(() => editable(data));
  const [conflict, setConflict] = useState<typeof base>();
  const [choices, setChoices] = useState<Partial<Record<Field, 'mine' | 'current'>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const path = `/refiners/${data.id}`;
  const original = editable(base.data);
  const current = conflict ? editable(conflict.data) : null;
  const contested = current ? fields.filter((key) => original[key] !== draft[key] && original[key] !== current[key] && draft[key] !== current[key]) : [];
  const displayValue = (key: Field, values: Draft) => key === 'departmentId'
    ? departments.find((item) => item.id === values.departmentId)?.name ?? String(values.departmentId)
    : values[key];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || conflict) return;
    const body = Object.fromEntries(fields.filter((key) => original[key] !== draft[key]).map((key) => [key, draft[key]]));
    if (Object.keys(body).length === 0) { setNotice('No hay cambios pendientes.'); return; }
    setBusy(true);
    setNotice('');
    setErrors({});
    try {
      const response = await apiRaw<Refiner>(path, { method: 'PATCH', headers: { 'If-Match': base.etag }, body });
      setBase({ data: response.data, etag: response.headers.get('ETag') ?? `"${response.data.version}"` });
      setDraft(editable(response.data));
      setNotice('Expediente guardado.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        try {
          setConflict(await loadRefiner(path));
          setChoices({});
        } catch (loadError) {
          setErrors({ _: errorMessage(loadError) });
        }
      } else {
        setErrors({ ...(error instanceof ApiError ? fieldErrors(error) : {}), _: errorMessage(error) });
      }
    } finally { setBusy(false); }
  }

  function resolve() {
    if (!current || !conflict) return;
    const merged = Object.fromEntries(fields.map((key) => [
      key, original[key] !== draft[key] && choices[key] !== 'current' ? draft[key] : current[key],
    ])) as Draft;
    setBase(conflict);
    setDraft(merged);
    setConflict(undefined);
    setNotice('Revisa los cambios combinados y vuelve a guardar.');
  }

  return <>
    {conflict && current && <section className="mdr-panel space-y-3" aria-labelledby="conflict-title">
      <h2 id="conflict-title" className="font-semibold">El expediente cambió a la versión {conflict.data.version}</h2>
      <p>Compara cada cambio y elige qué valor conservar cuando ambos editaron el mismo campo.</p>
      {fields.filter((key) => original[key] !== current[key] || original[key] !== draft[key]).map((key) => (
        <fieldset className="border border-[var(--mdr-line)] p-3" key={key}>
          <legend>{labels[key]}</legend>
          <p>Antes · {displayValue(key, original) || 'Vacío'}</p>
          <p>Actual · {displayValue(key, current) || 'Vacío'}</p>
          <p>Mi edición · {displayValue(key, draft) || 'Vacío'}</p>
          {contested.includes(key) && <div className="mt-2 flex gap-3">
            <label><input type="radio" name={`conflict-${key}`} checked={choices[key] === 'current'} onChange={() => setChoices({ ...choices, [key]: 'current' })} /> Actual</label>
            <label><input type="radio" name={`conflict-${key}`} checked={choices[key] === 'mine'} onChange={() => setChoices({ ...choices, [key]: 'mine' })} /> Mi edición</label>
          </div>}
        </fieldset>
      ))}
      <button type="button" className="mdr-btn" disabled={contested.some((key) => !choices[key])} onClick={resolve}>Aplicar resolución</button>
    </section>}
    <form className="mdr-panel max-w-2xl space-y-4" onSubmit={(event) => void save(event)}>
      <p className="text-[var(--mdr-muted)]">Versión {base.data.version}</p>
      <fieldset disabled={busy || Boolean(conflict)} className="space-y-3">
        <label className="block">Cargo<input className="mdr-input" required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="block">Anexo<input className="mdr-input" required pattern="[0-9]{3,6}" inputMode="numeric" value={draft.extension} onChange={(event) => setDraft({ ...draft, extension: event.target.value })} /></label>
        <label className="block">Departamento<select className="mdr-input" value={draft.departmentId} onChange={(event) => setDraft({ ...draft, departmentId: Number(event.target.value) })}>
          {departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        <label className="block">Biografía<textarea className="mdr-input" rows={5} maxLength={2000} value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>
        <button className="mdr-btn" type="submit">{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </fieldset>
      {notice && <p role="status">{notice}</p>}
      {Object.keys(errors).length > 0 && <ul role="alert" className="text-[var(--mdr-danger)]">
        {Object.entries(errors).map(([key, message]) => <li key={key}>{labels[key as Field] ? `${labels[key as Field]} · ` : ''}{message}</li>)}
      </ul>}
    </form>
  </>;
}

export function RefinerEditPage() {
  const { id } = useParams();
  const [retry, setRetry] = useState(0);
  const entry = useRecord<Refiner>(`/refiners/${encodeURIComponent(id ?? '')}`, '', retry);
  const departments = useRecord<Department[]>('/departments', '', retry);
  const error = entry?.error ?? departments?.error;
  return <div className="space-y-4">
    <Link className="mdr-link" to="/refiners">Volver al directorio</Link>
    <h1 className="text-2xl font-semibold">Editar expediente{entry?.data ? ` · ${entry.data.fullName}` : ''}</h1>
    {error ? <ErrorBox message={error} onRetry={() => setRetry(retry + 1)} /> : entry?.data && departments?.data
      ? <Editor key={entry.data.id} data={entry.data} etag={entry.etag ?? `"${entry.data.version}"`} departments={departments.data} />
      : <Spinner label="Cargando expediente…" />}
  </div>;
}

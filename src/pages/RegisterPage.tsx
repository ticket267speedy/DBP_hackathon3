import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ApiError, detailString, errorMessage, fieldErrors } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { AuthCard, Field } from './authUi';

type FormField = 'teamName' | 'email' | 'password';

export default function RegisterPage() {
  const { register } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState<Record<FormField, string>>({ teamName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const set = (field: FormField) => (value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setErrors({});
    setGeneral(null);
    try {
      await register(form.teamName, form.email, form.password);
      // Registro = sesión iniciada: <PublicOnly> entra directo a la app.
    } catch (error) {
      setSending(false);
      if (!(error instanceof ApiError)) {
        setGeneral(errorMessage(error));
        return;
      }
      if (error.code === 'VALIDATION_ERROR') {
        // details.fields = { campo: mensaje } ("_" = error del cuerpo completo)
        const fields = fieldErrors(error);
        setErrors(fields);
        if (fields._) setGeneral(fields._);
      } else if (error.code === 'EMAIL_TAKEN' || error.code === 'TEAM_NAME_TAKEN') {
        // 409 → details.field dice qué campo choca
        const field = detailString(error, 'field') ?? (error.code === 'EMAIL_TAKEN' ? 'email' : 'teamName');
        setErrors({ [field]: error.message });
      } else {
        setGeneral(errorMessage(error));
      }
    }
  }

  return (
    <AuthCard title="Registrar la cuadrilla" subtitle="Crea la cuenta de tu equipo. Entrarás con la sesión iniciada.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          id="register-teamName"
          label="Nombre de la cuadrilla"
          type="text"
          value={form.teamName}
          onChange={set('teamName')}
          error={errors.teamName}
          hint="De 3 a 40 caracteres."
        />
        <Field
          id="register-email"
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
        />
        <Field
          id="register-password"
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint="De 8 a 72 caracteres."
        />
        {general && (
          <p className="text-sm text-[var(--mdr-danger)]" role="alert">
            {general}
          </p>
        )}
        <button type="submit" className="mdr-btn w-full" disabled={sending}>
          {sending ? 'Registrando…' : 'Registrar y entrar'}
        </button>
      </form>
      <p className="text-sm text-[var(--mdr-muted)]">
        ¿Ya tienen cuenta?{' '}
        <Link to="/login" state={location.state} className="mdr-link">
          Iniciar sesión
        </Link>
      </p>
    </AuthCard>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ApiError, errorMessage, fieldErrors } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { AuthCard, Field } from './authUi';

export default function LoginPage() {
  const { state, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const notice = state.status === 'anonymous' ? state.notice : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setErrors({});
    setGeneral(null);
    try {
      await login(email, password);
      // <PublicOnly> redirige a la ruta que se quería abrir (con su query string).
    } catch (error) {
      setSending(false);
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        const fields = fieldErrors(error);
        setErrors(fields);
        if (fields._) setGeneral(fields._);
      } else if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setGeneral('Email o contraseña incorrectos.');
      } else {
        setGeneral(errorMessage(error));
      }
    }
  }

  return (
    <AuthCard title="Entrar al piso" subtitle="Inicia sesión con la cuenta de tu cuadrilla.">
      {notice && (
        <p className="rounded-md border border-[var(--mdr-warn)]/50 bg-[var(--mdr-warn)]/10 p-3 text-sm" role="alert">
          {notice}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          id="login-email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          error={errors.email}
        />
        <Field
          id="login-password"
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />
        {general && (
          <p className="text-sm text-[var(--mdr-danger)]" role="alert">
            {general}
          </p>
        )}
        <button type="submit" className="mdr-btn w-full" disabled={sending}>
          {sending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="text-sm text-[var(--mdr-muted)]">
        ¿Tu cuadrilla no tiene cuenta?{' '}
        <Link to="/register" state={location.state} className="mdr-link">
          Registrar cuadrilla
        </Link>
      </p>
    </AuthCard>
  );
}

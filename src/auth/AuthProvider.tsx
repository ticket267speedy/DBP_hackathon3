import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { ApiError, errorMessage } from '../api/errors';
import { rawRequest } from '../api/http';
import type { LoginResponse, Me, Permission, RegisterResponse } from '../api/types';
import { AuthContext, type AuthContextValue, type AuthState } from './AuthContext';
import {
  hasStoredSession,
  logout as endAndRevoke,
  startSession,
  subscribeSession,
  type EndReason,
} from './session';

const NOTICES: Record<EndReason, string | null> = {
  LOGOUT: null,
  LOGOUT_OTHER_TAB: 'Se cerró la sesión desde otra pestaña.',
  REFRESH_REUSED:
    'Lumon revocó tu sesión por seguridad: se intentó reutilizar un token de refresco. Vuelve a iniciar sesión.',
  SESSION_REVOKED: 'Tu sesión fue revocada. Vuelve a iniciar sesión.',
  REFRESH_INVALID: 'Tu sesión venció. Vuelve a iniciar sesión.',
  TOKEN_INVALID: 'Tu sesión dejó de ser válida. Vuelve a iniciar sesión.',
  EXPIRED: 'Tu sesión venció. Vuelve a iniciar sesión.',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  // Si hay un refresh token guardado, se empieza "restaurando": nunca se muestra el login mientras tanto.
  const [state, setState] = useState<AuthState>(() =>
    hasStoredSession() ? { status: 'restoring' } : { status: 'anonymous', notice: null },
  );
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  // Eventos de la sesión: fin (logout, revocada, en otra pestaña…) o login hecho en otra pestaña.
  useEffect(
    () =>
      subscribeSession((event) => {
        if (event.type === 'ended') {
          setState({ status: 'anonymous', notice: NOTICES[event.reason] });
        } else if (event.fromOtherTab) {
          setState((prev) => (prev.status === 'anonymous' ? { status: 'restoring' } : prev));
        }
      }),
    [],
  );

  // Restauración: GET /auth/me pide un access token; como no hay uno en memoria, se hace el refresh
  // con el refresh token guardado (coordinado entre pestañas). StrictMode ejecuta este efecto dos veces:
  // el segundo reutiliza el mismo refresh en vuelo, así que el refresh token se usa una sola vez.
  useEffect(() => {
    if (state.status !== 'restoring') return;
    let cancelled = false;
    api<Me>('/auth/me')
      .then((me) => {
        if (!cancelled) setState({ status: 'authenticated', me });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setState((prev) => (prev.status === 'restoring' ? { status: 'anonymous', notice: null } : prev));
        } else {
          setState({ status: 'restore-failed', message: errorMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state.status, restoreAttempt]);

  const finishLogin = useCallback(async (pair: LoginResponse | RegisterResponse) => {
    startSession(pair);
    const me = await api<Me>('/auth/me');
    setState({ status: 'authenticated', me });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await rawRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      await finishLogin(data);
    },
    [finishLogin],
  );

  const register = useCallback(
    async (teamName: string, email: string, password: string) => {
      const { data } = await rawRequest<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: { teamName: teamName.trim(), email: email.trim(), password },
      });
      await finishLogin(data);
    },
    [finishLogin],
  );

  const logout = useCallback(() => endAndRevoke(), []);

  const retryRestore = useCallback(() => {
    setState({ status: 'restoring' });
    setRestoreAttempt((n) => n + 1);
  }, []);

  const me = state.status === 'authenticated' ? state.me : null;
  const can = useCallback((permission: Permission) => me?.permissions.includes(permission) ?? false, [me]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, me, can, login, register, logout, retryRestore }),
    [state, me, can, login, register, logout, retryRestore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

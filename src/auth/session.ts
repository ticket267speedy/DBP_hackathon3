import { ApiError } from '../api/errors';
import { rawRequest } from '../api/http';
import type { TokenPair } from '../api/types';
import { newIdempotencyKey, yieldToEventLoop } from '../lib/async';

/**
 * Sesión de Lumon.
 *
 * - accessToken: SOLO en memoria (variable de este módulo). Nunca en localStorage/sessionStorage/IndexedDB/cookies.
 * - refreshToken: persistido en localStorage para restaurar la sesión al recargar. Es de UN SOLO USO.
 *
 * Reglas para no provocar REFRESH_REUSED:
 * 1. Dentro de una pestaña: un solo refresh a la vez (promesa compartida `inflight`).
 * 2. Entre pestañas: el refresh corre dentro de un Web Lock exclusivo, y el refresh token se lee
 *    de localStorage DENTRO del lock (así siempre se usa el último).
 * 3. Quien refresca avisa a las demás pestañas por BroadcastChannel con el access token nuevo:
 *    si una pestaña recibe ese aviso mientras esperaba el lock, ya no refresca.
 */

const REFRESH_KEY = 'lumon.refreshToken';
/** Identifica la sesión (cambia en cada login): así el logout nunca toca una sesión iniciada después. */
const SESSION_KEY = 'lumon.sessionId';
const CHANNEL_NAME = 'lumon-session';
const LOCK_NAME = 'lumon-session-refresh';

export type EndReason =
  | 'LOGOUT'
  | 'LOGOUT_OTHER_TAB'
  | 'REFRESH_REUSED'
  | 'SESSION_REVOKED'
  | 'REFRESH_INVALID'
  | 'TOKEN_INVALID'
  | 'EXPIRED';

export type SessionEvent =
  | { type: 'tokens'; fromOtherTab: boolean }
  | { type: 'ended'; reason: EndReason };

type TokenKind = 'login' | 'refresh';
type ChannelMessage =
  | { type: 'tokens'; kind: TokenKind; accessToken: string }
  | { type: 'ended'; reason: EndReason };

let accessToken: string | null = null;
let inflight: Promise<string> | null = null;
/** Cambia cada vez que una sesión empieza o termina: invalida resultados tardíos. */
let generation = 0;
/** true si en esta pestaña no hay sesión (nunca la hubo o se cerró). */
let endedHere = true;
const listeners = new Set<(event: SessionEvent) => void>();

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);

function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function readSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeRefreshToken(token: string, newSessionId?: string): void {
  try {
    localStorage.setItem(REFRESH_KEY, token);
    if (newSessionId) localStorage.setItem(SESSION_KEY, newSessionId);
  } catch {
    // Sin almacenamiento la sesión dura lo que la pestaña.
  }
}

function clearRefreshToken(): void {
  try {
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // nada que limpiar
  }
}

endedHere = readRefreshToken() === null;

function emit(event: SessionEvent): void {
  listeners.forEach((listener) => listener(event));
}

function isChannelMessage(value: unknown): value is ChannelMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as { type?: unknown; kind?: unknown; accessToken?: unknown; reason?: unknown };
  if (msg.type === 'tokens') {
    return typeof msg.accessToken === 'string' && (msg.kind === 'login' || msg.kind === 'refresh');
  }
  if (msg.type === 'ended') return typeof msg.reason === 'string';
  return false;
}

function broadcast(message: ChannelMessage): void {
  channel?.postMessage(message);
}

/** Termina la sesión SOLO en esta pestaña (memoria). */
function endLocally(reason: EndReason): void {
  accessToken = null;
  endedHere = true;
  generation += 1;
  emit({ type: 'ended', reason });
}

channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isChannelMessage(message)) return;
  if (message.type === 'tokens') {
    // Una pestaña que cerró sesión solo acepta un LOGIN nuevo, nunca el refresh de la sesión vieja.
    if (endedHere && message.kind !== 'login') return;
    if (message.kind === 'login') generation += 1;
    accessToken = message.accessToken;
    endedHere = false;
    emit({ type: 'tokens', fromOtherTab: true });
  } else if (!endedHere) {
    endLocally(message.reason === 'LOGOUT' ? 'LOGOUT_OTHER_TAB' : message.reason);
  }
});

if (!channel && typeof window !== 'undefined') {
  // Respaldo para navegadores sin BroadcastChannel: si otra pestaña borra el refresh token, cerramos.
  window.addEventListener('storage', (event) => {
    if (event.key === REFRESH_KEY && event.newValue === null && accessToken !== null) {
      endLocally('LOGOUT_OTHER_TAB');
    }
  });
}

async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    const result: T = await navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, () => task());
    return result;
  }
  return task();
}

export function subscribeSession(listener: (event: SessionEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasStoredSession(): boolean {
  return readRefreshToken() !== null;
}

/** Termina la sesión en TODAS las pestañas (memoria, localStorage y aviso por BroadcastChannel). */
export function endSession(reason: EndReason): void {
  clearRefreshToken();
  endLocally(reason);
  broadcast({ type: 'ended', reason });
}

/** Un 401 que no se arregla con refresh: decide el motivo por el código del error. */
export function endSessionFromError(error: ApiError): void {
  const reason: EndReason =
    error.code === 'REFRESH_REUSED'
      ? 'REFRESH_REUSED'
      : error.code === 'SESSION_REVOKED'
        ? 'SESSION_REVOKED'
        : error.code === 'REFRESH_INVALID'
          ? 'REFRESH_INVALID'
          : error.code === 'TOKEN_EXPIRED'
            ? 'EXPIRED'
            : 'TOKEN_INVALID';
  endSession(reason);
}

/** Login o registro exitoso. */
export function startSession(pair: TokenPair): void {
  generation += 1;
  endedHere = false;
  writeRefreshToken(pair.refreshToken, newIdempotencyKey());
  accessToken = pair.accessToken;
  broadcast({ type: 'tokens', kind: 'login', accessToken: pair.accessToken });
  emit({ type: 'tokens', fromOtherTab: false });
}

function sessionEndedError(): ApiError {
  return new ApiError({ status: 401, code: 'NO_SESSION', message: 'No hay una sesión activa.' });
}

/**
 * Refresh coordinado. `staleToken` es el access token que recibió TOKEN_EXPIRED
 * (o null al restaurar la sesión después de recargar).
 */
export function refreshAfterExpired(staleToken: string | null): Promise<string> {
  // Otra request (u otra pestaña) ya consiguió un token nuevo: se reutiliza.
  if (accessToken !== null && accessToken !== staleToken) return Promise.resolve(accessToken);
  // Ya hay un refresh en vuelo en esta pestaña: todas esperan el mismo.
  if (inflight) return inflight;

  const startedIn = generation;
  const promise = withRefreshLock(async () => {
    await yieldToEventLoop(); // procesa avisos de otras pestañas que llegaron mientras esperábamos el lock
    if (startedIn !== generation) throw sessionEndedError();
    if (accessToken !== null && accessToken !== staleToken) return accessToken;

    const refreshToken = readRefreshToken();
    if (!refreshToken) {
      endLocally('LOGOUT_OTHER_TAB');
      throw sessionEndedError();
    }

    let pair: TokenPair;
    try {
      // Sin AbortSignal a propósito: cancelar un refresh a medias puede perder el par nuevo.
      const response = await rawRequest<TokenPair>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
      });
      pair = response.data;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) endSessionFromError(error);
      throw error;
    }

    // Si la sesión se cerró mientras esperábamos la respuesta (logout en otra pestaña), no se reutiliza.
    if (startedIn !== generation) throw sessionEndedError();
    writeRefreshToken(pair.refreshToken);
    accessToken = pair.accessToken;
    broadcast({ type: 'tokens', kind: 'refresh', accessToken: pair.accessToken });
    emit({ type: 'tokens', fromOtherTab: false });
    return pair.accessToken;
  });

  inflight = promise;
  const clear = () => {
    if (inflight === promise) inflight = null;
  };
  promise.then(clear, clear);
  return promise;
}

/** Token para una request nueva: el actual, el del refresh en curso, o uno restaurado. */
export async function getAccessToken(): Promise<string> {
  if (accessToken) return accessToken;
  if (inflight) return inflight;
  if (readRefreshToken()) return refreshAfterExpired(null);
  throw sessionEndedError();
}

/**
 * Logout: cierra la sesión en TODAS las pestañas al instante (BroadcastChannel) y después la revoca
 * en el servidor con POST /auth/logout. Se envía el refresh token más reciente: por eso se espera el
 * lock, por si otra pestaña estaba justo rotándolo.
 */
export async function logout(): Promise<void> {
  const known = readRefreshToken();
  const knownSession = readSessionId();
  endSession('LOGOUT');
  await withRefreshLock(async () => {
    // Si mientras esperábamos el lock se inició OTRA sesión (otro sessionId), no se toca: solo se
    // revoca la vieja con el token que conocíamos. Si no, se usa el último refresh token de la sesión
    // (otra pestaña pudo rotarlo justo antes) y se limpia.
    const storedSession = readSessionId();
    const newSessionStarted = storedSession !== null && storedSession !== knownSession;
    const latest = newSessionStarted ? known : (readRefreshToken() ?? known);
    if (!newSessionStarted) clearRefreshToken();
    if (!latest) return;
    try {
      await rawRequest<null>('/auth/logout', { method: 'POST', body: { refreshToken: latest } });
    } catch {
      // La sesión ya se cerró en el navegador; si el servidor no respondió, el token vence solo (8 h).
    }
  });
}

import { API_BASE_URL, BUILD_ID } from '../config';
import { ApiError, abortError, isAbortError, isRecord, parseRetryAfter } from './errors';

export type QueryValue = string | number | null | undefined;

export interface RawOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  token?: string | null;
  signal?: AbortSignal;
}

export interface RawResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

type Listener = () => void;
const networkListeners = new Set<Listener>();

/** Avisa cuando una request falla por red (la usa HealthGate para volver a revisar /meta/health). */
export function onNetworkFailure(listener: Listener): () => void {
  networkListeners.add(listener);
  return () => networkListeners.delete(listener);
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(API_BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Request HTTP "cruda": agrega X-Lumon-Build a TODAS las requests (también login y refresh),
 * y convierte cualquier error en ApiError usando el formato único de errores de Lumon.
 * No sabe nada de sesiones: eso lo hace api/client.ts.
 */
export async function rawRequest<T>(path: string, options: RawOptions = {}): Promise<RawResponse<T>> {
  const headers: Record<string, string> = { 'X-Lumon-Build': BUILD_ID, ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) throw abortError();
    networkListeners.forEach((listener) => listener());
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'No se pudo conectar con Lumon.',
    });
  }

  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    const payload = isRecord(json) ? json : {};
    throw new ApiError({
      status: response.status,
      code: typeof payload.error === 'string' ? payload.error : `HTTP_${response.status}`,
      message: typeof payload.message === 'string' ? payload.message : `Error ${response.status}.`,
      details: payload.details ?? null,
      retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
      requestId:
        typeof payload.requestId === 'string' ? payload.requestId : response.headers.get('X-Request-Id'),
    });
  }

  return { data: json as T, status: response.status, headers: response.headers };
}

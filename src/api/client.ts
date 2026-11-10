import { endSessionFromError, getAccessToken, refreshAfterExpired } from '../auth/session';
import { backoffDelay, sleep } from '../lib/async';
import { ApiError } from './errors';
import { rawRequest, type RawOptions, type RawResponse } from './http';

export interface ApiOptions extends Omit<RawOptions, 'token'> {
  /** Reintentos automáticos ante 503 / corte de red (con Retry-After y espera creciente). */
  retries?: number;
}

/** Request autenticada: maneja TOKEN_EXPIRED con un refresh coordinado y UN solo reintento. */
async function authed<T>(path: string, options: ApiOptions): Promise<RawResponse<T>> {
  const token = await getAccessToken();
  try {
    return await rawRequest<T>(path, { ...options, token });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (error.code !== 'TOKEN_EXPIRED') {
      // TOKEN_INVALID / SESSION_REVOKED: no se arregla con refresh → al login.
      endSessionFromError(error);
      throw error;
    }
    const fresh = await refreshAfterExpired(token);
    try {
      return await rawRequest<T>(path, { ...options, token: fresh });
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) endSessionFromError(retryError);
      throw retryError;
    }
  }
}

function isTransient(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 0 || error.status === 503);
}

export async function apiRaw<T>(path: string, options: ApiOptions = {}): Promise<RawResponse<T>> {
  const maxRetries = options.retries ?? 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await authed<T>(path, options);
    } catch (error) {
      if (!isTransient(error) || attempt >= maxRetries || options.signal?.aborted) throw error;
      await sleep(Math.max(error.retryAfterMs ?? 0, backoffDelay(attempt)), options.signal);
    }
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await apiRaw<T>(path, options);
  return response.data;
}

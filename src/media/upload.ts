import { api } from '../api/client';
import { ApiError, abortError, errorMessage, isRecord } from '../api/errors';
import type { PreparedPhoto } from './photo';

type Purpose = 'BADGE' | 'INCIDENT';
interface Ticket { ticketId: string; provider: 'SUPABASE' | 'CLOUDINARY'; objectPath?: string; bucket?: string }
export interface ConfirmedPhoto { mediaId: number; url: string; width: number; height: number; purpose: Purpose }

function readPublicKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  if (key.startsWith('sb_publishable_')) return key;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const info: unknown = JSON.parse(atob(payload));
    if (isRecord(info) && info.role === 'anon') return key;
  } catch { /* An opaque private key is never sent. */ }
  return '';
}

function storageConfig() {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = readPublicKey(import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLIC_KEY);
  return base.startsWith('https://') && key ? { base, key } : null;
}

export function storageReady(): boolean {
  return storageConfig() !== null;
}

export function uploadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'STORAGE_NOT_VERIFIED') return 'El equipo debe verificar Supabase en la integración de almacenamiento de Lumon.';
    return errorMessage(error);
  }
  return error instanceof Error ? error.message : errorMessage(error);
}

function sendWebp(url: string, key: string, blob: Blob, signal: AbortSignal, onProgress: (percent: number) => void) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Supabase rechazó la subida (HTTP ${request.status}). Revisa el bucket y la política de inserción.`));
    };
    request.onerror = () => reject(new Error('No se pudo conectar con el almacenamiento.'));
    request.ontimeout = () => reject(new Error('La subida tardó demasiado. Vuelve a intentar.'));
    request.onabort = () => reject(abortError());
    request.onloadend = () => signal.removeEventListener('abort', abort);
    request.open('POST', url);
    request.timeout = 60000;
    request.setRequestHeader('Content-Type', 'image/webp');
    request.setRequestHeader('apikey', key);
    if (!key.startsWith('sb_publishable_')) request.setRequestHeader('Authorization', `Bearer ${key}`);
    request.setRequestHeader('x-upsert', 'false');
    signal.addEventListener('abort', abort, { once: true });
    request.send(blob);
  });
}

export async function uploadPhoto(
  photo: PreparedPhoto,
  purpose: Purpose,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
  onConfirming: () => void,
): Promise<ConfirmedPhoto> {
  const config = storageConfig();
  if (!config) throw new Error('Configura la URL HTTPS y la clave pública de Supabase.');
  const { base, key } = config;
  signal.throwIfAborted();
  const ticket = await api<Ticket>('/media/tickets', {
    method: 'POST', signal,
    body: { purpose, contentType: 'image/webp', bytes: photo.blob.size, width: photo.width, height: photo.height, sha256: photo.sha256 },
  });
  if (ticket.provider !== 'SUPABASE' || !ticket.objectPath || !ticket.bucket) {
    throw new Error('El ticket no pertenece al almacenamiento Supabase configurado.');
  }
  const path = [ticket.bucket, ...ticket.objectPath.split('/')].map(encodeURIComponent).join('/');
  const root = `${base}/storage/v1/object`;
  await sendWebp(`${root}/${path}`, key, photo.blob, signal, onProgress);
  onConfirming();
  return api<ConfirmedPhoto>(`/media/tickets/${encodeURIComponent(ticket.ticketId)}/confirm`, {
    method: 'POST', signal, retries: 2, body: { url: `${root}/public/${path}` },
  });
}


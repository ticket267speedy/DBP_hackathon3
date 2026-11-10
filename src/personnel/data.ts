import { useEffect, useState } from 'react';
import { apiRaw, type ApiOptions } from '../api/client';
import { errorMessage } from '../api/errors';

export interface Department { id: number; code: string; name: string }
export interface Photo { url: string; width: number; height: number }
export interface Refiner {
  id: number;
  fullName: string;
  department: Department;
  title: string;
  extension: string;
  bio: string;
  profileUrl: string | null;
  badge: Photo | null;
  version: number;
}
export interface Page<T> { content: T[]; page: number; size: number; totalPages: number; totalElements: number }

export function webUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* External URLs can be malformed. */ }
}

export function useRecord<T>(path: string, search = '', refresh = 0) {
  const [result, setResult] = useState<{ key: string; data?: T; error?: string; etag?: string }>();
  const key = [path, search, refresh].join(' ');
  useEffect(() => {
    const controller = new AbortController();
    const options: ApiOptions = {
      signal: controller.signal,
      retries: 2,
      query: Object.fromEntries(new URLSearchParams(search)),
    };
    void apiRaw<T>(path, options).then(({ data, headers }) => {
      if (!controller.signal.aborted) setResult({ key, data, etag: headers.get('ETag') ?? undefined });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key, error: errorMessage(error) });
    });
    return () => controller.abort();
  }, [key, path, search]);
  return result?.key === key ? result : undefined;
}

export async function loadRefiner(path: string, signal?: AbortSignal) {
  const { data, headers } = await apiRaw<Refiner>(path, { signal, retries: 2 });
  return { data, etag: headers.get('ETag') ?? `"${data.version}"` };
}

import type { FileStatus } from '../api/types';

export const FILE_SIZES = [10, 25, 50] as const;
export const FILE_SORTS = ['updatedAt,desc', 'progress,desc', 'name,asc'] as const;
export const FILE_STATUSES = ['ACTIVE', 'COMPLETE'] as const;

export type FileSize = (typeof FILE_SIZES)[number];
export type FileSort = (typeof FILE_SORTS)[number];

export interface FilesQuery {
  page: number;
  size: FileSize;
  status: FileStatus | '';
  q: string;
  sort: FileSort;
}

export const DEFAULT_QUERY: FilesQuery = { page: 0, size: 10, status: '', q: '', sort: 'updatedAt,desc' };

function pick<T extends string | number>(allowed: readonly T[], raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  return allowed.find((value) => String(value) === raw) ?? fallback;
}

/** La URL es la fuente de verdad. Cualquier valor inválido se reemplaza por el default: la vista nunca se rompe. */
export function parseFilesQuery(params: URLSearchParams): FilesQuery {
  const rawPage = params.get('page') ?? '';
  const page = /^\d{1,6}$/.test(rawPage) ? Number(rawPage) : 0;
  return {
    page,
    size: pick(FILE_SIZES, params.get('size'), DEFAULT_QUERY.size),
    status: pick<FileStatus | ''>(['', ...FILE_STATUSES], params.get('status'), ''),
    q: (params.get('q') ?? '').trim().slice(0, 60),
    sort: pick(FILE_SORTS, params.get('sort'), DEFAULT_QUERY.sort),
  };
}

/** Forma canónica (orden fijo, sin defaults): misma URL ⇔ mismo estado. */
export function toSearchParams(query: FilesQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.sort !== DEFAULT_QUERY.sort) params.set('sort', query.sort);
  if (query.size !== DEFAULT_QUERY.size) params.set('size', String(query.size));
  if (query.page > 0) params.set('page', String(query.page));
  return params;
}

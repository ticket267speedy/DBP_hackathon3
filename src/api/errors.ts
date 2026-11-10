/** Error de la API de Lumon. Se decide por `code` (campo `error` del cuerpo), nunca por `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly retryAfterMs: number | null;
  readonly requestId: string | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    retryAfterMs?: number | null;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.requestId = init.requestId ?? null;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function abortError(): DOMException {
  return new DOMException('La request fue cancelada.', 'AbortError');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Retry-After` llega en segundos enteros (o como fecha HTTP). */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** `VALIDATION_ERROR` → `details.fields = { campo: mensaje }`. */
export function fieldErrors(error: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(error.details)) return out;
  const fields = error.details.fields;
  if (!isRecord(fields)) return out;
  for (const [field, message] of Object.entries(fields)) {
    if (typeof message === 'string') out[field] = message;
  }
  return out;
}

export function detailString(error: ApiError, key: string): string | null {
  if (!isRecord(error.details)) return null;
  const value = error.details[key];
  return typeof value === 'string' ? value : null;
}

export function detailNumber(error: ApiError, key: string): number | null {
  if (!isRecord(error.details)) return null;
  const value = error.details[key];
  return typeof value === 'number' ? value : null;
}

/** `409 ALREADY_REFINED` → `details.tiles = [[tileRow, tileCol], …]`. */
export function detailTiles(error: ApiError): Array<[number, number]> {
  if (!isRecord(error.details) || !Array.isArray(error.details.tiles)) return [];
  const out: Array<[number, number]> = [];
  for (const item of error.details.tiles) {
    if (Array.isArray(item) && typeof item[0] === 'number' && typeof item[1] === 'number') {
      out.push([item[0], item[1]]);
    }
  }
  return out;
}

/** `409 GROUP_CLAIMED` → `details.holder.displayName`. */
export function detailHolder(error: ApiError): string | null {
  if (!isRecord(error.details)) return null;
  const holder = error.details.holder;
  if (!isRecord(holder)) return null;
  return typeof holder.displayName === 'string' ? holder.displayName : null;
}

/** Mensaje para personas, decidido por el código del error. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Ocurrió un error inesperado.';
  switch (error.code) {
    case 'NETWORK_ERROR':
      return 'No se pudo conectar con Lumon. Revisa tu conexión y vuelve a intentar.';
    case 'SERVICE_UNAVAILABLE':
      return 'Lumon no está disponible en este momento. Vuelve a intentar en unos segundos.';
    case 'RATE_LIMITED':
      return 'Demasiadas solicitudes seguidas. Espera unos segundos.';
    case 'FORBIDDEN':
      return 'No tienes permiso para esta acción.';
    case 'NOT_FOUND':
      return 'No se encontró lo que buscabas.';
    case 'BUILD_HEADER_REQUIRED':
      return 'Esta versión de la app no envió un X-Lumon-Build válido. Vuelve a desplegar.';
    case 'CLEARANCE_REQUIRED':
      return 'El Piso de Pruebas todavía está cerrado para tu equipo.';
    case 'INTERNAL_ERROR':
      return 'Lumon tuvo un error interno. Vuelve a intentar.';
    default:
      return error.message || `Error ${error.status}.`;
  }
}

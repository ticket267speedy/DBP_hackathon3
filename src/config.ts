function cleanBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/** Toda la configuración sale de variables de entorno VITE_*: ninguna URL va escrita en el código. */
export const API_BASE_URL = cleanBaseUrl(import.meta.env.VITE_API_BASE_URL);

/** Valor de la cabecera X-Lumon-Build ("dev" en local, SHA del commit en producción). */
export const BUILD_ID = __LUMON_BUILD__;

export const CONFIG_OK = API_BASE_URL.length > 0;

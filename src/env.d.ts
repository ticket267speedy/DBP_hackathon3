interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** SHA corto del commit (o "dev"), inyectado por vite.config.ts en tiempo de build. */
declare const __LUMON_BUILD__: string;

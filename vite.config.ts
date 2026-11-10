import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Valor de la cabecera X-Lumon-Build, calculado EN TIEMPO DE BUILD (nunca escrito a mano).
 * - `npm run dev`  → "dev" (el backend lo acepta desde localhost).
 * - `npm run build` → SHA corto (7) del commit. Vercel, Netlify y Cloudflare Pages exponen el SHA
 *   en variables de entorno durante el build; si no existen, se lee de git.
 */
function resolveBuildSha(command: 'build' | 'serve'): string {
  if (command === 'serve') return 'dev';
  const fromHost =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.GITHUB_SHA;
  let raw = fromHost ?? '';
  if (!raw) {
    try {
      raw = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      raw = '';
    }
  }
  const sha = raw.slice(0, 7).toLowerCase();
  return /^[0-9a-f]{7}$/.test(sha) ? sha : 'dev';
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __LUMON_BUILD__: JSON.stringify(resolveBuildSha(command)),
  },
}));

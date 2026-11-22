import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// The frontend bundles ../data/examples/*.json as its offline fallback, so allow the repo root.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// Backend address for the dev proxy (override if port 8000 is busy).
const apiTarget = process.env.VINEYARD_API_URL ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {port: 5173, strictPort: true, proxy: {'/api': apiTarget}, fs: {allow: [repoRoot]}},
});

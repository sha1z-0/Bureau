import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiPort = Number(process.env.BUREAU_PORT ?? 4317);

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.BUREAU_DEV_WEB_PORT ?? 5317),
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: { outDir: path.resolve(here, '../dist/web'), emptyOutDir: true, sourcemap: false },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./web'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': r('./shared'), '@web': r('./web/src') } },
  build: { outDir: r('./dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/media': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  publicDir: false,
  server: {
    port: 5173,
    fs: { allow: [resolve(import.meta.dirname, '..')] },
  },
  build: {
    outDir: resolve(import.meta.dirname, '../dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        soundTest: resolve(import.meta.dirname, 'sound-test.html'),
      },
    },
  },
  worker: { format: 'es' },
});

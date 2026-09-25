import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  publicDir: false,
  server: {
    port: 5173,
    fs: { allow: [resolve(__dirname, '..')] },
  },
  build: {
    outDir: resolve(__dirname, '../dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        soundTest: resolve(__dirname, 'sound-test.html'),
      },
    },
  },
  worker: { format: 'es' },
});

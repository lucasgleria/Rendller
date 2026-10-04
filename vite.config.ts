import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: funciona em GitHub Pages (/Rendller/) e localmente.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { chunkSizeWarningLimit: 900 },
  test: { globals: true, environment: 'node' },
});

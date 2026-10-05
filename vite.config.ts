import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: funciona em qualquer subcaminho e localmente.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { chunkSizeWarningLimit: 900 },
  // mesmo proxy do netlify.toml: o site da ANBIMA não libera acesso direto do navegador
  server: {
    proxy: {
      '/anbima': { target: 'https://www.anbima.com.br', changeOrigin: true, rewrite: (p) => p.replace(/^\/anbima/,'/feriados/arqs') },
    },
  },
  test: { globals: true, environment: 'node' },
});

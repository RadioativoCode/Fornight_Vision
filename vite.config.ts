import { defineConfig } from 'vite';

// O Vite serve o frontend. Em produção, o servidor Express
// (server/index.js) serve tanto a API quanto os arquivos buildados.
export default defineConfig({
  server: {
    port: 5173,
    // Proxy para o backend durante o desenvolvimento
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
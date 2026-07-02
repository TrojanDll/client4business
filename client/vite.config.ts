import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const proxyTarget = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': proxyTarget,
      '/health': proxyTarget,
      '/ready': proxyTarget,
    },
  },
});

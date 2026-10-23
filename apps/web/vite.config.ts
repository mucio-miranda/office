import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://localhost:4747';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, xfwd: true },
      '/ws': { target: api.replace('http', 'ws'), ws: true },
    },
  },
});

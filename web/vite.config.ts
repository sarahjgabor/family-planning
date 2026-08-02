import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the React app runs on Vite's dev server (5173) and proxies
// API calls to the Express server (4000). In production the Express server
// serves the built files directly, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});

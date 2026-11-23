import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Explicit .ts extension: Vite 8's native config loader (planned default) cannot resolve
// extensionless imports (SCRUM-149).
import { readAppVersion } from './appVersion.ts';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5005',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

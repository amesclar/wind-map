import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Explicit .ts extension: Vite 8's native config loader (planned default) cannot resolve
// extensionless imports (SCRUM-149).
import { composeAppVersion, readAppVersion, readGitSha } from './appVersion.ts';

export default defineConfig({
  plugins: [react()],
  define: {
    // Build hash suffix (SCRUM-159): X.Y.Z-<short-sha>, or plain X.Y.Z without one.
    __APP_VERSION__: JSON.stringify(composeAppVersion(readAppVersion(), readGitSha())),
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

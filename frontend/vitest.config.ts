import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readAppVersion } from './appVersion';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
  test: {
    environment: 'jsdom',
  },
});

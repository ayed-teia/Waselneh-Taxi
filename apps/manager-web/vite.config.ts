import path from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@taxi-line/shared': path.resolve(__dirname, '../../packages/shared/dist'),
    },
  },
  // Pre-bundle CommonJS shared package for ESM compatibility
  optimizeDeps: {
    include: ['@taxi-line/shared'],
  },
  build: {
    commonjsOptions: {
      include: [/shared/, /node_modules/],
    },
  },
});

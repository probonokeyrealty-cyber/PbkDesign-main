import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Isolated buyer entry: never copy public/, the command-center shell, or provider functions.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: '.pbk-local/investor-public-stage',
    sourcemap: false,
    rollupOptions: { input: path.resolve(__dirname, 'investor-portal.html') },
  },
});

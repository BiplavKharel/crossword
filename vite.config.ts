import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works under a GitHub Pages subpath.
export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'PUBLIC_'],
  plugins: [react()],
  server: { proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8787' } },
});

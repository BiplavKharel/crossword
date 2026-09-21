import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works under a GitHub Pages subpath.
export default defineConfig({
  base: './', plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
});

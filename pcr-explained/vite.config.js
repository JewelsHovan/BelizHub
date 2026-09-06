import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build`               -> dist/         (static host: GitHub Pages, Vercel, any CDN)
// `vite build --mode single` -> dist-single/  (one self-contained index.html: share as a Claude artifact or email it)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    // Relative assets also work inside the local Lecture Desk server.
    base: single ? './' : process.env.VITE_BASE || './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    build: { outDir: single ? 'dist-single' : 'dist', emptyOutDir: true },
    test: { environment: 'node', include: ['src/**/*.test.js'] },
  };
});

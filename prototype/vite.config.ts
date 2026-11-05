// Separate Vite setup for the clickable flow prototype. It reuses the main app's styles,
// fonts and components but never changes them. Run: npm run dev --prefix . -- (see README)
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: path.resolve(here, '../public'),
  plugins: [react()],
  server: { port: 3001 },
  build: { outDir: path.resolve(here, '../dist-prototype'), emptyOutDir: true },
});

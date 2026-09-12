import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Dev-only config for the standalone HUD mock harness. Not part of the build. */
export default defineConfig({
  root: here,
  server: { port: 5174, open: true, fs: { allow: [fileURLToPath(new URL('../../../..', import.meta.url))] } },
  build: { outDir: fileURLToPath(new URL('../../dist/mock', import.meta.url)), emptyOutDir: true },
});

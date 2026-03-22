import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: false, // vite builds page-agent.js into dist/ first; don't wipe it
  external: ['@playwright/test', 'page-agent', 'zod'],
  outDir: 'dist',
})

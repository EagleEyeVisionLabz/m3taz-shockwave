import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/main/main.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/preload.cjs') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    // Resolve a `.js`/`.jsx` import to a sibling `.ts`/`.tsx` if present, in the
    // DEV SERVER too (the esbuild build already does this). Without it, after a
    // .js→.ts rename any importer still spelling `.js` 404s in dev and silently
    // blanks the renderer while the build stays green. With it, conversions need
    // no importer changes and can't break dev.
    resolve: {
      extensionAlias: {
        '.js': ['.ts', '.tsx', '.js', '.jsx'],
        '.jsx': ['.tsx', '.jsx'],
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/renderer/index.html') },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    plugins: [react()],
  },
});

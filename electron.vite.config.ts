// electron-vite configuration: three build targets (main, preload, renderer).
//
// Layout (brief section 5):
//   electron/main.ts     -> Electron main process       -> dist-electron/main/main.mjs
//   electron/preload.ts  -> secure contextBridge preload -> dist-electron/preload/preload.mjs
//   src/ui/index.html    -> React renderer root          -> dist-electron/renderer/
//
// Output goes to dist-electron/ (NOT the default out/, which already holds Milestone 2
// batch-generation MusicXML artifacts — using the default would clobber them). dist* is
// gitignored.
//
// The project is "type": "module", so electron-vite emits main & preload as ESM (.mjs),
// which is why main.ts loads the preload as preload.mjs and webPreferences.sandbox is
// false (ESM preloads must be unsandboxed).

import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const OUT = 'dist-electron';

export default defineConfig({
  main: {
    // Don't bundle electron/node built-ins or deps (e.g. better-sqlite3 later); externalize.
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: `${OUT}/main`,
      rollupOptions: {
        input: { main: resolve(__dirname, 'electron/main.ts') },
        output: { format: 'es', entryFileNames: '[name].mjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: `${OUT}/preload`,
      rollupOptions: {
        input: { preload: resolve(__dirname, 'electron/preload.ts') },
        output: { format: 'es', entryFileNames: '[name].mjs' },
      },
    },
  },
  renderer: {
    // The renderer root holds index.html, which loads src/ui/main.tsx.
    root: resolve(__dirname, 'src/ui'),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, `${OUT}/renderer`),
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/ui/index.html') },
      },
    },
  },
});

/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` serves over a self-signed certificate so phones on the
// LAN can use motion sensors, which browsers only expose in secure contexts.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'https' ? [basicSsl()] : [],
  build: {
    target: 'es2022',
    // Rapier inlines its WASM (~4 MB), so it gets a chunk of its own that
    // stays cached across app releases.
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes('@dimforge/rapier3d') ? 'rapier' : id.includes('node_modules/three') ? 'three' : undefined,
      },
    },
  },
  test: {
    environment: 'node',
  },
}));

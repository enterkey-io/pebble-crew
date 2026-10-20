import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { appearancePlugin } from './scripts/appearance-plugin';
import { imageViewerStylesPlugin } from './scripts/image-viewer-styles-plugin';

export default defineConfig({
  root: 'apps/web',
  plugins: [tailwindcss(), appearancePlugin(), imageViewerStylesPlugin()],
  resolve: {
    alias: {
      '@': new URL('./apps/web/src', import.meta.url).pathname,
      '@hermes-client/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      '@hermes-client/protocol': new URL('./packages/hermes-client/src/index.ts', import.meta.url)
        .pathname,
    },
  },
  build: {
    outDir: process.env.WORKSPACE_BUILD_ROOT
      ? resolve(process.env.WORKSPACE_BUILD_ROOT, 'web')
      : 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        workspace: new URL('./apps/web/index.html', import.meta.url).pathname,
        avatarLab: new URL('./apps/web/avatar-lab.html', import.meta.url).pathname,
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});

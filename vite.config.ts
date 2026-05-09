import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@engine': resolve(__dirname, 'src/engine'),
      '@catalog': resolve(__dirname, 'src/catalog'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@api': resolve(__dirname, 'src/api'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Heavenward — Tonight\'s Sky',
        short_name: 'Heavenward',
        description: 'Dusk-till-dawn astronomical event report for your location',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB — catalog JSONs are large
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'weather-cache', expiration: { maxEntries: 10, maxAgeSeconds: 3600 } },
          },
          {
            urlPattern: /^https:\/\/skyview\.gsfc\.nasa\.gov\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'skyview-images', expiration: { maxEntries: 50, maxAgeSeconds: 86400 * 7 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
});

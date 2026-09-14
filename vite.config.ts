import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      includeAssets: [
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,webmanifest,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) => sameOrigin && !url.pathname.startsWith('/api/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'neon-rush-runtime',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 128, maxAgeSeconds: 604800 },
            },
          },
        ],
      },
    }),
  ],
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import proxy from './proxy.conf'

export default defineConfig({
  base: './',
  server: {
    proxy,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['*.png', 'favicon.ico', 'icon.svg'],
      manifest: {
        id: './mon-guide-tv',
        name: 'Mon Guide TV',
        short_name: 'Guide TV',
        description: 'Les programmes de la TNT française',
        start_url: './',
        scope: './',
        theme_color: '#111018',
        background_color: '#111018',
        display: 'standalone',
        orientation: 'portrait-primary',
        lang: 'fr',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api(?:\/|$)/],
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/www\.programme-tv\.net\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'programme-images',
              expiration: { maxEntries: 120, maxAgeSeconds: 604800 },
            },
          },
        ],
      },
    }),
  ],
})

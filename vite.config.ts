import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import proxy from './proxy.conf'

const staticAssetExtensions = new Set([
  '.avif',
  '.bmp',
  '.css',
  '.gif',
  '.html',
  '.ico',
  '.js',
  '.jpeg',
  '.jpg',
  '.json',
  '.otf',
  '.png',
  '.svg',
  '.ttf',
  '.webmanifest',
  '.webp',
  '.woff',
  '.woff2',
])
const textAssetExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.webmanifest'])
const buildVersion = randomUUID()

function versionStaticAssets(): Plugin {
  let outputDirectory = ''

  return {
    name: 'version-static-assets',
    apply: 'build' as const,
    enforce: 'post',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const files = await listFiles(outputDirectory)
      const assets = files.filter((file) => staticAssetExtensions.has(file.extension))
      const versionedNames = assets
        .map((file) => file.name)
        .sort((left, right) => right.length - left.length)

      for (const file of files) {
        if (!textAssetExtensions.has(file.extension)) continue
        let contents = await readFile(file.path, 'utf8')
        for (const name of versionedNames) {
          contents = contents.replaceAll(
            new RegExp(`${escapeRegExp(name)}(?![\\w.-]|\\?v=)`, 'g'),
            `${name}?v=${buildVersion}`,
          )
        }
        if (file.name === 'index.html') {
          contents = contents.replace(
            '</head>',
            `  <link rel="icon" type="image/svg+xml" href="./icon.svg?v=${buildVersion}">\n  <link rel="icon" href="./favicon.ico?v=${buildVersion}">\n  <link rel="apple-touch-icon" href="./apple-touch-icon-180x180.png?v=${buildVersion}">\n</head>`,
          )
        }
        await writeFile(file.path, contents)
      }
    },
  }
}

async function listFiles(
  directory: string,
): Promise<Array<{ name: string; extension: string; path: string }>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) return listFiles(path)
      return [{ name: entry.name, extension: entry.name.slice(entry.name.lastIndexOf('.')), path }]
    }),
  )
  return files.flat()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default defineConfig({
  base: './',
  server: {
    proxy,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
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
        globPatterns: [
          '**/*.{avif,bmp,css,gif,html,ico,jpeg,jpg,js,json,otf,png,svg,ttf,webmanifest,webp,woff,woff2}',
        ],
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
    versionStaticAssets(),
  ],
})

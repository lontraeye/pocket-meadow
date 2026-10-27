import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@sim': path.resolve(root, '../server/src/game/sim'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(root, '..')],
    },
    proxy: {
      '/api': {
        // 127.0.0.1, não localhost: no Windows o localhost tenta o IPv6 antes e
        // cada chamada da API perdia uns 200 ms (o servidor só ouve IPv4).
        target: 'http://127.0.0.1:3001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})

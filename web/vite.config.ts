import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  server: {
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

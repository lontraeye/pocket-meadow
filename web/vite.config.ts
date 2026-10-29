import { svelte } from '@sveltejs/vite-plugin-svelte'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * Carimba no `dist/sw.js` um id do build (hash dos nomes dos arquivos, que já
 * têm hash do conteúdo). Sem isso o sw.js seria igual em todo deploy: o
 * navegador não veria versão nova, o aviso de "Atualizar" não apareceria e o
 * JS e CSS de deploys antigos ficariam no cache para sempre.
 */
function stampServiceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    writeBundle(_options, bundle) {
      const file = path.join(outDir, 'sw.js')
      if (!fs.existsSync(file)) return
      const id = createHash('sha256').update(Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 12)
      const source = fs.readFileSync(file, 'utf8')
      if (!source.includes('__BUILD_ID__')) throw new Error('sw.js sem o marcador __BUILD_ID__')
      fs.writeFileSync(file, source.replaceAll('__BUILD_ID__', id))
    },
  }
}

export default defineConfig({
  plugins: [svelte(), stampServiceWorker()],
  resolve: {
    alias: {
      '@sim': path.resolve(root, '../server/src/game/sim'),
    },
  },
  server: {
    // Celular de verdade sem deploy: `npm run phone` abre um túnel do
    // cloudflared (https://<algo>.trycloudflare.com) para este servidor, e o
    // Vite recusa hosts que não conhece. Entra pelo login de teste (DEV_TOOLS).
    allowedHosts: ['.trycloudflare.com'],
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

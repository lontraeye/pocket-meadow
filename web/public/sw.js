/* Pocket Meadow service worker — só arquivos estáticos. A API nunca passa pelo cache. */
// Trocado por um id a cada build (stampServiceWorker em vite.config.ts): sw
// novo a cada deploy, aviso de atualizar e limpeza dos caches antigos.
const CACHE_VERSION = 'pm-static-__BUILD_ID__'
const PRECACHE = 'pm-precache-' + CACHE_VERSION
const RUNTIME = 'pm-runtime-' + CACHE_VERSION
/**
 * Teto de entradas no cache sob demanda (sprites/sons/ui/ícones). Cada espécie
 * tem várias folhas (Walk, Idle, Sleep e as de luta): com teto baixo o jardim
 * sozinho estoura e o celular baixa os mesmos sprites de novo a cada visita.
 * 600 folhas dá ~12 MB.
 */
const ART_MAX = 600

const OFFLINE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>Pocket Meadow</title>
<style>
  html,body{margin:0;min-height:100%;font:18px/1.4 system-ui,sans-serif;color:#3b2a1a;
    background:repeating-conic-gradient(#c6e2a9 0 25%,transparent 0 50%) 0 0/16px 16px,#cfe8b5;
    padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
  main{box-sizing:border-box;min-height:100dvh;display:grid;place-items:center;padding:1rem;text-align:center}
  .card{max-width:20rem;padding:1rem 1.25rem;background:#d4bc8f;box-shadow:inset 0 0 0 2px #3b2a1a44}
  h1{margin:0 0 .5rem;font-size:1.35rem}
  p{margin:0;font-weight:600}
</style>
</head>
<body>
<main><div class="card"><h1>Pocket Meadow</h1><p>Sem conexão. Volte quando a rede voltar.</p></div></main>
</body>
</html>`

self.addEventListener('install', (event) => {
  // Sem skipWaiting: a versão nova espera o toque em "Atualizar".
  event.waitUntil(caches.open(PRECACHE).then((cache) => cache.addAll(['/', '/index.html', '/manifest.webmanifest'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter(
            (key) =>
              (key.startsWith('pm-precache-') || key.startsWith('pm-runtime-')) &&
              key !== PRECACHE &&
              key !== RUNTIME,
          )
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // A API nem passa pelo service worker: o estado vem sempre do servidor, e o
  // login (redirecionamentos do Google) segue como se não houvesse sw.
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, PRECACHE))
    return
  }

  if (
    url.pathname.startsWith('/sprites/') ||
    url.pathname.startsWith('/sounds/') ||
    url.pathname.startsWith('/ui/') ||
    url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(staleWhileRevalidateCapped(event, request, RUNTIME, ART_MAX))
    return
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  // favicon, manifest etc.
  event.respondWith(staleWhileRevalidateCapped(event, request, RUNTIME, ART_MAX))
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidateCapped(event, request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone())
        await trimCache(cache, maxEntries)
      }
      return response
    })
    .catch(() => null)

  if (hit) {
    event.waitUntil(refresh)
    return hit
  }
  const response = await refresh
  if (response) return response
  return new Response('', { status: 504, statusText: 'offline' })
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(PRECACHE)
      await cache.put('/index.html', response.clone())
      await cache.put('/', response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(PRECACHE)
    const hit = (await cache.match('/index.html')) || (await cache.match('/')) || (await cache.match(request))
    if (hit) return hit
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys()
  if (keys.length <= maxEntries) return
  const drop = keys.length - maxEntries
  for (let i = 0; i < drop; i += 1) await cache.delete(keys[i])
}

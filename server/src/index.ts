import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { checkPlaces } from './config/places.js'
import { loadRegions } from './config/regions.js'
import { migrateDatabase } from './db/migrate.js'
import { authRoutes } from './routes/auth.js'
import { devRoutes, devToolsEnabled } from './routes/dev.js'
import { daycareRoutes } from './routes/daycare.js'
import { encounterRoutes } from './routes/encounters.js'
import { leaderRoutes } from './routes/leaders.js'
import { itemRoutes } from './routes/items.js'
import { plotRoutes } from './routes/plots.js'
import { pokedexRoutes } from './routes/pokedex.js'
import { pokemonRoutes } from './routes/pokemon.js'
import { fieldRoutes } from './routes/field.js'
import { gardenRoutes } from './routes/garden.js'
import { pcRoutes } from './routes/pc.js'
import { placeRoutes } from './routes/places.js'
import { regionRoutes } from './routes/regions.js'
import { stateRoutes } from './routes/state.js'
import { trainerRoutes } from './routes/trainer.js'

migrateDatabase()
loadRegions()
checkPlaces()

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT must be a positive integer')
}

const app = new Hono()

// Erros saem como { error: '<codigo>' }; o cliente traduz o código.
app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'internal' }, 500)
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))

// Contra CSRF de um subdomínio irmão: ele é "mesmo site", então o SameSite=Lax
// do cookie não barra. Formulário não manda JSON, e fetch com JSON de outra
// origem pede preflight, que este servidor não autoriza. DELETE já não sai de
// formulário e também pede preflight.
app.use('*', async (c, next) => {
  const method = c.req.method
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const type = c.req.header('content-type') ?? ''
    if (!type.toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'invalid_content_type' }, 415)
    }
  }
  await next()
})

// Nenhuma requisição do jogo passa de poucos KB (a maior é o fim da luta, com a
// lista de toques). Sem limite, um corpo gigante estoura os 320 MB do serviço.
app.use(
  '*',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: 'payload_too_large' }, 413),
  }),
)

app.route('/auth', authRoutes)
app.route('/state', stateRoutes)
app.route('/trainer', trainerRoutes)
app.route('/regions', regionRoutes)
app.route('/places', placeRoutes)
app.route('/field', fieldRoutes)
app.route('/pc', pcRoutes)
app.route('/encounters', encounterRoutes)
app.route('/leaders', leaderRoutes)
app.route('/pokemon', pokemonRoutes)
app.route('/pokedex', pokedexRoutes)
app.route('/daycare', daycareRoutes)
app.route('/garden', gardenRoutes)
app.route('/plots', plotRoutes)
app.route('/items', itemRoutes)
if (devToolsEnabled()) {
  app.route('/dev', devRoutes)
  console.log('DEV_TOOLS ligado: rotas de teste em /dev')
}

app.get('/health', (c) => {
  return c.json({ ok: true, service: 'pocket-meadow' })
})

serve(
  {
    fetch: app.fetch,
    // Na VM fica só no loopback, atrás do Caddy (HOST=127.0.0.1); no Docker, 0.0.0.0.
    hostname: process.env.HOST ?? '0.0.0.0',
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  },
)

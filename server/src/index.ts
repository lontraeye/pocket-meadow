import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { loadRegions } from './config/regions.js'
import { migrateDatabase } from './db/migrate.js'
import { authRoutes } from './routes/auth.js'
import { devRoutes, devToolsEnabled } from './routes/dev.js'
import { encounterRoutes } from './routes/encounters.js'
import { pokemonRoutes } from './routes/pokemon.js'
import { regionRoutes } from './routes/regions.js'
import { stateRoutes } from './routes/state.js'

migrateDatabase()
loadRegions()

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

app.route('/auth', authRoutes)
app.route('/state', stateRoutes)
app.route('/regions', regionRoutes)
app.route('/encounters', encounterRoutes)
app.route('/pokemon', pokemonRoutes)
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
    hostname: '0.0.0.0',
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  },
)

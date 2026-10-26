import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { migrateDatabase } from './db/migrate.js'

migrateDatabase()

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT must be a positive integer')
}

const app = new Hono()

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

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { Hono } from 'hono'
import { googleSubFromClaims } from '../auth/google.js'
import { hashToken } from '../auth/session.js'
import { authConfig } from '../config/auth.js'
import { getSqlite } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'

// Banco próprio, criado antes de qualquer getDb() deste processo.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-auth-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { authRoutes } = await import('./auth.js')

const app = new Hono().route('/auth', authRoutes)
// O conninfo do node-server lê o socket; app.request não tem um.
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }
const now = Date.now()
const clientId = 'client.apps.googleusercontent.com'

function send(url: string, init: RequestInit = {}) {
  return app.request(url, init, env)
}

function post(url: string, body: unknown, cookie?: string) {
  return send(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

function pendingSignup(sub: string, expiresAt = now + authConfig.signupTtlMs): string {
  const token = `token-${sub}-${expiresAt}`
  getSqlite()
    .prepare('insert into google_signups (id, google_sub, created_at, expires_at) values (?, ?, ?, ?)')
    .run(hashToken(token), sub, now, expiresAt)
  return `${authConfig.signupCookie}=${token}`
}

function userBySub(sub: string) {
  return getSqlite().prepare('select id, username from users where google_sub = ?').get(sub) as
    | { id: number; username: string }
    | undefined
}

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('ID token do Google', () => {
  const claims = { iss: 'https://accounts.google.com', aud: clientId, sub: '1234', exp: now / 1000 + 600 }

  test('aceita emissor, público e validade certos', () => {
    assert.equal(googleSubFromClaims(claims, clientId, now), '1234')
    assert.equal(googleSubFromClaims({ ...claims, iss: 'accounts.google.com', aud: [clientId] }, clientId, now), '1234')
  })

  test('recusa outro público, outro emissor, vencido ou sem sub', () => {
    assert.equal(googleSubFromClaims({ ...claims, aud: 'outro' }, clientId, now), null)
    assert.equal(googleSubFromClaims({ ...claims, iss: 'https://evil.example' }, clientId, now), null)
    assert.equal(googleSubFromClaims({ ...claims, exp: now / 1000 - 1 }, clientId, now), null)
    assert.equal(googleSubFromClaims({ ...claims, sub: '' }, clientId, now), null)
    assert.equal(googleSubFromClaims('lixo', clientId, now), null)
  })
})

describe('ida ao Google', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.PUBLIC_URL
  })

  test('sem configuração, volta avisando', async () => {
    const response = await send('/auth/google')
    assert.equal(response.headers.get('location'), '/?auth=unavailable')
  })

  test('manda para o Google com PKCE, só openid, e guarda o state em cookie', async () => {
    process.env.GOOGLE_CLIENT_ID = clientId
    process.env.GOOGLE_CLIENT_SECRET = 'secret'
    process.env.PUBLIC_URL = 'https://pocket.example/'
    const response = await send('/auth/google')
    const url = new URL(response.headers.get('location') ?? '')
    assert.equal(url.host, 'accounts.google.com')
    assert.equal(url.searchParams.get('scope'), 'openid')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('redirect_uri'), 'https://pocket.example/api/auth/google/callback')
    const cookies = response.headers.getSetCookie().join('\n')
    assert.match(cookies, new RegExp(`${authConfig.oauthStateCookie}=${url.searchParams.get('state')};`))
    assert.match(cookies, /HttpOnly/)
  })

  test('volta com state diferente do cookie: falha sem trocar o código', async () => {
    process.env.GOOGLE_CLIENT_ID = clientId
    process.env.GOOGLE_CLIENT_SECRET = 'secret'
    process.env.PUBLIC_URL = 'https://pocket.example'
    const response = await send('/auth/google/callback?code=abc&state=forjado', {
      headers: { cookie: `${authConfig.oauthStateCookie}=certo; ${authConfig.oauthVerifierCookie}=v` },
    })
    assert.equal(response.headers.get('location'), '/?auth=failed')
  })
})

describe('cadastro depois do Google', () => {
  test('sem cadastro pendente, nada feito', async () => {
    assert.equal((await send('/auth/signup')).status, 404)
    assert.equal((await post('/auth/signup', { username: 'ash', starter: 'pikachu' })).status, 400)
    assert.equal((await post('/auth/signup', { username: 'ash', starter: 'charmander' })).status, 401)
  })

  test('cria a conta ligada ao Google, abre a sessão e consome o cadastro', async () => {
    const cookie = pendingSignup('sub-ash')
    assert.equal((await send('/auth/signup', { headers: { cookie } })).status, 200)

    const response = await post('/auth/signup', { username: 'ash', starter: 'charmander' }, cookie)
    assert.equal(response.status, 201)
    assert.match(response.headers.getSetCookie().join('\n'), new RegExp(`${authConfig.cookieName}=`))
    assert.equal(userBySub('sub-ash')?.username, 'ash')
    const starter = getSqlite()
      .prepare('select species_id from pokemon where user_id = ?')
      .get(userBySub('sub-ash')?.id) as { species_id: number }
    assert.equal(starter.species_id, 4)
    const event = getSqlite().prepare(`select event, ip from auth_events order by id desc limit 1`).get()
    assert.deepEqual({ ...(event as object) }, { event: 'register', ip: '203.0.113.7' })

    // O mesmo cookie não serve de novo.
    assert.equal((await post('/auth/signup', { username: 'ash2', starter: 'squirtle' }, cookie)).status, 401)
  })

  test('nome em uso: recusa e o cadastro continua valendo', async () => {
    const cookie = pendingSignup('sub-gary')
    assert.equal((await post('/auth/signup', { username: 'ASH', starter: 'squirtle' }, cookie)).status, 409)
    assert.equal((await post('/auth/signup', { username: 'gary', starter: 'squirtle' }, cookie)).status, 201)
    assert.equal(userBySub('sub-gary')?.username, 'gary')
  })

  test('cadastro vencido não cria conta', async () => {
    const cookie = pendingSignup('sub-old', now - 1)
    assert.equal((await post('/auth/signup', { username: 'old', starter: 'squirtle' }, cookie)).status, 401)
    assert.equal(userBySub('sub-old'), undefined)
  })
})

describe('login de teste', () => {
  test('cria a conta sem Google na primeira vez e depois só entra', async () => {
    const { devRoutes } = await import('./dev.js')
    const dev = new Hono().route('/dev', devRoutes)
    const login = (username: string) =>
      dev.request(
        '/dev/login',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username }) },
        env,
      )
    assert.equal((await login('brock')).status, 200)
    assert.equal((await login('brock')).status, 200)
    const rows = getSqlite().prepare(`select google_sub from users where username = 'brock'`).all()
    assert.deepEqual(rows.map((row) => ({ ...(row as object) })), [{ google_sub: null }])
    assert.equal((await login('x')).status, 400)
  })
})

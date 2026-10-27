import { timingSafeEqual } from 'node:crypto'

const issuers = new Set(['https://accounts.google.com', 'accounts.google.com'])

/**
 * Lê o `sub` do ID token. O token vem direto do endpoint de token do Google,
 * por TLS e com o client secret, então a assinatura não precisa ser conferida
 * (OpenID Connect Core, 3.1.3.7, item 6). Emissor, público e validade sim.
 */
export function googleSubFromClaims(claims: unknown, clientId: string, now: number): string | null {
  if (claims === null || typeof claims !== 'object') return null
  const { iss, aud, sub, exp } = claims as Record<string, unknown>
  if (typeof iss !== 'string' || !issuers.has(iss)) return null
  const audiences = Array.isArray(aud) ? aud : [aud]
  if (!audiences.includes(clientId)) return null
  if (typeof exp !== 'number' || exp * 1000 <= now) return null
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255) return null
  return sub
}

export function sameToken(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

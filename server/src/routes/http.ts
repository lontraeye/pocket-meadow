import type { Context } from 'hono'

export type Failure = {
  ok: false
  error: string
  status: 400 | 404 | 409
  pokemonId?: number
  min?: number
}

export function fail(
  error: string,
  status: Failure['status'],
  extra?: { pokemonId?: number; min?: number },
): Failure {
  return { ok: false, error, status, ...extra }
}

export function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

export function parseSlot(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null
  const slot = Number(value)
  return Number.isSafeInteger(slot) ? slot : null
}

export async function readObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

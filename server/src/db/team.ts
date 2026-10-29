import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { trainerConfig } from '../config/trainer.js'
import { getDb } from './client.js'
import { pokemon } from './schema.js'

// Time e PC. O time são até `teamMax` Pokémon do jardim, em ordem; todos vão
// para a luta, e o jogador escolhe quem abre. O time nunca fica vazio. No PC
// o Pokémon some do jardim e fica parado. Tudo aqui roda dentro da transação
// de quem chama (immediate).

export type TeamError = 'invalid_team' | 'last_in_team'

/** Ids do time, na ordem das posições. */
export function teamIds(userId: number): number[] {
  return getDb()
    .select({ id: pokemon.id })
    .from(pokemon)
    .where(and(eq(pokemon.userId, userId), isNotNull(pokemon.teamSlot)))
    .orderBy(asc(pokemon.teamSlot))
    .all()
    .map((row) => row.id)
}

/**
 * Grava o time na ordem dada. Primeiro limpa todas as posições: o índice
 * único (user_id, team_slot) não deixa trocar duas de lugar uma a uma.
 */
function writeTeam(userId: number, ids: readonly number[]): void {
  const db = getDb()
  db.update(pokemon)
    .set({ teamSlot: null })
    .where(and(eq(pokemon.userId, userId), isNotNull(pokemon.teamSlot)))
    .run()
  ids.forEach((id, slot) => {
    db.update(pokemon)
      .set({ teamSlot: slot })
      .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
      .run()
  })
}

/** Troca o time inteiro: 1 a teamMax Pokémon do jardim (fora do PC e do daycare), sem repetir. */
export function setTeam(userId: number, ids: readonly number[]): { ok: true; team: number[] } | { ok: false; error: TeamError } {
  if (ids.length < 1 || ids.length > trainerConfig.teamMax) return { ok: false, error: 'invalid_team' }
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'invalid_team' }
  const rows = getDb()
    .select({ id: pokemon.id, location: pokemon.location, inPc: pokemon.inPc })
    .from(pokemon)
    .where(eq(pokemon.userId, userId))
    .all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const id of ids) {
    const mon = byId.get(id)
    if (!mon || mon.location !== 'garden' || mon.inPc) return { ok: false, error: 'invalid_team' }
  }
  writeTeam(userId, ids)
  return { ok: true, team: [...ids] }
}

/**
 * Tira do time quem vai sair do jardim (PC, daycare, soltar). Recusa se o
 * time ficaria vazio. Quem não está no time passa direto.
 */
export function leaveTeam(userId: number, leaving: readonly number[]): { ok: true } | { ok: false; error: 'last_in_team' } {
  const current = teamIds(userId)
  const out = new Set(leaving)
  const rest = current.filter((id) => !out.has(id))
  if (rest.length === current.length) return { ok: true }
  if (rest.length === 0) return { ok: false, error: 'last_in_team' }
  writeTeam(userId, rest)
  return { ok: true }
}

/** O time da luta: os mesmos do time, em qualquer ordem (o primeiro abre). */
export function isWholeTeam(userId: number, ids: readonly number[]): boolean {
  const current = teamIds(userId)
  if (current.length !== ids.length || new Set(ids).size !== ids.length) return false
  const set = new Set(current)
  return ids.every((id) => set.has(id))
}

export type Place = 'team' | 'garden' | 'pc'

export type MoveError = 'pokemon_not_found' | 'in_daycare' | 'last_in_team' | 'team_full' | 'invalid_slot'

function setInPc(userId: number, id: number, inPc: boolean): void {
  getDb()
    .update(pokemon)
    .set({ inPc })
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()
}

/**
 * Move um Pokémon entre time, jardim e PC (tela do PC). Para o time, `slot`
 * diz a vaga: vaga ocupada troca os dois de lugar (quem sai do time vai para
 * onde o outro estava); sem vaga, entra no fim. Dentro do time, reordena.
 */
export function movePokemon(
  userId: number,
  id: number,
  to: Place,
  slot?: number,
): { ok: true } | { ok: false; error: MoveError } {
  const mon = getDb()
    .select({ location: pokemon.location, inPc: pokemon.inPc, teamSlot: pokemon.teamSlot })
    .from(pokemon)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return { ok: false, error: 'pokemon_not_found' }
  if (mon.location === 'daycare') return { ok: false, error: 'in_daycare' }
  const from: Place = mon.teamSlot !== null ? 'team' : mon.inPc ? 'pc' : 'garden'

  if (to !== 'team') {
    if (from === 'team') {
      const left = leaveTeam(userId, [id])
      if (!left.ok) return left
    }
    setInPc(userId, id, to === 'pc')
    return { ok: true }
  }

  const team = teamIds(userId)
  const max = trainerConfig.teamMax
  if (slot !== undefined && (!Number.isInteger(slot) || slot < 0 || slot >= max)) {
    return { ok: false, error: 'invalid_slot' }
  }
  if (from === 'team') {
    // Reordenar: troca com quem está na vaga (ou vai para o fim).
    const at = team.indexOf(id)
    const target = slot === undefined ? team.length - 1 : Math.min(slot, team.length - 1)
    const next = [...team]
    next[at] = next[target]!
    next[target] = id
    writeTeam(userId, next)
    return { ok: true }
  }

  if (from === 'pc') setInPc(userId, id, false)
  if (slot !== undefined && slot < team.length) {
    const out = team[slot]!
    const next = [...team]
    next[slot] = id
    writeTeam(userId, next)
    // Quem saiu do time vai para onde o outro estava.
    if (from === 'pc') setInPc(userId, out, true)
    return { ok: true }
  }
  if (team.length >= max) return { ok: false, error: 'team_full' }
  writeTeam(userId, [...team, id])
  return { ok: true }
}

/** Vários de uma vez para o jardim ou para o PC (sai do time; o time não esvazia). */
export function moveMany(
  userId: number,
  ids: readonly number[],
  to: 'garden' | 'pc',
): { ok: true } | { ok: false; error: MoveError; pokemonId?: number } {
  const rows = getDb()
    .select({ id: pokemon.id, location: pokemon.location })
    .from(pokemon)
    .where(eq(pokemon.userId, userId))
    .all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const id of ids) {
    const row = byId.get(id)
    if (!row) return { ok: false, error: 'pokemon_not_found', pokemonId: id }
    if (row.location === 'daycare') return { ok: false, error: 'in_daycare', pokemonId: id }
  }
  const left = leaveTeam(userId, ids)
  if (!left.ok) return left
  for (const id of ids) setInPc(userId, id, to === 'pc')
  return { ok: true }
}

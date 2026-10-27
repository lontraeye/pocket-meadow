<script lang="ts">
  import { api, errorText, type ApiError, type DaycareSlot, type GameState, type OwnedPokemon } from './api'
  import { showdownSrc } from './sprites'

  let { game, onClose, onState }: { game: GameState; onClose: () => void; onState: () => Promise<void> } = $props()

  let pickingSlot = $state<number | null>(null)
  let message = $state('')
  let pending = $state(false)
  let tick = $state(Date.now())

  const byId = $derived(new Map(game.pokemon.map((mon) => [mon.id, mon])))
  const occupied = $derived(new Map(game.daycare.slots.map((slot) => [slot.slotIndex, slot])))
  const garden = $derived(
    game.pokemon.filter((mon) => mon.location === 'garden').sort((a, b) => b.level - a.level || a.id - b.id),
  )

  type Card =
    | { kind: 'locked'; slotIndex: number; opensAt: number }
    | { kind: 'empty'; slotIndex: number }
    | { kind: 'filled'; slotIndex: number; slot: DaycareSlot; mon: OwnedPokemon }

  const cards = $derived.by(() => {
    const list: Card[] = []
    for (let i = 0; i < game.daycare.slotsUnlocked; i += 1) {
      const slot = occupied.get(i)
      const mon = slot ? byId.get(slot.pokemonId) : undefined
      if (slot && mon) list.push({ kind: 'filled', slotIndex: i, slot, mon })
      else list.push({ kind: 'empty', slotIndex: i })
    }
    if (game.daycare.nextSlotLevel !== null) {
      list.push({ kind: 'locked', slotIndex: game.daycare.slotsUnlocked, opensAt: game.daycare.nextSlotLevel })
    }
    return list
  })

  $effect(() => {
    const timer = window.setInterval(() => {
      tick = Date.now()
    }, 1000)
    return () => window.clearInterval(timer)
  })

  // O relógio do celular pode estar errado: conta só o tempo que passou desde
  // que o /state chegou, somado ao `now` do servidor.
  let receivedAt = $state(Date.now())
  $effect.pre(() => {
    void game.now
    receivedAt = Date.now()
  })

  function remainingMs(fullAt: number): number {
    const serverNow = game.now + Math.max(0, tick - receivedAt)
    return Math.max(0, fullAt - serverNow)
  }

  function formatRemaining(ms: number): string {
    const total = Math.ceil(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  async function run(path: string, body?: unknown, method?: 'POST' | 'DELETE'): Promise<Record<string, unknown> | null> {
    pending = true
    message = ''
    try {
      const response = await api(path, body, method)
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & Record<string, unknown>
      if (!response.ok) {
        message = errorText(payload)
        return null
      }
      await onState()
      return payload
    } catch {
      message = 'Sem conexão com o servidor.'
      return null
    } finally {
      pending = false
    }
  }

  async function place(slotIndex: number, pokemonId: number) {
    const ok = await run(`/api/daycare/${slotIndex}`, { pokemonId })
    if (ok) pickingSlot = null
  }

  async function withdraw(slotIndex: number) {
    const result = await run(`/api/daycare/${slotIndex}`, undefined, 'DELETE')
    if (!result) return
    const xp = Number(result.xpGained ?? 0)
    const levels = Number(result.levelsGained ?? 0)
    message = `+${xp} XP · +${levels} nível${levels === 1 ? '' : 's'}`
  }

  async function advance(hours: number) {
    const ok = await run('/api/dev/daycare/advance', { hours })
    if (ok) message = `Adiantou ${hours}h (teste).`
  }

  async function renew(slotIndex: number) {
    const result = await run(`/api/daycare/${slotIndex}/renew`, {})
    if (!result) return
    const xp = Number(result.xpGained ?? 0)
    const levels = Number(result.levelsGained ?? 0)
    message = `Renovado. +${xp} XP · +${levels} nível${levels === 1 ? '' : 's'}`
  }
</script>

<div class="daycare">
  <div class="scroll">
    {#if message}<p class="alert" role="status">{message}</p>{/if}
    <p class="hint">Slots {game.daycare.slotsUnlocked} · o XP para quando o tempo enche.</p>

    {#if pickingSlot !== null}
      <section class="panel pick" aria-label="Escolher Pokémon">
        <h2>Colocar no slot {pickingSlot + 1}</h2>
        {#if garden.length <= 1}
          <p class="hint">Deixe alguém no jardim.</p>
        {:else}
          <div class="list">
            {#each garden as mon (mon.id)}
              <button type="button" class="choice" disabled={pending} onclick={() => void place(pickingSlot!, mon.id)}>
                <img src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" width="64" height="64" />
                <span>{mon.nickname ?? mon.displayName}</span>
                <small>Nv {mon.level}</small>
              </button>
            {/each}
          </div>
        {/if}
        <button type="button" class="btn" disabled={pending} onclick={() => (pickingSlot = null)}>Cancelar</button>
      </section>
    {:else}
      <div class="cards">
        {#each cards as card (card.slotIndex)}
          {#if card.kind === 'locked'}
            <section class="panel card locked">
              <h2>Slot {card.slotIndex + 1}</h2>
              <p class="hint">Abre no nível {card.opensAt}</p>
            </section>
          {:else if card.kind === 'empty'}
            <section class="panel card">
              <h2>Slot {card.slotIndex + 1}</h2>
              <p class="hint">Vazio</p>
              <button type="button" class="btn btn-primary" disabled={pending} onclick={() => (pickingSlot = card.slotIndex)}>
                Colocar
              </button>
            </section>
          {:else}
            {@const left = remainingMs(card.slot.fullAt)}
            {@const full = left <= 0}
            {@const span = Math.max(1, card.slot.fullAt - card.slot.enteredAt)}
            {@const filled = Math.min(100, ((span - left) / span) * 100)}
            <section class="panel card">
              <div class="head">
                <div class="portrait">
                  <img src={showdownSrc(card.mon.speciesId, card.mon.isShiny)} alt="" />
                </div>
                <div class="info">
                  <h2>{card.mon.nickname ?? card.mon.displayName}</h2>
                  <p class="lv">Nv {card.mon.level}</p>
                  <div class="xp">
                    {#if card.mon.xpToNext === null}
                      <span>XP no máximo</span>
                    {:else}
                      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={card.mon.xpToNext} aria-valuenow={card.mon.xp}>
                        <span style:width="{Math.min(100, (card.mon.xp / card.mon.xpToNext) * 100)}%"></span>
                      </div>
                      <small>XP {card.mon.xp}/{card.mon.xpToNext}</small>
                    {/if}
                  </div>
                  <p class="preview">+{card.slot.xpGained} XP até agora</p>
                </div>
              </div>
              <div class="time">
                <div class="bar clock" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={filled}>
                  <span style:width="{filled}%"></span>
                </div>
                <p class="hint">{full ? 'Cheio' : formatRemaining(left)}</p>
              </div>
              <div class="actions">
                {#if full}
                  <button type="button" class="btn btn-primary" disabled={pending} onclick={() => void renew(card.slotIndex)}>Renovar</button>
                {/if}
                <button type="button" class="btn" disabled={pending} onclick={() => void withdraw(card.slotIndex)}>Retirar</button>
              </div>
            </section>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
  <div class="dock">
    {#if game.devTools && game.daycare.slots.length > 0}
      <div class="dev">
        <button type="button" class="btn" disabled={pending} onclick={() => void advance(1)}>+1h (teste)</button>
        <button type="button" class="btn" disabled={pending} onclick={() => void advance(12)}>+12h (teste)</button>
      </div>
    {/if}
    <button type="button" class="btn" onclick={onClose}>Jardim</button>
  </div>
</div>

<style>
  .daycare {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 0;
    min-width: 0;
  }

  .scroll {
    display: grid;
    align-content: start;
    gap: 0.45rem;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .cards,
  .list,
  .actions,
  .time,
  .dock {
    display: grid;
    gap: 0.4rem;
  }

  .dev {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .card,
  .pick {
    display: grid;
    gap: 0.45rem;
  }

  .head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.6rem;
    align-items: center;
  }

  .portrait {
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
  }

  .portrait img {
    max-width: 80px;
    max-height: 80px;
  }

  .info {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    margin: 0;
  }

  .lv,
  .hint,
  .preview {
    font-weight: 600;
  }

  .hint,
  .preview {
    font-size: 16px;
  }

  .xp {
    display: grid;
    gap: 0.1rem;
  }

  .bar {
    height: 10px;
    background: #00000025;
    box-shadow: inset 0 0 0 var(--px) var(--ink);
  }

  .bar span {
    display: block;
    height: 100%;
    background: #4aa3e0;
    box-shadow: inset 0 calc(var(--px) * -2) 0 #2f7bb0, inset 0 0 0 var(--px) var(--ink);
  }

  .bar.clock span {
    background: var(--accent);
    box-shadow: inset 0 calc(var(--px) * -2) 0 #c79a00, inset 0 0 0 var(--px) var(--ink);
  }

  .xp small {
    font-size: 15px;
  }

  .choice {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: center;
    min-height: 48px;
    padding: 0.25rem 0.4rem;
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
    background: none;
    font: inherit;
    font-weight: 700;
    color: inherit;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
  }

  .choice span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .locked {
    opacity: 0.75;
  }

  .dock .btn,
  .actions .btn,
  .card > .btn,
  .pick > .btn {
    width: 100%;
  }

  .alert {
    margin: 0;
    color: var(--grass-side);
    font-weight: 700;
  }
</style>

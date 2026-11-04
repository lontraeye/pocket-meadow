<script lang="ts">
  import { spriteLoading } from './spriteLoading'
  import { api, errorText, type ApiError, type DaycareSlot, type GameState, type OwnedPokemon } from './api'
  import Highlights from './Highlights.svelte'
  import { xpHighlightCards, type HighlightCard } from './highlights'
  import { serverClock } from './serverClock.svelte'
  import { formatCountdown } from './time'
  import { showdownSrc } from './sprites'
  import { simulateStay } from './daycareSim'

  let { game, onClose, onState }: { game: GameState; onClose: () => void; onState: () => Promise<void> } = $props()

  let pickingSlot = $state<number | null>(null)
  let pickingCaretaker = $state(false)
  let showTiers = $state(false)
  let message = $state('')
  let pending = $state(false)
  let highlightCards = $state<HighlightCard[]>([])

  const byId = $derived(new Map(game.pokemon.map((mon) => [mon.id, mon])))
  const occupied = $derived(new Map(game.daycare.slots.map((slot) => [slot.slotIndex, slot])))
  /** Quem trabalha (bancada ou cuidador) não vai para o daycare. */
  const working = $derived(new Set([game.garden.bench.operatorId, game.daycare.caretaker?.pokemonId].filter((id) => id != null)))
  const garden = $derived(
    game.pokemon
      .filter((mon) => mon.location === 'garden' && !working.has(mon.id))
      .sort((a, b) => b.level - a.level || a.id - b.id),
  )
  // Cuidador (5.21): faixa de cada espécie e quem do jardim pode cuidar agora.
  const tierBySpecies = $derived(
    new Map(game.daycare.caretakerTiers.flatMap((tier) => tier.species.map((sp) => [sp.id, tier] as const))),
  )
  const caretaker = $derived(game.daycare.caretaker ? byId.get(game.daycare.caretaker.pokemonId) ?? null : null)
  const caretakerCandidates = $derived(
    game.pokemon
      .filter(
        (mon) =>
          mon.location === 'garden' &&
          mon.teamSlot === null &&
          mon.id !== game.garden.bench.operatorId &&
          mon.id !== game.daycare.caretaker?.pokemonId &&
          tierBySpecies.has(mon.speciesId),
      )
      .sort((a, b) => (tierBySpecies.get(b.speciesId)?.mult ?? 0) - (tierBySpecies.get(a.speciesId)?.mult ?? 0)),
  )
  /** Prévia de quem ainda vai entrar: uma estadia cheia com o time e o cuidador de agora. */
  function stayPreview(mon: OwnedPokemon): { level: number; xpGained: number } {
    return simulateStay(mon.level, mon.xp, game.daycare.rules, game.daycare.context)
  }
  /** Retrato do PMD Sprite Collab (só das espécies que cuidam do daycare). */
  const portraitSrc = (speciesId: number) => `/sprites/pmd-portrait/${speciesId}.png`

  async function pickCaretaker(id: number | null) {
    const ok = await run('/api/daycare/caretaker', { pokemonId: id })
    if (ok) {
      pickingCaretaker = false
      message = id === null ? 'O daycare ficou sem cuidador.' : ''
    }
  }

  type Card =
    | { kind: 'locked'; slotIndex: number; opensAt: string }
    | { kind: 'empty'; slotIndex: number }
    | { kind: 'filled'; slotIndex: number; slot: DaycareSlot; mon: OwnedPokemon }

  const cards = $derived.by(() => {
    const list: Card[] = []
    // Uma vaga que fechou (abria pelo nível antes dos marcos) com alguém dentro
    // continua aparecendo, para dar para tirar; vazia, some.
    const shown = Math.max(game.daycare.slotsUnlocked, ...game.daycare.slots.map((slot) => slot.slotIndex + 1))
    for (let i = 0; i < shown; i += 1) {
      const slot = occupied.get(i)
      const mon = slot ? byId.get(slot.pokemonId) : undefined
      if (slot && mon) list.push({ kind: 'filled', slotIndex: i, slot, mon })
      else if (i < game.daycare.slotsUnlocked) list.push({ kind: 'empty', slotIndex: i })
    }
    if (game.daycare.nextSlotAt !== null) {
      list.push({ kind: 'locked', slotIndex: shown, opensAt: game.daycare.nextSlotAt.name })
    }
    return list
  })

  const clock = serverClock(() => game.now)

  function remainingMs(fullAt: number): number {
    return Math.max(0, fullAt - clock.now())
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
    const card = cards.find((row) => row.kind === 'filled' && row.slotIndex === slotIndex)
    const mon = card && card.kind === 'filled' ? card.mon : null
    const result = await run(`/api/daycare/${slotIndex}`, undefined, 'DELETE')
    if (!result) return
    const xp = Number(result.xpGained ?? 0)
    const levels = Number(result.levelsGained ?? 0)
    const level = Number(result.level ?? mon?.level ?? 0)
    const before = level - levels
    if (levels > 0 && mon) {
      highlightCards = xpHighlightCards({
        name: mon.nickname ?? mon.displayName,
        xpGained: xp,
        levelsGained: levels,
        level,
        canEvolve: mon.evolutions.some((option) => before < option.minLevel && level >= option.minLevel),
      })
    } else {
      message = `+${xp} XP · +${levels} nível${levels === 1 ? '' : 's'}`
    }
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
    {#if highlightCards.length > 0}
      <section class="panel">
        <Highlights cards={highlightCards} onDone={() => (highlightCards = [])} />
      </section>
    {/if}
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
              {@const stay = stayPreview(mon)}
              <button type="button" class="choice" disabled={pending} onclick={() => void place(pickingSlot!, mon.id)}>
                <img use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" width="64" height="64" />
                <span>{mon.nickname ?? mon.displayName}</span>
                <small>Nv {mon.level} → {stay.level}</small>
              </button>
            {/each}
          </div>
        {/if}
        <button type="button" class="btn" disabled={pending} onclick={() => (pickingSlot = null)}>Cancelar</button>
      </section>
    {:else if pickingCaretaker}
      <section class="panel pick" aria-label="Escolher cuidador">
        <h2>Quem cuida do daycare</h2>
        {#if caretakerCandidates.length === 0}
          <p class="hint">Nenhum Pokémon do jardim (fora do time) pode cuidar agora. Veja a lista de quem pode.</p>
        {:else}
          <div class="list">
            {#each caretakerCandidates as mon (mon.id)}
              {@const tier = tierBySpecies.get(mon.speciesId)}
              <button type="button" class="choice" disabled={pending} onclick={() => void pickCaretaker(mon.id)}>
                <img class="portrait-pmd" src={portraitSrc(mon.speciesId)} alt="" width="80" height="80" />
                <span>{mon.nickname ?? mon.displayName}</span>
                <small>{tier?.name} · ×{tier?.mult}</small>
              </button>
            {/each}
          </div>
        {/if}
        <button type="button" class="btn" disabled={pending} onclick={() => (pickingCaretaker = false)}>Cancelar</button>
      </section>
    {:else}
      <section class="panel keeper" aria-label="Cuidador">
        {#if caretaker && game.daycare.caretaker}
          <!-- Retrato do PMD Sprite Collab (40×40, em 2×). -->
          <img class="portrait-pmd" src={portraitSrc(caretaker.speciesId)} alt="" width="80" height="80" />
          <div class="keeper-info">
            <strong>{caretaker.nickname ?? caretaker.displayName} cuida do daycare</strong>
            <small>{game.daycare.caretaker.tierName} · ×{game.daycare.caretaker.mult} de XP</small>
          </div>
          <div class="keeper-actions">
            <button type="button" class="btn" disabled={pending} onclick={() => (pickingCaretaker = true)}>Trocar</button>
            <button type="button" class="btn" disabled={pending} onclick={() => void pickCaretaker(null)}>Tirar</button>
          </div>
        {:else}
          <div class="keeper-info">
            <strong>Sem cuidador</strong>
            <small>Um Pokémon que cuida dos outros acelera o daycare (até ×2).</small>
          </div>
          <div class="keeper-actions">
            <button type="button" class="btn btn-primary" disabled={pending} onclick={() => (pickingCaretaker = true)}>Escolher</button>
          </div>
        {/if}
        <button type="button" class="link" onclick={() => (showTiers = !showTiers)}>
          {showTiers ? 'Esconder' : 'Quem pode cuidar?'}
        </button>
        {#if showTiers}
          <ul class="tiers">
            {#each game.daycare.caretakerTiers as tier (tier.key)}
              <li><strong>{tier.name} ×{tier.mult}:</strong> {tier.species.map((sp) => sp.name).join(', ')}</li>
            {/each}
          </ul>
        {/if}
      </section>
      <div class="cards">
        {#each cards as card (card.slotIndex)}
          {#if card.kind === 'locked'}
            <section class="panel card locked">
              <h2>Slot {card.slotIndex + 1}</h2>
              <p class="hint">Abre no {card.opensAt}</p>
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
                  <img use:spriteLoading={showdownSrc(card.mon.speciesId, card.mon.isShiny)} src={showdownSrc(card.mon.speciesId, card.mon.isShiny)} alt="" />
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
                  {#if card.slot.projected.xpGained > 0}
                    <p class="preview">
                      Ao fim: Nv {card.slot.projected.level} (+{card.slot.projected.xpGained.toLocaleString('pt-BR')} XP)
                    </p>
                  {/if}
                </div>
              </div>
              <div class="time">
                <div class="bar clock" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={filled}>
                  <span style:width="{filled}%"></span>
                </div>
                <p class="hint">{full ? 'Cheio' : formatCountdown(left)}</p>
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
  .keeper {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .portrait-pmd {
    image-rendering: pixelated;
    border: 2px solid var(--panel-edge, #2b2b2b);
    background: #f4efe0;
  }

  .keeper-info {
    display: grid;
    flex: 1;
    min-width: 10rem;
  }

  .keeper-info small {
    opacity: 0.8;
  }

  .keeper-actions {
    display: flex;
    gap: 0.35rem;
  }

  .keeper-actions .btn {
    min-height: 44px;
  }

  .link {
    width: 100%;
    min-height: 32px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    text-decoration: underline;
    color: inherit;
    cursor: pointer;
  }

  .tiers {
    display: grid;
    gap: 0.25rem;
    width: 100%;
    margin: 0;
    padding-left: 1rem;
    font-size: 0.85rem;
  }

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
    padding-right: 10px;
    scrollbar-gutter: stable;
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
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
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
    box-shadow: inset 0 calc(var(--px) * -2) 0 var(--accent-shade), inset 0 0 0 var(--px) var(--ink);
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
    padding: 0.35rem 0.5rem;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
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

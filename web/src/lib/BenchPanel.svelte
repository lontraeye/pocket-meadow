<script lang="ts">
  // Bancada de bolas (PLANNING.md, seção 5.23): escolher o operador, pôr os
  // Apricorns num lote, coletar as Poké Balls prontas e cancelar.
  import { api, errorText, type ApiError, type GameState } from './api'
  import { benchDone } from './benchJob'
  import { serverClock } from './serverClock.svelte'
  import { play } from './sound'
  import { spriteLoading } from './spriteLoading'
  import { showdownSrc } from './sprites'
  import { formatClockTime, formatCountdown } from './time'
  import { typeLabelPt } from './typesPt'

  let { game, onState, onClose }: { game: GameState; onState: () => Promise<void>; onClose: () => void } = $props()

  const clock = serverClock(() => game.now)
  const bench = $derived(game.garden.bench)
  const operator = $derived(game.pokemon.find((mon) => mon.id === bench.operatorId) ?? null)
  const apricorns = $derived(game.inventory.find((row) => row.itemKey === 'mat:apricorn')?.quantity ?? 0)
  const maxQuantity = $derived(Math.min(bench.batchSize, apricorns))
  /** Poké Balls de cada Apricorn. */
  const per = $derived(bench.ballsPerApricorn)
  const ballsText = (n: number) => `${n} ${n === 1 ? 'Poké Ball' : 'Poké Balls'}`
  /** Quem pode operar: do jardim, fora do time, de um dos tipos aceitos. */
  const candidates = $derived(
    game.pokemon.filter(
      (mon) =>
        mon.location === 'garden' &&
        mon.teamSlot === null &&
        mon.id !== bench.operatorId &&
        (bench.operatorTypes.includes(mon.type1) || (mon.type2 !== null && bench.operatorTypes.includes(mon.type2))),
    ),
  )
  const typesText = $derived(bench.operatorTypes.map(typeLabelPt).join(', ').replace(/, ([^,]*)$/, ' ou $1'))

  let quantity = $state(1)
  let choosing = $state(false)
  let pending = $state(false)
  let message = $state('')

  $effect(() => {
    // Começa no máximo possível (o lote cheio quando dá).
    if (quantity > maxQuantity || quantity < 1) quantity = Math.max(1, maxQuantity)
  })

  /** Tempo de cada bola com a felicidade de agora (o servidor fixa ao começar). */
  const unitMs = $derived(
    Math.round(bench.unitMs * (1 - (bench.speedBonus * Math.max(0, Math.min(100, operator?.pet.happiness ?? 0))) / 100)),
  )

  async function call(path: string, body: unknown, done: (result: Record<string, number>) => string) {
    pending = true
    message = ''
    try {
      const response = await api(path, body)
      if (!response.ok) {
        message = errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError)
        return
      }
      message = done((await response.json()) as Record<string, number>)
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  function pick(id: number | null) {
    choosing = false
    void call('/api/garden/bench/operator', { pokemonId: id }, () => (id === null ? 'A bancada ficou sem operador.' : ''))
  }

  function start() {
    play('tap')
    void call('/api/garden/bench/start', { quantity }, () => '')
  }

  function collect() {
    play('harvest')
    void call('/api/garden/bench/collect', {}, (body) => `Coletou ${body.balls} ${body.balls === 1 ? 'Poké Ball' : 'Poké Balls'}!`)
  }

  function cancel() {
    void call('/api/garden/bench/cancel', {}, (body) =>
      [
        body.balls > 0 ? `${body.balls} ${body.balls === 1 ? 'Poké Ball coletada' : 'Poké Balls coletadas'}` : '',
        body.refunded > 0 ? `${body.refunded} ${body.refunded === 1 ? 'Apricorn devolvido' : 'Apricorns devolvidos'}` : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'Lote cancelado.',
    )
  }
</script>

<div class="bench">
  <header class="head">
    <h2>Bancada de bolas</h2>
    <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
  </header>
  <p class="hint">Cada Apricorn vira {per === 1 ? 'uma Poké Ball' : `${per} Poké Balls`}. Até {bench.batchSize} Apricorns por lote.</p>

  <section class="panel block">
    <h3>Operador</h3>
    {#if operator && !choosing}
      <div class="operator">
        <img use:spriteLoading={showdownSrc(operator.speciesId, operator.isShiny)} src={showdownSrc(operator.speciesId, operator.isShiny)} alt="" />
        <div>
          <strong>{operator.nickname ?? operator.displayName}</strong>
          <small>Felicidade {Math.round(operator.pet.happiness)} · −{Math.round((1 - unitMs / bench.unitMs) * 100)}% de tempo</small>
        </div>
      </div>
      {#if !bench.job}
        <div class="row">
          <button type="button" class="btn" disabled={pending} onclick={() => (choosing = true)}>Trocar</button>
          <button type="button" class="btn" disabled={pending} onclick={() => pick(null)}>Tirar</button>
        </div>
      {/if}
    {:else}
      <p class="hint">Precisa de um Pokémon do jardim, fora do time, do tipo {typesText}. Feliz, ele trabalha mais rápido.</p>
      {#if candidates.length === 0}
        <p class="hint">Nenhum Pokémon assim no jardim agora.</p>
      {:else}
        <ul class="choices">
          {#each candidates as mon (mon.id)}
            <li>
              <button type="button" class="btn choice" disabled={pending} onclick={() => pick(mon.id)}>
                <img use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" loading="lazy" />
                <span>{mon.nickname ?? mon.displayName}</span>
                <small>Lv {mon.level}</small>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if choosing}
        <button type="button" class="btn" onclick={() => (choosing = false)}>Voltar</button>
      {/if}
    {/if}
  </section>

  <section class="panel block">
    <h3>Lote</h3>
    {#if bench.job}
      {@const job = bench.job}
      {@const now = clock.now()}
      {@const done = benchDone(job, now)}
      {@const ready = (done - job.collected) * per}
      {@const endsAt = job.startedAt + job.quantity * job.unitMs}
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={job.quantity} aria-valuenow={done}>
        <span style:width="{(done / job.quantity) * 100}%"></span>
        <b>{done * per}/{job.quantity * per} Poké Balls</b>
      </div>
      <p class="hint">
        {#if done < job.quantity}
          Próxima em {formatCountdown(job.startedAt + (done + 1) * job.unitMs - now)} · lote pronto às {formatClockTime(endsAt)}
        {:else}
          Lote pronto!
        {/if}
      </p>
      <div class="row">
        <button type="button" class="btn btn-primary" disabled={pending || ready <= 0} onclick={collect}>
          Coletar{ready > 0 ? ` (${ready})` : ''}
        </button>
        {#if done < job.quantity}
          <button type="button" class="btn" disabled={pending} onclick={cancel}>Cancelar</button>
        {/if}
      </div>
    {:else if !operator}
      <p class="hint">Escolha um operador para começar.</p>
    {:else if apricorns === 0}
      <p class="hint">Sem Apricorns. Colha na árvore ao lado.</p>
    {:else}
      <p class="hint">Apricorns na mochila: {apricorns}</p>
      <div class="stepper">
        <button type="button" class="btn" aria-label="Menos" disabled={quantity <= 1} onclick={() => (quantity -= 1)}>−</button>
        <strong>{quantity} {quantity === 1 ? 'Apricorn' : 'Apricorns'} → {ballsText(quantity * per)}</strong>
        <button type="button" class="btn" aria-label="Mais" disabled={quantity >= maxQuantity} onclick={() => (quantity += 1)}>+</button>
      </div>
      <p class="hint">Pronto às {formatClockTime(clock.now() + quantity * unitMs)} ({formatCountdown(quantity * unitMs)})</p>
      <button type="button" class="btn btn-primary" disabled={pending} onclick={start}>Começar</button>
    {/if}
  </section>

  {#if message}<p class="message" role="status">{message}</p>{/if}
</div>

<style>
  .bench {
    display: grid;
    gap: 0.6rem;
    width: min(100%, 26rem);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  .close {
    min-width: 44px;
    padding-left: 0.45rem;
    padding-right: 0.45rem;
  }

  .hint,
  .message {
    margin: 0;
    font-size: 0.9rem;
  }

  .hint {
    opacity: 0.75;
  }

  .block {
    display: grid;
    gap: 0.45rem;
    padding: 0.6rem;
  }

  .operator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .operator img,
  .choice img {
    width: 40px;
    height: 40px;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .operator div {
    display: grid;
  }

  .operator small {
    opacity: 0.75;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .row .btn,
  .stepper .btn {
    min-height: 44px;
  }

  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    min-height: 44px;
    text-align: left;
  }

  .choice span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .stepper .btn {
    min-width: 44px;
  }

  .bar {
    position: relative;
    height: 16px;
    border: 2px solid var(--panel-edge, #2b2b2b);
    border-radius: 4px;
    background: #e6e2d6;
    overflow: hidden;
  }

  .bar span {
    position: absolute;
    inset: 0 auto 0 0;
    background: #6fc46a;
  }

  .bar b {
    position: relative;
    display: block;
    font-size: 0.75rem;
    line-height: 12px;
    text-align: center;
  }
</style>

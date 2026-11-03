<script lang="ts">
  // Bancada de bolas (PLANNING.md, seção 5.23): o nível, o operador, a receita
  // (Poké, Great e Ultra Ball, cada uma com o seu Apricorn), o lote com coletar
  // e cancelar, e a melhoria para o próximo nível (leva tempo; parada enquanto isso).
  import { api, ballIconSrc, errorText, giftIconSrc, itemLabel, type ApiError, type GameState } from './api'
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
  const have = (itemKey: string) => game.inventory.find((row) => row.itemKey === itemKey)?.quantity ?? 0
  const ballName = (itemKey: string) => game.balls.list.find((ball) => ball.itemKey === itemKey)?.displayName ?? itemKey
  const ballIcon = (itemKey: string) => {
    const ball = game.balls.list.find((row) => row.itemKey === itemKey)
    return ball ? ballIconSrc(ball.sprite) : giftIconSrc(itemKey)
  }
  const ballsText = (itemKey: string, n: number) => `${n} ${ballName(itemKey)}${n === 1 ? '' : 's'}`

  let recipeKey = $state('poke_ball')
  const recipe = $derived(bench.recipes.find((row) => row.key === recipeKey && row.unlocked) ?? bench.recipes[0]!)
  const apricorns = $derived(have(recipe.input))
  const maxQuantity = $derived(Math.min(bench.batchSize, apricorns))

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

  /** Fração de tempo que o operador tira (felicidade de agora; o servidor fixa ao começar). */
  const operatorCut = $derived(bench.speedBonus * Math.max(0, Math.min(100, operator?.pet.happiness ?? 0)) / 100)
  const unitMs = $derived(Math.round(recipe.unitMs * (1 - operatorCut)))
  const trainerLevel = $derived(game.trainer.level)

  async function call(path: string, body: unknown, done: (result: Record<string, number | string>) => string) {
    pending = true
    message = ''
    try {
      const response = await api(path, body)
      if (!response.ok) {
        message = errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError)
        return
      }
      message = done((await response.json()) as Record<string, number | string>)
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
    void call('/api/garden/bench/start', { recipeKey: recipe.key, quantity }, () => '')
  }

  function collect() {
    play('harvest')
    void call('/api/garden/bench/collect', {}, (body) => `Coletou ${ballsText(String(body.itemKey), Number(body.balls))}!`)
  }

  function cancel() {
    void call('/api/garden/bench/cancel', {}, (body) => {
      const balls = Number(body.balls)
      const refunded = Number(body.refunded)
      return (
        [
          balls > 0 ? `${ballsText(String(body.itemKey), balls)} ${balls === 1 ? 'coletada' : 'coletadas'}` : '',
          refunded > 0 ? `${refunded} ${refunded === 1 ? 'Apricorn devolvido' : 'Apricorns devolvidos'}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || 'Lote cancelado.'
      )
    })
  }

  function upgrade() {
    play('levelup')
    void call('/api/garden/bench/upgrade', {}, (body) => `Melhorando para o nível ${body.toLevel}.`)
  }
</script>

<div class="bench">
  <header class="head">
    <h2>Bancada de bolas</h2>
    <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
  </header>
  <p class="level">
    Nível {bench.level} de {bench.maxLevel} · até {bench.batchSize} Apricorns por lote
  </p>

  <section class="panel block">
    <h3>Operador</h3>
    {#if operator && !choosing}
      <div class="operator">
        <img use:spriteLoading={showdownSrc(operator.speciesId, operator.isShiny)} src={showdownSrc(operator.speciesId, operator.isShiny)} alt="" />
        <div>
          <strong>{operator.nickname ?? operator.displayName}</strong>
          <small>Felicidade {Math.round(operator.pet.happiness)} · −{Math.round(operatorCut * 100)}% de tempo</small>
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
    {#if bench.upgrade}
      <p class="hint">Parada enquanto é melhorada.</p>
    {:else if bench.job}
      {@const job = bench.job}
      {@const now = clock.now()}
      {@const done = benchDone(job, now)}
      {@const ready = (done - job.collected) * job.perUnit}
      {@const endsAt = job.startedAt + job.quantity * job.unitMs}
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={job.quantity} aria-valuenow={done}>
        <span style:width="{(done / job.quantity) * 100}%"></span>
        <b>{done * job.perUnit}/{job.quantity * job.perUnit} {ballName(job.output)}s</b>
      </div>
      <p class="hint">
        {#if done < job.quantity}
          Próximo Apricorn em {formatCountdown(job.startedAt + (done + 1) * job.unitMs - now)} · lote pronto às {formatClockTime(endsAt)}
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
    {:else}
      <div class="recipes" role="radiogroup" aria-label="Receita">
        {#each bench.recipes as row (row.key)}
          <button
            type="button"
            class="btn recipe"
            role="radio"
            aria-checked={recipe.key === row.key}
            class:selected={recipe.key === row.key}
            disabled={!row.unlocked}
            onclick={() => (recipeKey = row.key)}
          >
            <img src={ballIcon(row.output)} alt="" width="24" height="24" />
            <span>{ballName(row.output)}</span>
            {#if row.unlocked}
              <small><img src={giftIconSrc(row.input)} alt="" width="14" height="14" /> ×{have(row.input)}</small>
            {:else}
              <small>bancada nível {row.minBenchLevel}</small>
            {/if}
          </button>
        {/each}
      </div>
      {#if !operator}
        <p class="hint">Escolha um operador para começar.</p>
      {:else if apricorns === 0}
        <p class="hint">Sem {itemLabel(recipe.input, game.berries)}. Colha na árvore.</p>
      {:else}
        <div class="stepper">
          <button type="button" class="btn" aria-label="Menos" disabled={quantity <= 1} onclick={() => (quantity -= 1)}>−</button>
          <strong>{quantity} {itemLabel(recipe.input, game.berries)} → {ballsText(recipe.output, quantity * recipe.perUnit)}</strong>
          <button type="button" class="btn" aria-label="Mais" disabled={quantity >= maxQuantity} onclick={() => (quantity += 1)}>+</button>
        </div>
        <p class="hint">Pronto às {formatClockTime(clock.now() + quantity * unitMs)} ({formatCountdown(quantity * unitMs)})</p>
        <button type="button" class="btn btn-primary" disabled={pending} onclick={start}>Começar</button>
      {/if}
    {/if}
  </section>

  <section class="panel block">
    <h3>Melhorar</h3>
    {#if bench.upgrade}
      {@const now = clock.now()}
      {@const total = Math.max(1, bench.upgrade.endsAt - bench.upgrade.startedAt)}
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(((now - bench.upgrade.startedAt) / total) * 100)}>
        <span style:width="{Math.min(100, ((now - bench.upgrade.startedAt) / total) * 100)}%"></span>
        <b>Nível {bench.upgrade.toLevel}</b>
      </div>
      <p class="hint">Pronta em {formatCountdown(bench.upgrade.endsAt - now)} (às {formatClockTime(bench.upgrade.endsAt)})</p>
    {:else if bench.next}
      {@const next = bench.next}
      {@const enoughLevel = trainerLevel >= next.trainerLevel}
      {@const enoughItems = next.cost.every((item) => item.have >= item.quantity)}
      <p class="hint">
        Nível {next.level}: lote de {next.batchSize}, {Math.round((1 - next.speed) * 100)}% mais rápida{next.newRecipes.length > 0
          ? ` e libera ${next.newRecipes
              .map((key) => ballName(bench.recipes.find((row) => row.key === key)?.output ?? key))
              .join(' e ')}`
          : ''}.
      </p>
      <ul class="cost">
        {#each next.cost as item (item.itemKey)}
          <li class:short={item.have < item.quantity}>
            <img src={giftIconSrc(item.itemKey)} alt="" width="20" height="20" />
            <span>{itemLabel(item.itemKey, game.berries)}</span>
            <strong>{Math.min(item.have, item.quantity)}/{item.quantity}</strong>
          </li>
        {/each}
        <li class:short={!enoughLevel}>
          <span>Nível de treinador</span>
          <strong>{trainerLevel}/{next.trainerLevel}</strong>
        </li>
      </ul>
      <p class="hint">Leva {formatCountdown(next.ms)}; a bancada fica parada enquanto isso.</p>
      <button
        type="button"
        class="btn btn-primary"
        disabled={pending || !enoughLevel || !enoughItems || bench.job !== null}
        onclick={upgrade}
      >
        Melhorar
      </button>
      {#if bench.job}<p class="hint">Termine ou cancele o lote antes.</p>{/if}
    {:else}
      <p class="hint">A bancada está no nível máximo.</p>
    {/if}
  </section>

  {#if game.devTools}
    <button
      type="button"
      class="btn"
      disabled={pending}
      onclick={() => void call('/api/dev/bench/boost', {}, () => 'Teste: nível 12, Apricorns e berries; melhoria terminada.')}
    >
      Itens e nível (teste)
    </button>
  {/if}

  {#if message}<p class="message" role="status">{message}</p>{/if}
</div>

<style>
  .level {
    margin: 0;
    font-weight: 700;
  }

  .recipes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.35rem;
  }

  .recipe {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    min-height: 44px;
    padding: 0.35rem 0.25rem;
    font-size: 0.85rem;
  }

  .recipe.selected {
    outline: 3px solid var(--accent, #3a7bd5);
    outline-offset: -3px;
  }

  .recipe img {
    image-rendering: pixelated;
  }

  .recipe small {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0.8;
  }

  .cost {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .cost li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .cost li span {
    flex: 1;
  }

  .cost li img {
    image-rendering: pixelated;
  }

  .cost li.short strong {
    color: #c0392b;
  }

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

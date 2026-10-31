<script lang="ts">
  import { api, errorText, giftIconSrc, itemLabel, type ApiError, type GameState, type MissionReward } from './api'
  import { serverClock } from './serverClock.svelte'
  import { play } from './sound'
  import { formatCountdown } from './time'

  // Quadro de missões diárias (PLANNING.md, seção 5.20): as 3 do dia, o baú e
  // a troca de uma missão. O servidor confere o progresso e entrega o prêmio.
  let { game, onState, onClose }: { game: GameState; onState: () => Promise<void>; onClose: () => void } = $props()

  const clock = serverClock(() => game.now)
  const missions = $derived(game.missions)
  let pending = $state(false)
  let message = $state('')

  function rewardParts(reward: MissionReward): { icon: string | null; text: string }[] {
    const parts: { icon: string | null; text: string }[] = [{ icon: null, text: `${reward.trainerXp} XP` }]
    if (reward.genericCandies > 0) parts.push({ icon: giftIconSrc('generic_candy'), text: `${reward.genericCandies}` })
    for (const item of reward.items) parts.push({ icon: giftIconSrc(item.itemKey), text: `${item.quantity}` })
    if (reward.randomSeed) parts.push({ icon: null, text: '+ semente' })
    return parts
  }

  type Granted = { granted: { trainerXp: number; genericCandies: number; items: { itemKey: string; quantity: number }[]; trainer: { level: number; levelsGained: number } } }

  async function call(url: string, done: (body: Granted) => string) {
    pending = true
    message = ''
    try {
      const response = await api(url, {})
      const body = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & Granted
      if (!response.ok) {
        message = errorText(body)
        return
      }
      message = done(body)
      await onState()
    } finally {
      pending = false
    }
  }

  function grantedText(body: Granted): string {
    const g = body.granted
    const items = g.items.map((item) => `${item.quantity} ${itemLabel(item.itemKey, game.berries, game.balls.list)}`)
    const parts = [`${g.trainerXp} XP de treinador`, g.genericCandies > 0 ? `${g.genericCandies} doces genéricos` : '', ...items].filter(Boolean)
    const level = g.trainer.levelsGained > 0 ? ` Subiu para o nível ${g.trainer.level}!` : ''
    return `Ganhou ${parts.join(', ')}.${level}`
  }

  function claim(id: number) {
    play('levelup')
    void call(`/api/missions/${id}/claim`, grantedText)
  }

  function openChest() {
    play('levelup')
    void call('/api/missions/chest/claim', (body) => `Baú aberto! ${grantedText(body)}`)
  }

  function reroll(id: number) {
    void call(`/api/missions/${id}/reroll`, () => 'Missão trocada.')
  }
</script>

<div class="board">
  <header class="head">
    <h2>Missões do dia</h2>
    <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
  </header>
  <p class="renew">Novas em {formatCountdown(Math.max(0, missions.renewsAt - clock.now()))}</p>

  <ul class="list">
    {#each missions.list as mission (mission.id)}
      <li class="mission panel" class:done={mission.done} class:claimed={mission.claimed}>
        <p class="text">{mission.text}</p>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={mission.target} aria-valuenow={mission.progress}>
          <span style:width="{(mission.progress / mission.target) * 100}%"></span>
          <b>{mission.progress}/{mission.target}</b>
        </div>
        <div class="foot">
          <span class="reward">
            {#each rewardParts(mission.reward) as part, index (index)}
              <span class="part">{#if part.icon}<img src={part.icon} alt="" />{/if}{part.text}</span>
            {/each}
          </span>
          {#if mission.claimed}
            <span class="tag">Resgatada ✓</span>
          {:else if mission.done}
            <button type="button" class="btn btn-primary" disabled={pending} onclick={() => claim(mission.id)}>Resgatar</button>
          {:else if missions.rerollsLeft > 0}
            <button type="button" class="btn" disabled={pending} onclick={() => reroll(mission.id)}>Trocar</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <section class="chest panel" class:ready={missions.chest.ready}>
    <div>
      <h3>Baú do dia</h3>
      <p>
        {#if missions.chest.claimed}
          Aberto hoje. Volte amanhã!
        {:else if missions.chest.ready}
          Pronto para abrir!
        {:else}
          Resgate as 3 missões para abrir.
        {/if}
      </p>
      <span class="reward">
        {#each rewardParts(missions.chest.reward) as part, index (index)}
          <span class="part">{#if part.icon}<img src={part.icon} alt="" />{/if}{part.text}</span>
        {/each}
      </span>
    </div>
    {#if missions.chest.ready}
      <button type="button" class="btn btn-primary" disabled={pending} onclick={openChest}>Abrir</button>
    {/if}
  </section>

  {#if message}<p class="message" role="status">{message}</p>{/if}
  <p class="hint">Só conta o que você fizer depois de a missão aparecer. Dá para trocar uma missão por dia.</p>
</div>

<style>
  .board {
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

  .renew,
  .hint,
  .chest p {
    margin: 0;
    font-size: 0.9rem;
  }

  .hint {
    opacity: 0.75;
  }

  .list {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .mission {
    display: grid;
    gap: 0.35rem;
  }

  .mission.claimed {
    opacity: 0.6;
  }

  .text {
    margin: 0;
    font-weight: 700;
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

  .mission.done .bar span {
    background: #f2c94c;
  }

  .bar b {
    position: relative;
    display: block;
    font-size: 0.75rem;
    line-height: 12px;
    text-align: center;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .reward {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .part {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
  }

  .part img {
    width: 18px;
    height: 18px;
    image-rendering: pixelated;
  }

  .tag {
    font-weight: 700;
    font-size: 0.9rem;
  }

  .chest {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .chest > div {
    display: grid;
    gap: 0.25rem;
  }

  .chest.ready {
    outline: 2px solid #f2c94c;
  }

  .message {
    margin: 0;
    font-weight: 700;
  }
</style>

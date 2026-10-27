<script lang="ts">
  import { spriteLoading } from './spriteLoading'
  import type { BattleOutcome, OwnedPokemon, PendingEncounter } from './api'
  import { catchShakes, pokeBallSrc, prefersReducedMotion } from './highlights'
  import PmdSprite from './PmdSprite.svelte'
  import { gardenSprite, pmdAnim, showdownSrc } from './sprites'

  let {
    encounter,
    battle,
    team,
    time = 0,
    ballSrc = pokeBallSrc(),
    onDone,
  }: {
    encounter: PendingEncounter
    battle: BattleOutcome
    team: OwnedPokemon[]
    time?: number
    /** Sprite da bola usada. Hoje só a Poké Ball; os outros tipos vêm com a seção 5.6. */
    ballSrc?: string
    onDone: () => void
  } = $props()

  type Phase = 'clash' | 'outcome' | 'throw' | 'shake' | 'celebrate' | 'escape' | 'done'

  const reduced = prefersReducedMotion()
  const shakeTotal = $derived(battle.won ? catchShakes(battle.caught, battle.catchChance) : 0)
  const lead = $derived(team[0] ?? null)

  let phase = $state<Phase>(reduced ? 'done' : 'clash')
  let shakeIndex = $state(0)
  let finished = $state(false)

  const wildLook = $derived(gardenSprite(encounter.speciesId, encounter.isShiny))
  const allyLook = $derived(lead ? gardenSprite(lead.speciesId, lead.isShiny) : null)

  $effect(() => {
    if (reduced) {
      finish()
      return
    }
    const timers: number[] = []
    const wait = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms))
    }

    // Timeline ~3s no máximo, avançando por timer (não por animationend).
    wait(550, () => {
      if (finished) return
      if (!battle.won) {
        phase = 'outcome'
        wait(700, finish)
        return
      }
      phase = 'throw'
      wait(450, () => {
        if (finished) return
        phase = 'shake'
        shakeIndex = 0
        runShakes(0)
      })
    })

    function runShakes(index: number) {
      if (finished) return
      shakeIndex = index
      if (index + 1 >= shakeTotal) {
        wait(380, () => {
          if (finished) return
          if (battle.caught) {
            phase = 'celebrate'
            wait(650, finish)
          } else {
            phase = 'escape'
            wait(550, finish)
          }
        })
        return
      }
      wait(380, () => runShakes(index + 1))
    }

    return () => {
      for (const id of timers) window.clearTimeout(id)
    }
  })

  function finish() {
    if (finished) return
    finished = true
    phase = 'done'
    onDone()
  }

  function skip() {
    finish()
  }
</script>

<!--
  Campo clássico: o seu Pokémon embaixo à esquerda olhando ↗ (linha 3 da folha
  PMD), o selvagem em cima à direita olhando ↙ (linha 7). Cada lado tem duas
  camadas: .side cuida da posição (aproximar, recuar, sumir) e .body da reação
  (tremer ao levar dano), para uma animação não sobrescrever a outra.
-->
<button type="button" class="scene" class:clash={phase === 'clash'} onclick={skip} aria-label="Cena de batalha. Toque para pular">
  <div class="field">
    <div
      class="side wild"
      class:out={phase === 'throw' || phase === 'shake' || phase === 'celebrate'}
      class:back={phase === 'escape'}
    >
      <div class="body" class:hurt={battle.won && phase === 'clash'}>
        {#if wildLook.kind === 'pmd' && pmdAnim(encounter.speciesId, wildLook.shinySheet, 'Idle')}
          <div class="anchor">
            <PmdSprite
              speciesId={encounter.speciesId}
              shiny={wildLook.shinySheet}
              anim="Idle"
              dir={7}
              scale={2}
              {time}
              shadow={wildLook.shadow}
            />
          </div>
        {:else}
          <img class="gif" use:spriteLoading={showdownSrc(encounter.speciesId, encounter.isShiny)} src={showdownSrc(encounter.speciesId, encounter.isShiny)} alt="" />
        {/if}
      </div>
    </div>

    <div class="side ally" class:retreat={phase === 'outcome' && !battle.won}>
      <div class="body" class:hurt={!battle.won && phase === 'clash'}>
        {#if lead && allyLook}
          {#if allyLook.kind === 'pmd' && pmdAnim(lead.speciesId, allyLook.shinySheet, 'Idle')}
            <div class="anchor">
              <PmdSprite
                speciesId={lead.speciesId}
                shiny={allyLook.shinySheet}
                anim="Idle"
                dir={3}
                scale={2}
                {time}
                shadow={allyLook.shadow}
              />
            </div>
          {:else}
            <img class="gif flip" use:spriteLoading={showdownSrc(lead.speciesId, lead.isShiny)} src={showdownSrc(lead.speciesId, lead.isShiny)} alt="" />
          {/if}
        {/if}
      </div>
    </div>

    {#if phase === 'throw' || phase === 'shake' || phase === 'celebrate'}
      <div class="ball">
        <!-- Recriar a imagem a cada chacoalhada faz o navegador repetir a animação. -->
        {#key shakeIndex}
          <img
            src={ballSrc}
            alt=""
            width="32"
            height="32"
            class:wiggle={phase === 'shake'}
            class:click={phase === 'celebrate'}
          />
        {/key}
        {#if phase === 'celebrate'}
          <span class="confetti c1"></span>
          <span class="confetti c2"></span>
          <span class="confetti c3"></span>
          <span class="confetti c4"></span>
          <span class="confetti c5"></span>
          <span class="confetti c6"></span>
        {/if}
      </div>
    {/if}
  </div>

  {#if phase === 'outcome' && !battle.won}
    <p class="banner bad">Derrota</p>
  {:else if phase === 'celebrate'}
    <p class="banner good">Capturado!</p>
  {:else if phase === 'escape'}
    <p class="banner">Escapou!</p>
  {:else if phase === 'shake'}
    <p class="banner">{'…'.repeat(shakeIndex + 1)}</p>
  {:else}
    <p class="banner soft">Toque para pular</p>
  {/if}
</button>

<style>
  .scene {
    display: grid;
    gap: 0.25rem;
    width: 100%;
    margin: 0;
    padding: 0.5rem;
    border: 0;
    background: #00000010;
    box-shadow: inset 0 0 0 var(--px) #00000018;
    color: inherit;
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .field {
    position: relative;
    height: 11rem;
    overflow: hidden;
  }

  .side {
    position: absolute;
    width: 45%;
    height: 55%;
    transition:
      transform 0.3s ease,
      opacity 0.3s ease;
  }

  .ally {
    left: 2%;
    bottom: 0;
  }

  .wild {
    right: 2%;
    top: 0;
  }

  /* Aproximam-se um do outro no choque. */
  .scene.clash .ally {
    transform: translate(14%, -14%);
  }

  .scene.clash .wild {
    transform: translate(-14%, 14%);
  }

  .side.retreat {
    transform: translate(-30%, 10%);
    opacity: 0.5;
  }

  /* Puxado para dentro da bola, que cai no lugar dele. */
  .side.out {
    transform: scale(0.2);
    opacity: 0;
  }

  .side.back {
    animation: pop-in 0.35s ease both;
  }

  .body {
    position: absolute;
    inset: 0;
  }

  .body.hurt {
    animation: hurt 0.45s steps(6, end);
  }

  /* Ponto do chão: o PmdSprite se posiciona a partir daqui. */
  .anchor {
    position: absolute;
    left: 50%;
    bottom: 0.75rem;
    width: 0;
    height: 0;
  }

  .gif {
    position: absolute;
    left: 50%;
    bottom: 0.25rem;
    width: 80px;
    height: 80px;
    margin-left: -40px;
    object-fit: contain;
    object-position: bottom;
    image-rendering: pixelated;
  }

  .gif.flip {
    transform: scaleX(-1);
  }

  .ball {
    position: absolute;
    right: calc(2% + 22.5% - 16px);
    top: calc(55% - 2.5rem);
    width: 32px;
    height: 32px;
    z-index: 3;
    animation: throw-in 0.4s ease-out both;
  }

  .ball img {
    display: block;
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
    transform-origin: 50% 90%;
  }

  .ball img.wiggle {
    animation: wiggle 0.36s ease;
  }

  .ball img.click {
    animation: ball-click 0.5s ease;
  }

  .confetti {
    position: absolute;
    left: 13px;
    top: 10px;
    width: 6px;
    height: 10px;
    pointer-events: none;
    animation: confetti 0.7s ease-out both;
  }

  .confetti.c1 { --dx: -34px; --dy: -30px; background: #ff6b6b; }
  .confetti.c2 { --dx: 30px; --dy: -34px; background: #4ecdc4; }
  .confetti.c3 { --dx: -20px; --dy: -46px; background: #ffe66d; }
  .confetti.c4 { --dx: 22px; --dy: -48px; background: #95e06c; }
  .confetti.c5 { --dx: -42px; --dy: -8px; background: #c38bff; }
  .confetti.c6 { --dx: 40px; --dy: -10px; background: #ffb86b; }

  .banner {
    margin: 0;
    min-height: 28px;
    font-weight: 700;
    text-align: center;
  }

  .banner.soft {
    font-size: 15px;
    opacity: 0.65;
  }

  .banner.good {
    color: var(--grass-side);
  }

  .banner.bad {
    color: var(--danger);
  }

  @keyframes hurt {
    0%,
    100% {
      transform: none;
      filter: none;
    }
    17% {
      transform: translateX(-4px);
      filter: brightness(2);
    }
    34% {
      transform: translateX(4px);
      opacity: 0.4;
    }
    50% {
      transform: translateX(-3px);
      filter: brightness(2);
      opacity: 1;
    }
    67% {
      transform: translateX(3px);
      opacity: 0.4;
    }
    84% {
      transform: none;
      opacity: 1;
    }
  }

  /* Vem do lado do seu Pokémon (embaixo à esquerda) até o selvagem. */
  @keyframes throw-in {
    from {
      transform: translate(-140px, 90px) scale(0.5) rotate(-200deg);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes wiggle {
    0%,
    100% {
      transform: rotate(0);
    }
    25% {
      transform: rotate(-22deg);
    }
    75% {
      transform: rotate(22deg);
    }
  }

  @keyframes ball-click {
    0%,
    100% {
      transform: scale(1);
      filter: none;
    }
    40% {
      transform: scale(1.3);
      filter: brightness(1.6);
    }
  }

  @keyframes pop-in {
    from {
      transform: scale(0.2);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes confetti {
    from {
      transform: translate(0, 0) rotate(0);
      opacity: 1;
    }
    to {
      transform: translate(var(--dx), var(--dy)) rotate(160deg);
      opacity: 0;
    }
  }
</style>

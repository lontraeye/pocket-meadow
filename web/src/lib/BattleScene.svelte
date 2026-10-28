<script lang="ts">
  import { untrack } from 'svelte'
  import { spriteLoading } from './spriteLoading'
  import type { PendingEncounter } from './api'
  import { pokeBallSrc, prefersReducedMotion } from './highlights'
  import PmdSprite from './PmdSprite.svelte'
  import { play, playCry } from './sound'
  import { gardenSprite, pmdAnim, showdownSrc } from './sprites'

  // Tempos da cena de captura (ajustáveis). Com o resultado, ~6,5 s; o toque
  // pula a qualquer momento.
  const THROW_MS = 650 // arco girando até o Pokémon
  const HIT_MS = 260 // bate nele e ricocheteia na diagonal, para cima e para a esquerda
  const ABSORB_MS = 480 // ele fica branco e encolhe para dentro da bola
  const DROP_MS = 520 // a bola cai no chão com um quique
  const REST_MS = 450 // parada antes da primeira chacoalhada
  const SHAKE_MS = 420
  const SHAKE_GAPS_MS = [550, 700] // pausas depois da 1ª e da 2ª chacoalhada
  const DECIDE_MS = 850 // suspense depois da 3ª, antes do resultado
  const CATCH_MS = 1100
  const ESCAPE_MS = 900
  const SHAKES = 3

  let {
    encounter,
    throwResult,
    time = 0,
    ballSrc = pokeBallSrc(),
    skipThrow = false,
    onDone,
  }: {
    encounter: PendingEncounter
    /** Resultado do lançamento, já decidido pelo servidor (8.4). */
    throwResult: { caught: boolean; catchChance: number | null }
    time?: number
    /** Sprite da bola usada (seção 5.6). */
    ballSrc?: string
    /**
     * A bola já chegou no selvagem pelo arremesso do jogador (9.4): a cena começa
     * na batida, sem o próprio arco (seriam duas curvas seguidas).
     */
    skipThrow?: boolean
    onDone: () => void
  } = $props()

  type Phase = 'throw' | 'hit' | 'absorb' | 'drop' | 'rest' | 'shake' | 'celebrate' | 'escape' | 'done'

  const reduced = prefersReducedMotion()

  let phase = $state<Phase>(reduced ? 'done' : untrack(() => skipThrow) ? 'hit' : 'throw')
  let shakeIndex = $state(0)
  let finished = false

  const wildLook = $derived(gardenSprite(encounter.speciesId, encounter.isShiny))

  $effect(() => {
    if (reduced) {
      finish()
      return
    }
    const caught = throwResult.caught
    const speciesId = encounter.speciesId
    const timers: number[] = []
    // Cada passo agenda o próximo; o toque para pular cancela tudo.
    const then = (ms: number, fn: () => void) => {
      timers.push(
        window.setTimeout(() => {
          if (!finished) fn()
        }, ms),
      )
    }

    function shake(index: number) {
      phase = 'shake'
      shakeIndex = index
      play('shake')
      if (index + 1 < SHAKES) {
        then(SHAKE_MS + SHAKE_GAPS_MS[index]!, () => shake(index + 1))
        return
      }
      then(SHAKE_MS + DECIDE_MS, () => {
        if (caught) {
          phase = 'celebrate'
          play('catch')
          playCry(speciesId)
          then(CATCH_MS, finish)
        } else {
          phase = 'escape'
          play('escape')
          then(ESCAPE_MS, finish)
        }
      })
    }

    const fromHit = untrack(() => skipThrow)
    if (!fromHit) play('fast')
    then(fromHit ? 0 : THROW_MS, () => {
      phase = 'hit'
      if (!fromHit) play('hit')
      then(HIT_MS, () => {
        phase = 'absorb'
        then(ABSORB_MS, () => {
          phase = 'drop'
          then(DROP_MS, () => {
            phase = 'rest'
            then(REST_MS, () => shake(0))
          })
        })
      })
    })

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

  const inBall = $derived(phase === 'drop' || phase === 'rest' || phase === 'shake' || phase === 'celebrate')
</script>

<!--
  O selvagem fica em cima à direita, olhando ↙ (linha 7 da folha PMD). A bola
  é feita de camadas, cada uma com um só movimento, para o arco sair certo:
  .ball-x anda na horizontal em ritmo constante, .ball-y sobe e desce com
  aceleração (é isso que desenha a curva), e .ball-r gira e chacoalha.
  .ball-x e .ball-y ocupam o campo inteiro, então o translate em % é do campo.
-->
<button
  type="button"
  class="scene"
  class:flash={phase === 'escape'}
  onclick={finish}
  aria-label="Cena de captura. Toque para pular"
>
  <div class="field">
    <div class="wild">
      <div
        class="shrink"
        class:white={phase === 'hit' || phase === 'absorb'}
        class:gone={inBall}
        class:absorb={phase === 'absorb'}
        class:back={phase === 'escape'}
      >
        {#if wildLook.kind === 'pmd' && pmdAnim(encounter.speciesId, wildLook.shinySheet, 'Idle')}
          <PmdSprite
            speciesId={encounter.speciesId}
            shiny={wildLook.shinySheet}
            anim="Idle"
            dir={7}
            scale={2}
            {time}
            shadow={wildLook.shadow}
          />
        {:else}
          <img class="gif" use:spriteLoading={showdownSrc(encounter.speciesId, encounter.isShiny)} src={showdownSrc(encounter.speciesId, encounter.isShiny)} alt="" />
        {/if}
      </div>
    </div>

    {#if phase !== 'done'}
      <div class="ball-x" class:throw={phase === 'throw'} class:hit={phase === 'hit'} class:away={phase !== 'throw' && phase !== 'hit'}>
        <div
          class="ball-y"
          class:throw={phase === 'throw'}
          class:hit={phase === 'hit'}
          class:hover={phase === 'absorb'}
          class:drop={phase === 'drop'}
        >
          <div class="ball-pos">
            {#key shakeIndex}
              <img
                class="ball-r"
                class:spin={phase === 'throw'}
                class:shake-l={phase === 'shake' && shakeIndex % 2 === 0}
                class:shake-r={phase === 'shake' && shakeIndex % 2 === 1}
                class:click={phase === 'celebrate'}
                class:pop={phase === 'escape'}
                src={ballSrc}
                alt=""
                width="45"
                height="45"
              />
            {/key}
            {#if phase === 'absorb'}
              <span class="glow" aria-hidden="true"></span>
            {/if}
            {#if phase === 'celebrate'}
              {#each [1, 2, 3, 4, 5] as n (n)}
                <span class="star s{n}" aria-hidden="true">
                  <svg viewBox="0 0 12 12" width="14" height="14"><path fill="#ffe66d" d="M6 0l1.5 4.2H12L8.2 6.8 9.7 11 6 8.4 2.3 11l1.5-4.2L0 4.2h4.5z" /></svg>
                </span>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>

  {#if phase === 'celebrate'}
    <p class="banner good">Capturado!</p>
  {:else if phase === 'escape'}
    <p class="banner">Escapou!</p>
  {:else if phase === 'shake'}
    <p class="banner">{'• '.repeat(shakeIndex + 1).trim()}</p>
  {:else}
    <p class="banner soft">Toque para pular</p>
  {/if}
</button>

<style>
  .scene {
    position: relative;
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

  .scene.flash::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 5;
    background: #fff;
    opacity: 0;
    pointer-events: none;
    animation: flash-white 0.35s ease-out both;
  }

  /* --recoil: quanto a bola volta para a esquerda depois de bater no Pokémon.
     Dali ela abre, puxa ele e cai, um pouco à frente de onde ele estava. */
  .field {
    --recoil: -34px;
    position: relative;
    height: 11rem;
    overflow: hidden;
  }

  /* Ponto do chão do selvagem. A bola descansa no mesmo ponto (.ball-pos). */
  .wild,
  .ball-pos {
    position: absolute;
    left: 68%;
    top: 7rem;
    width: 0;
    height: 0;
  }

  .shrink {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
  }

  /* Silhueta branca: o filtro fica aqui, longe do PmdSprite. */
  .shrink.white {
    filter: brightness(0) invert(1);
  }

  /* Encolhe até o centro da bola parada no ar (ver .ball-y.hover). */
  .shrink.absorb {
    animation: absorb 0.48s ease-in both;
  }

  .shrink.gone {
    transform: translate(var(--recoil), -54px) scale(0);
    opacity: 0;
  }

  .shrink.back {
    animation: pop-out 0.45s ease-out both;
  }

  .gif {
    position: absolute;
    left: -40px;
    bottom: -0.5rem;
    width: 80px;
    height: 80px;
    object-fit: contain;
    object-position: bottom;
    image-rendering: pixelated;
  }

  .ball-x,
  .ball-y {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }

  /* Horizontal: do lado esquerdo do campo até o selvagem, em ritmo constante. */
  .ball-x.throw {
    animation: throw-x 0.65s linear both;
  }

  .ball-x.hit {
    animation: recoil-x 0.26s ease-out both;
  }

  .ball-x.away {
    transform: translateX(var(--recoil));
  }

  .ball-y.throw {
    animation: throw-y 0.65s both;
  }

  .ball-y.hit {
    animation: hit-y 0.26s ease-out both;
  }

  .ball-y.hover {
    transform: translateY(-2.6rem);
  }

  .ball-y.drop {
    animation: drop-y 0.52s both;
  }

  /* A bola tem 18 px dentro de um quadro de 30, mostrada a 1,5× (45 px). O
     fundo da bola fica no ponto do chão (34,5 de 45 px); o centro, 13 px acima. */
  .ball-r {
    position: absolute;
    left: -22.5px;
    top: -34.5px;
    display: block;
    width: 45px;
    height: 45px;
    image-rendering: pixelated;
    transform-origin: 50% 77%;
  }

  .ball-r.spin {
    transform-origin: 50% 48%;
    animation: spin 0.65s linear both;
  }

  .ball-r.shake-l {
    animation: shake-l 0.42s ease-in-out both;
  }

  .ball-r.shake-r {
    animation: shake-r 0.42s ease-in-out both;
  }

  .ball-r.click {
    animation: click 0.5s ease-out both;
  }

  .ball-r.pop {
    transform-origin: 50% 48%;
    animation: pop 0.3s ease-out both;
  }

  .glow {
    position: absolute;
    left: -11px;
    top: -24px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    pointer-events: none;
    animation: glow 0.48s ease-out both;
  }

  .star {
    position: absolute;
    left: -7px;
    top: -20px;
    pointer-events: none;
    animation: star-fan 0.8s ease-out both;
  }

  .star.s1 { --dx: -40px; --dy: -26px; }
  .star.s2 { --dx: 36px; --dy: -30px; animation-delay: 0.04s; }
  .star.s3 { --dx: -20px; --dy: -48px; animation-delay: 0.08s; }
  .star.s4 { --dx: 22px; --dy: -50px; animation-delay: 0.02s; }
  .star.s5 { --dx: 0; --dy: -58px; animation-delay: 0.1s; }

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

  @keyframes throw-x {
    from {
      transform: translateX(-56%);
    }
    to {
      transform: none;
    }
  }

  /* Sobe desacelerando, desce acelerando: com o horizontal constante, vira
     uma parábola. Termina no meio do corpo do Pokémon. */
  @keyframes throw-y {
    0% {
      transform: translateY(4.5rem);
      animation-timing-function: cubic-bezier(0.3, 0.6, 0.6, 1);
    }
    55% {
      transform: translateY(-3.8rem);
      animation-timing-function: cubic-bezier(0.4, 0, 0.7, 0.4);
    }
    100% {
      transform: translateY(-1.5rem);
    }
  }

  /* Bate e ricocheteia para cima e para a esquerda (com o recoil-x), onde
     fica parada enquanto ele entra. */
  @keyframes recoil-x {
    from {
      transform: none;
    }
    to {
      transform: translateX(var(--recoil));
    }
  }

  @keyframes hit-y {
    from {
      transform: translateY(-1.5rem);
    }
    to {
      transform: translateY(-2.6rem);
    }
  }

  @keyframes drop-y {
    0% {
      transform: translateY(-2.6rem);
      animation-timing-function: ease-in;
    }
    55% {
      transform: translateY(0);
      animation-timing-function: ease-out;
    }
    75% {
      transform: translateY(-0.6rem);
      animation-timing-function: ease-in;
    }
    100% {
      transform: translateY(0);
    }
  }

  @keyframes spin {
    from {
      transform: rotate(-1620deg);
    }
    to {
      transform: rotate(0);
    }
  }

  @keyframes absorb {
    from {
      transform: none;
    }
    to {
      transform: translate(var(--recoil), -54px) scale(0);
    }
  }

  /* Sai da bola (no chão, à esquerda) branco e volta à cor no lugar dele. */
  @keyframes pop-out {
    0% {
      transform: translate(var(--recoil), -13px) scale(0.2);
      filter: brightness(0) invert(1);
    }
    60% {
      transform: scale(1.08);
      filter: brightness(0) invert(1);
    }
    100% {
      transform: none;
      filter: none;
    }
  }

  @keyframes shake-l {
    0%,
    100% {
      transform: rotate(0);
    }
    30% {
      transform: translateX(-2px) rotate(-24deg);
    }
    60% {
      transform: rotate(8deg);
    }
    80% {
      transform: rotate(-3deg);
    }
  }

  @keyframes shake-r {
    0%,
    100% {
      transform: rotate(0);
    }
    30% {
      transform: translateX(2px) rotate(24deg);
    }
    60% {
      transform: rotate(-8deg);
    }
    80% {
      transform: rotate(3deg);
    }
  }

  /* O clique: achata e fica um pouco mais escura, como a bola fechada. */
  @keyframes click {
    0% {
      transform: none;
      filter: none;
    }
    25% {
      transform: scale(1.12, 0.88);
    }
    50% {
      transform: scale(0.96, 1.04);
    }
    100% {
      transform: none;
      filter: brightness(0.75);
    }
  }

  @keyframes pop {
    to {
      transform: scale(1.6);
      opacity: 0;
    }
  }

  @keyframes glow {
    0% {
      transform: scale(2.4);
      opacity: 0;
    }
    40% {
      opacity: 0.9;
    }
    100% {
      transform: scale(0.3);
      opacity: 0;
    }
  }

  @keyframes star-fan {
    from {
      transform: translate(0, 0) scale(0.4) rotate(0);
      opacity: 1;
    }
    to {
      transform: translate(var(--dx), var(--dy)) scale(1) rotate(160deg);
      opacity: 0;
    }
  }

  @keyframes flash-white {
    from {
      opacity: 0.8;
    }
    to {
      opacity: 0;
    }
  }
</style>

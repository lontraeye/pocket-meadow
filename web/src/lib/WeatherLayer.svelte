<script lang="ts">
  import type { WeatherKey } from './api'
  import { prefersReducedMotion } from './highlights'

  /**
   * Clima sobre o jardim (5.11): um véu de cor por clima e, na chuva, no vento
   * e no nublado, partículas simples. Só transparência e transform (nada de
   * filter/backdrop-filter, que refazem a pintura do jardim inteiro a cada
   * quadro no celular). Não pega toque.
   */
  let { weather }: { weather: WeatherKey } = $props()

  const reduced = prefersReducedMotion()

  // Posições e tempos sorteados uma vez (não precisam bater com nada).
  const rand = (min: number, max: number) => min + Math.random() * (max - min)
  const drops = Array.from({ length: 46 }, () => ({
    left: rand(-5, 105),
    delay: rand(-1.2, 0),
    duration: rand(0.55, 0.85),
    long: Math.random() < 0.4,
  }))
  const gusts = Array.from({ length: 12 }, () => ({
    top: rand(4, 92),
    delay: rand(-2.4, 0),
    duration: rand(0.9, 1.6),
    width: rand(18, 46),
  }))
  const leaves = Array.from({ length: 6 }, () => ({
    top: rand(10, 85),
    delay: rand(-3.5, 0),
    duration: rand(2.2, 3.5),
  }))
  const clouds = Array.from({ length: 3 }, (_, i) => ({
    top: rand(5, 70),
    delay: -i * 9 - rand(0, 6),
    duration: rand(24, 32),
    size: rand(180, 260),
  }))
</script>

<div class="weather {weather}" aria-hidden="true">
  {#if !reduced}
    {#if weather === 'rain'}
      {#each drops as drop, i (i)}
        <span
          class="drop"
          class:long={drop.long}
          style:left="{drop.left}%"
          style:animation-delay="{drop.delay}s"
          style:animation-duration="{drop.duration}s"
        ></span>
      {/each}
    {:else if weather === 'wind'}
      {#each gusts as gust, i (i)}
        <span
          class="gust"
          style:top="{gust.top}%"
          style:width="{gust.width}px"
          style:animation-delay="{gust.delay}s"
          style:animation-duration="{gust.duration}s"
        ></span>
      {/each}
      {#each leaves as leaf, i (i)}
        <span
          class="leaf"
          style:top="{leaf.top}%"
          style:animation-delay="{leaf.delay}s"
          style:animation-duration="{leaf.duration}s"
        ></span>
      {/each}
    {:else if weather === 'cloudy'}
      {#each clouds as cloud, i (i)}
        <span
          class="cloud"
          style:top="{cloud.top}%"
          style:width="{cloud.size}px"
          style:height="{cloud.size * 0.55}px"
          style:animation-delay="{cloud.delay}s"
          style:animation-duration="{cloud.duration}s"
        ></span>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .weather {
    position: absolute;
    z-index: 5;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* Véu: tom do dia sobre o cenário (sol quente, nublado cinza, chuva fria). */
  .sunny {
    background: #ffcf6a14;
  }

  .cloudy {
    background: #5c667526;
  }

  .rain {
    background: #2c3e5c33;
  }

  .wind {
    background: #d8e6d00d;
  }

  /* Chuva: pingos em pixel caindo na diagonal. */
  .drop {
    position: absolute;
    top: -12%;
    width: 2px;
    height: 6px;
    background: #cfe3ffb0;
    animation: fall linear infinite;
    will-change: transform;
  }

  .drop.long {
    height: 10px;
  }

  @keyframes fall {
    to {
      transform: translate(-28px, 125vh);
    }
  }

  /* Vento: riscos claros e folhinhas atravessando. */
  .gust {
    position: absolute;
    left: -20%;
    height: 2px;
    background: #ffffff70;
    animation: gust linear infinite;
    will-change: transform;
  }

  @keyframes gust {
    to {
      transform: translateX(140vw);
    }
  }

  .leaf {
    position: absolute;
    left: -5%;
    width: 4px;
    height: 4px;
    background: #8fc25a;
    box-shadow: 2px 2px 0 #5d8f34;
    animation: leaf linear infinite;
    will-change: transform;
  }

  @keyframes leaf {
    0% {
      transform: translate(0, 0) rotate(0deg);
    }
    25% {
      transform: translate(30vw, -14px) rotate(90deg);
    }
    50% {
      transform: translate(60vw, 10px) rotate(180deg);
    }
    75% {
      transform: translate(90vw, -8px) rotate(270deg);
    }
    100% {
      transform: translate(120vw, 6px) rotate(360deg);
    }
  }

  /* Nublado: sombras de nuvem passando devagar pelo gramado. */
  .cloud {
    position: absolute;
    left: -40%;
    border-radius: 50%;
    background: radial-gradient(closest-side, #1f283324, transparent);
    animation: drift linear infinite;
    will-change: transform;
  }

  @keyframes drift {
    to {
      transform: translateX(180vw);
    }
  }
</style>

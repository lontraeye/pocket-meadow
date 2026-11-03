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
  // Nublado: sombras de nuvem em pixel art. Cada uma é um punhado de elipses
  // numa grade (o miolo), com uma borda pontilhada mais clara em volta (dither),
  // e vira dois paths de SVG: nada de desfoque, só bordas em degrau.
  const CLOUD_PX = 4
  function cloudShape(cols: number, rows: number): { core: string; rim: string } {
    const blobs = Array.from({ length: 4 }, (_, i) => ({
      x: cols * (0.22 + 0.56 * (i / 3)) + rand(-2, 2),
      y: rows * rand(0.42, 0.58),
      rx: cols * rand(0.16, 0.24),
      ry: rows * rand(0.3, 0.42),
    }))
    const inside = (x: number, y: number) =>
      blobs.some((b) => ((x + 0.5 - b.x) / b.rx) ** 2 + ((y + 0.5 - b.y) / b.ry) ** 2 <= 1)
    let core = ''
    let rim = ''
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const cell = `M${x} ${y}h1v1h-1z`
        if (inside(x, y)) {
          const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
          if (edge) rim += cell
          else core += cell
        } else if ((x + y) % 2 === 0 && (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1))) {
          rim += cell
        }
      }
    }
    return { core, rim }
  }
  const clouds = Array.from({ length: 4 }, (_, i) => {
    const cols = Math.round(rand(50, 70))
    const rows = Math.round(cols * rand(0.42, 0.52))
    return {
      top: rand(-10, 60),
      delay: -i * 8 - rand(0, 5),
      duration: rand(26, 34),
      cols,
      rows,
      ...cloudShape(cols, rows),
    }
  })
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
        <svg
          class="cloud"
          width={cloud.cols * CLOUD_PX}
          height={cloud.rows * CLOUD_PX}
          viewBox="0 0 {cloud.cols} {cloud.rows}"
          shape-rendering="crispEdges"
          style:top="{cloud.top}%"
          style:animation-delay="{cloud.delay}s"
          style:animation-duration="{cloud.duration}s"
        >
          <path class="rim" d={cloud.rim} />
          <path class="core" d={cloud.core} />
        </svg>
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

  /*
   * Nublado: sombras de nuvem em pixel passando devagar pelo gramado, na
   * diagonal do isométrico (para a direita e um pouco para baixo). O miolo é
   * a sombra; a borda pontilhada, mais clara, faz a transição sem desfoque.
   */
  .cloud {
    position: absolute;
    left: -45%;
    display: block;
    animation: drift linear infinite;
    will-change: transform;
  }

  .cloud .core {
    fill: #18202b47;
  }

  .cloud .rim {
    fill: #18202b24;
  }

  @keyframes drift {
    to {
      transform: translate(190vw, 45vh);
    }
  }
</style>

<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type { FieldSpawn, FieldSpot } from './api'
  import { prefersReducedMotion } from './highlights'
  import { snapPixelScale, snapToDevice } from './pixelSnap.svelte'
  import PmdSprite from './PmdSprite.svelte'
  import { gardenSprite, loadPmd } from './sprites'

  /**
   * Campo de encontro (PLANNING.md 5.14): os Pokémon da área andando num
   * gramado. Cada um vai até um ponto, para um pouco e escolhe outro. Tocar
   * seleciona; quem enfrenta é o painel de baixo. Só visual: quem aparece e o
   * nível já vieram do servidor. As manchas (água, árvore, pedra) ficam na
   * faixa de cima, e os Pokémon andam abaixo delas.
   */
  let {
    spawns,
    selected,
    onSelect,
    spots = [],
    selectedSpot = null,
    onSelectSpot = () => {},
  }: {
    spawns: FieldSpawn[]
    selected: number | null
    onSelect: (slot: number) => void
    spots?: FieldSpot[]
    selectedSpot?: FieldSpot['kind'] | null
    onSelectSpot?: (kind: FieldSpot['kind']) => void
  } = $props()

  const SPOT_NAMES: Record<FieldSpot['kind'], string> = { water: 'Água', tree: 'Árvore', rock: 'Pedra' }
  // Água à esquerda; árvore e pedra à direita.
  const SPOT_X: Record<FieldSpot['kind'], number> = { water: 0.04, tree: 0.62, rock: 0.82 }
  // Com manchas, os Pokémon andam só abaixo delas.
  const top = $derived(spots.length > 0 ? 0.42 : 0.28)

  type Walker = { x: number; y: number; tx: number; ty: number; dir: number; moving: boolean; until: number }

  const SPEED = 0.07 // fração do campo por segundo
  // Escala e posição em pixels inteiros da tela (escala do Windows, zoom):
  // senão o sprite sai com pixels de tamanhos diferentes.
  const scale = $derived(snapPixelScale(2))
  let fieldW = $state(0)
  let fieldH = $state(0)
  const reduced = prefersReducedMotion()

  // Posição de cada um pelo id (um novo na vaga começa em outro lugar).
  let walkers = $state<Record<number, Walker>>({})
  let clock = $state(0)

  function spot(): { x: number; y: number } {
    const from = untrack(() => top)
    return { x: 0.12 + Math.random() * 0.76, y: from + Math.random() * (0.88 - from) }
  }

  // Direções do PMD: 0 sul, 1 sudeste, 2 leste... 7 sudoeste.
  function dirTo(dx: number, dy: number): number {
    const angle = Math.atan2(dx, dy) // 0 = para baixo (sul)
    return (Math.round((angle / (Math.PI * 2)) * 8) + 8) % 8
  }

  // Monta quem chegou (e solta quem saiu). Só depende de spawns: os passos
  // escrevem em walkers a cada quadro.
  $effect(() => {
    const list = spawns
    const current = untrack(() => walkers)
    const next: Record<number, Walker> = {}
    for (const spawn of list) {
      const known = current[spawn.id]
      if (known) {
        next[spawn.id] = known
        continue
      }
      const start = spot()
      const target = spot()
      next[spawn.id] = {
        ...start,
        tx: target.x,
        ty: target.y,
        dir: Math.floor(Math.random() * 8),
        moving: false,
        until: performance.now() + Math.random() * 1500,
      }
      const look = gardenSprite(spawn.speciesId, spawn.isShiny)
      if (look.kind === 'pmd') void loadPmd(spawn.speciesId, look.shinySheet)
    }
    walkers = next
  })

  onMount(() => {
    if (reduced) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      clock = now
      const next: Record<number, Walker> = {}
      for (const [id, walker] of Object.entries(walkers)) {
        const w = { ...walker }
        if (!w.moving) {
          if (now >= w.until) {
            const target = spot()
            w.tx = target.x
            w.ty = target.y
            w.moving = true
            w.dir = dirTo(w.tx - w.x, w.ty - w.y)
          }
        } else {
          const dx = w.tx - w.x
          const dy = w.ty - w.y
          const dist = Math.hypot(dx, dy)
          const step = SPEED * dt
          if (dist <= step) {
            w.x = w.tx
            w.y = w.ty
            w.moving = false
            w.until = now + 1200 + Math.random() * 2600
          } else {
            w.x += (dx / dist) * step
            w.y += (dy / dist) * step
          }
        }
        next[Number(id)] = w
      }
      walkers = next
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })

  // Quem está mais embaixo fica na frente.
  const ordered = $derived(
    [...spawns].sort((a, b) => (walkers[a.id]?.y ?? 0) - (walkers[b.id]?.y ?? 0)),
  )
</script>

<div class="field" role="group" aria-label="Pokémon no campo" bind:clientWidth={fieldW} bind:clientHeight={fieldH}>
  {#each spots as entry (entry.kind)}
    {@const open = entry.actions.some((action) => action.open)}
    <button
      type="button"
      class="spot {entry.kind}"
      class:locked={!open}
      class:picked={entry.kind === selectedSpot}
      style:left="{SPOT_X[entry.kind] * 100}%"
      aria-label="{SPOT_NAMES[entry.kind]}{open ? '' : ' (fechada)'}"
      aria-pressed={entry.kind === selectedSpot}
      onclick={() => onSelectSpot(entry.kind)}
    >
      {#if entry.kind === 'water'}
        <span class="pond" aria-hidden="true"><i></i><i></i></span>
      {:else if entry.kind === 'tree'}
        <svg viewBox="0 0 16 20" width="48" height="60" aria-hidden="true" shape-rendering="crispEdges">
          <rect x="6" y="13" width="4" height="7" fill="#7a4a24" />
          <rect x="2" y="3" width="12" height="10" fill="#2f7a2f" />
          <rect x="4" y="1" width="8" height="2" fill="#2f7a2f" />
          <rect x="0" y="5" width="2" height="6" fill="#2f7a2f" />
          <rect x="14" y="5" width="2" height="6" fill="#2f7a2f" />
          <rect x="4" y="4" width="3" height="2" fill="#56a447" />
          <rect x="9" y="7" width="2" height="2" fill="#56a447" />
        </svg>
      {:else}
        <svg viewBox="0 0 16 12" width="44" height="33" aria-hidden="true" shape-rendering="crispEdges">
          <rect x="3" y="2" width="10" height="9" fill="#8a8a92" />
          <rect x="1" y="5" width="14" height="6" fill="#8a8a92" />
          <rect x="5" y="0" width="6" height="2" fill="#8a8a92" />
          <rect x="4" y="3" width="3" height="2" fill="#b4b4bc" />
          <rect x="9" y="6" width="1" height="4" fill="#5c5c64" />
          <rect x="1" y="10" width="14" height="1" fill="#5c5c64" />
        </svg>
      {/if}
      {#if !open}<span class="lock" aria-hidden="true">🔒</span>{/if}
    </button>
  {/each}
  {#each ordered as spawn (spawn.id)}
    {@const walker = walkers[spawn.id]}
    {@const look = gardenSprite(spawn.speciesId, spawn.isShiny)}
    {#if walker}
      <button
        type="button"
        class="mon"
        class:picked={spawn.slot === selected}
        style:left="{snapToDevice(walker.x * fieldW)}px"
        style:top="{snapToDevice(walker.y * fieldH)}px"
        aria-label="{spawn.displayName}{spawn.isShiny ? ' (shiny)' : ''}, nível {spawn.level}"
        aria-pressed={spawn.slot === selected}
        onclick={() => onSelect(spawn.slot)}
      >
        <span class="hit" aria-hidden="true"></span>
        {#if spawn.slot === selected}<span class="ring" aria-hidden="true"></span>{/if}
        {#if look.kind === 'pmd'}
          <span class="anchor">
            <PmdSprite
              speciesId={spawn.speciesId}
              shiny={look.shinySheet}
              anim={walker.moving ? 'Walk' : 'Idle'}
              dir={walker.dir}
              {scale}
              time={clock}
              shadow={look.shadow}
            />
          </span>
        {:else}
          <img class="gif" src={look.src} alt="" />
        {/if}
        {#if spawn.isShiny}<span class="sparkle" aria-hidden="true">✦</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  /* Gramado: listras de grama em pixel, na cor do jardim. */
  .field {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border: 2px solid var(--panel-edge);
    background:
      repeating-linear-gradient(
        0deg,
        transparent 0 14px,
        color-mix(in srgb, var(--grass-side, #5d8f34) 25%, transparent) 14px 16px
      ),
      repeating-linear-gradient(
        90deg,
        transparent 0 22px,
        color-mix(in srgb, var(--grass-side, #5d8f34) 18%, transparent) 22px 24px
      ),
      var(--grass, #8fc25a);
    box-shadow: inset 0 3px 0 #00000022;
  }

  /* Manchas na faixa de cima do campo. */
  .spot {
    position: absolute;
    top: 6px;
    display: grid;
    place-items: end center;
    height: 36%;
    min-height: 56px;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  .spot.water {
    width: 52%;
  }

  .spot.tree,
  .spot.rock {
    width: 16%;
    min-width: 48px;
  }

  .spot.locked > :not(.lock) {
    opacity: 0.5;
    filter: grayscale(0.5);
  }

  .spot.picked,
  .spot:focus-visible {
    outline: 3px solid var(--selected, #fff);
    outline-offset: 1px;
  }

  .pond {
    position: relative;
    width: 100%;
    height: 100%;
    background: #4f8fe0;
    border: 3px solid #2d5fa8;
    border-radius: 40% 46% 42% 38%;
    box-shadow: inset 0 4px 0 #ffffff33;
    overflow: hidden;
  }

  /* Duas marolas que vão e voltam. */
  .pond i {
    position: absolute;
    width: 22%;
    height: 3px;
    background: #cfe4ff;
    animation: ripple 2.4s ease-in-out infinite alternate;
  }

  .pond i:first-child {
    left: 18%;
    top: 34%;
  }

  .pond i:last-child {
    left: 54%;
    top: 62%;
    animation-delay: -1.2s;
  }

  @keyframes ripple {
    from {
      transform: translateX(-6px);
      opacity: 0.4;
    }
    to {
      transform: translateX(6px);
      opacity: 0.9;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pond i {
      animation: none;
    }
  }

  .lock {
    position: absolute;
    right: 2px;
    top: 2px;
    font-size: 13px;
    line-height: 1;
    filter: drop-shadow(0 1px 0 #0008);
  }

  /* O botão é o ponto do chão (sem tamanho): o sprite se apoia nele. */
  .mon {
    position: absolute;
    width: 0;
    height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  /* Alvo de toque em volta do sprite (maior que ele). */
  .hit {
    position: absolute;
    left: -32px;
    top: -60px;
    width: 64px;
    height: 72px;
  }

  .anchor {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
  }

  .gif {
    position: absolute;
    left: -28px;
    bottom: -4px;
    width: 56px;
    image-rendering: pixelated;
  }

  .ring {
    position: absolute;
    left: -23px;
    top: -8px;
    width: 46px;
    height: 16px;
    box-sizing: border-box;
    border: 3px solid var(--selected, #fff);
    border-radius: 50%;
  }

  .sparkle {
    position: absolute;
    top: -58px;
    left: 14px;
    color: #fff3a0;
    text-shadow: 0 0 2px #000;
    font-size: 14px;
  }

  .mon:focus-visible .hit {
    outline: 3px solid var(--selected);
  }
</style>

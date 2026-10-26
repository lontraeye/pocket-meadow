<script lang="ts">
  import type { Snippet } from 'svelte'
  import { frameIndex, groundAt, pmdAnim, type PmdAnimName } from './sprites'

  // Desenha a partir do ponto do chão: quem usa posiciona o componente no chão
  // (ex.: centro do bloco) e o quadro se alinha pelo pixel de sombra da folha.
  // Assim o corpo não escorrega durante o Walk nem pula ao trocar de animação.
  let {
    speciesId,
    shiny,
    anim,
    dir,
    scale,
    time,
    shadow,
    children,
  }: {
    speciesId: number
    shiny: boolean
    anim: PmdAnimName
    dir: number
    scale: number
    time: number
    shadow: 0 | 1 | 2
    children?: Snippet
  } = $props()

  const sheet = $derived(pmdAnim(speciesId, shiny, anim))
  const frame = $derived(sheet ? frameIndex(sheet.durations, time) : 0)
  const row = $derived(!sheet || sheet.dirs <= 1 ? 0 : Math.min(dir, sheet.dirs - 1))
  const ground = $derived(sheet ? groundAt(sheet, dir, frame) : { x: 0, y: 0 })
  const width = $derived((sheet?.w ?? 0) * scale)
  const height = $derived((sheet?.h ?? 0) * scale)
</script>

{#if sheet}
  <span class="ground" aria-hidden="true">
    <span class="shadow s{shadow}" style:--scale={scale}></span>
    <span
      class="sprite"
      style:left="{-ground.x * scale}px"
      style:top="{-ground.y * scale}px"
      style:width="{width}px"
      style:height="{height}px"
      style:background-image="url('/sprites/pmd/{speciesId}{shiny ? '/shiny' : ''}/{anim}.png')"
      style:background-size="{sheet.w * sheet.durations.length * scale}px {sheet.h * sheet.dirs * scale}px"
      style:background-position="{-frame * width}px {-row * height}px"
    >
      {@render children?.()}
    </span>
  </span>
{/if}

<style>
  .ground {
    position: absolute;
    left: 0;
    top: 0;
  }

  /* Elipse no chão, antes do sprite no DOM: fica por baixo. Medidas em px da folha. */
  .shadow {
    --w: 16;
    --h: 6;
    position: absolute;
    left: calc(var(--w) * var(--scale) * -0.5px);
    top: calc(var(--h) * var(--scale) * -0.5px);
    width: calc(var(--w) * var(--scale) * 1px);
    height: calc(var(--h) * var(--scale) * 1px);
    border-radius: 50%;
    background: #00000030;
  }

  .shadow.s0 {
    --w: 10;
    --h: 4;
  }

  .shadow.s2 {
    --w: 22;
    --h: 8;
  }

  .sprite {
    position: absolute;
    display: block;
    background-repeat: no-repeat;
    image-rendering: pixelated;
  }
</style>

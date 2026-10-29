<script lang="ts">
  import { snapIconSize } from './pixelSnap.svelte'
  import { TYPE_ICONS } from './typeStyle'

  let { type, size = 24 }: { type: string; size?: number } = $props()
</script>

<!-- Pixel 12×12 na cor do texto; tamanho múltiplo de 12 para não borrar. -->
<svg class="type-icon" viewBox="0 0 12 12" width={snapIconSize(size)} height={snapIconSize(size)} aria-hidden="true">
  {#each TYPE_ICONS[type] ?? TYPE_ICONS.normal ?? [] as px (`${px.x},${px.y}`)}
    <rect x={px.x} y={px.y} width="1" height="1" />
  {/each}
</svg>

<style>
  .type-icon {
    display: block;
    flex: none;
    fill: currentColor;
    shape-rendering: crispEdges;
  }
</style>

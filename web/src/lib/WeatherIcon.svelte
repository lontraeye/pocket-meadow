<script lang="ts">
  import type { WeatherKey } from './api'
  import { WEATHER_ICONS } from './weather'

  let { weather, size = 24 }: { weather: WeatherKey; size?: number } = $props()
</script>

<!-- Pixel 12×12 na cor do texto; tamanho múltiplo de 12 para não borrar. -->
<svg class="weather-icon" viewBox="0 0 12 12" width={size} height={size} aria-hidden="true">
  {#each WEATHER_ICONS[weather] as px (`${px.x},${px.y}`)}
    <rect x={px.x} y={px.y} width="1" height="1" />
  {/each}
</svg>

<style>
  .weather-icon {
    display: block;
    flex: none;
    fill: currentColor;
    shape-rendering: crispEdges;
  }
</style>

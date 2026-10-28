<script lang="ts">
  import { FX_COLUMNS, FX_FRAME_MS, FX_FRAME_SIZE, fxMeta, fxSheetLoad, fxSheetReady, fxUrl, type FxId } from './fx'

  // Desenha a folha com o pivot no ponto (0,0) do pai. Escala só 1× ou 2×.
  let {
    id,
    scale = 1,
    loop = false,
    time = 0,
    rate = 1,
    maxFrames = null,
    onDone,
  }: {
    id: FxId | string
    scale?: 1 | 2
    loop?: boolean
    /** ms desde o início deste efeito. */
    time?: number
    /** >1 toca mais rápido (ex.: flying). */
    rate?: number
    /** Corta a folha (loops longos no acerto, pulsos de status). */
    maxFrames?: number | null
    onDone?: () => void
  } = $props()

  const meta = $derived(fxMeta(id))
  const url = $derived(fxUrl(id))
  // Nada de esconder até a folha "ficar pronta": esperar a decodificação
  // fazia efeitos sumirem a luta inteira quando ela falhava ou atrasava. A
  // folha é pequena; se ainda não chegou, o navegador a mostra ao chegar.
  // Aqui só garante que ela foi pedida (a luta já pede todas ao abrir).
  $effect(() => {
    if (!fxSheetReady(id)) void fxSheetLoad(id)
  })
  const frameCount = $derived(
    meta ? Math.min(meta.frames, maxFrames ?? meta.frames) : 0,
  )
  const rawFrame = $derived(
    meta && frameCount > 0 ? Math.floor((Math.max(0, time) * Math.max(0.25, rate)) / FX_FRAME_MS) : 0,
  )
  const frame = $derived(
    !meta || frameCount <= 0
      ? 0
      : loop
        ? rawFrame % frameCount
        : Math.min(rawFrame, Math.max(0, frameCount - 1)),
  )
  const done = $derived(Boolean(meta && !loop && frameCount > 0 && rawFrame >= frameCount))
  const col = $derived(frame % FX_COLUMNS)
  const row = $derived(Math.floor(frame / FX_COLUMNS))
  const size = $derived(FX_FRAME_SIZE * scale)
  const sheetCols = $derived(FX_COLUMNS)
  const sheetRows = $derived(meta ? Math.ceil(meta.frames / FX_COLUMNS) : 1)
  const pivotX = $derived((meta?.pivot[0] ?? FX_FRAME_SIZE / 2) * scale)
  const pivotY = $derived((meta?.pivot[1] ?? FX_FRAME_SIZE / 2) * scale)

  let reported = $state(false)
  $effect(() => {
    if (!done || reported) return
    reported = true
    onDone?.()
  })
  $effect(() => {
    // Novo efeito / troca de id: pode avisar de novo ao terminar.
    void id
    void maxFrames
    void loop
    reported = false
  })
</script>

{#if meta}
  <span
    class="fx"
    aria-hidden="true"
    style:width="{size}px"
    style:height="{size}px"
    style:left="{-pivotX}px"
    style:top="{-pivotY}px"
    style:background-image="url('{url}')"
    style:background-size="{sheetCols * size}px {sheetRows * size}px"
    style:background-position="{-col * size}px {-row * size}px"
  ></span>
{/if}

<style>
  .fx {
    position: absolute;
    display: block;
    background-repeat: no-repeat;
    image-rendering: pixelated;
    pointer-events: none;
    will-change: background-position;
  }
</style>

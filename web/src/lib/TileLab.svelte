<script lang="ts">
  import { onMount } from 'svelte'
  import {
    MASK_KEYS,
    TILE_H,
    TILE_W,
    TERRAIN_ORDER,
    cellAt,
    defaultMask,
    overlaysAt,
    parseTileFile,
    terrainPriority,
    tileOrigin,
    variantAt,
    type MaskKey,
    type TerrainGrid,
  } from './terrain'

  // Laboratório de tiles (PLANNING.md, seção 5.22). Lê os PNGs de art/tiles/
  // (lista do plugin `/__tiles` do Vite), monta um pedaço de chão com as
  // variações sorteadas e as bordas pelas máscaras, e recarrega sozinho quando
  // um arquivo muda. Só existe no `npm run dev`.

  type ListedFile = { name: string; url: string; mtime: number }
  type Terrain = { key: string; variants: HTMLImageElement[]; files: string[] }

  const COLS = 10
  const ROWS = 10

  let terrains = $state<Terrain[]>([])
  let masks = $state<Record<string, { data: Uint8Array; custom: boolean }>>({})
  let warnings = $state<string[]>([])
  let dir = $state('')
  let selected = $state<string | null>(null)
  let zoom = $state(4)
  let showGrid = $state(false)
  let debugMasks = $state(false)
  let useVariants = $state(true)
  let cells = $state<(string | null)[]>([])
  let canvas = $state<HTMLCanvasElement | null>(null)
  let lastStamp = ''

  const terrainByKey = $derived(new Map(terrains.map((terrain) => [terrain.key, terrain])))
  const width = (COLS + ROWS) * (TILE_W / 2)
  const height = (COLS + ROWS) * (TILE_H / 2)
  const originX = ROWS * (TILE_W / 2)

  async function poll() {
    let listed: { dir: string; files: ListedFile[] }
    try {
      listed = (await (await fetch('/__tiles', { cache: 'no-store' })).json()) as { dir: string; files: ListedFile[] }
    } catch {
      warnings = ['Não achei a lista de tiles. O laboratório só funciona com o `npm run dev`.']
      return
    }
    dir = listed.dir
    const stamp = listed.files.map((file) => `${file.name}:${file.mtime}`).join('|')
    if (stamp === lastStamp) return
    lastStamp = stamp
    await load(listed.files)
  }

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(url))
      img.src = url
    })
  }

  function alphaOf(img: HTMLImageElement): Uint8Array {
    const scratch = document.createElement('canvas')
    scratch.width = TILE_W
    scratch.height = TILE_H
    const ctx = scratch.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, TILE_W, TILE_H).data
    const out = new Uint8Array(TILE_W * TILE_H)
    for (let i = 0; i < out.length; i += 1) out[i] = (data[i * 4 + 3] ?? 0) > 0 ? 1 : 0
    return out
  }

  async function load(files: ListedFile[]) {
    const found = new Map<string, { variant: number; img: HTMLImageElement; name: string }[]>()
    const nextMasks: Record<string, { data: Uint8Array; custom: boolean }> = {}
    const problems: string[] = []
    for (const file of files) {
      const parsed = parseTileFile(file.name)
      if (!parsed) continue
      let img: HTMLImageElement
      try {
        img = await loadImage(`${file.url}?t=${file.mtime}`)
      } catch {
        problems.push(`${file.name}: não abriu.`)
        continue
      }
      if (img.naturalWidth !== TILE_W || img.naturalHeight !== TILE_H) {
        problems.push(`${file.name}: tem ${img.naturalWidth}×${img.naturalHeight}; precisa de ${TILE_W}×${TILE_H}.`)
        continue
      }
      if (parsed.kind === 'mask') nextMasks[parsed.mask] = { data: alphaOf(img), custom: true }
      else {
        const list = found.get(parsed.terrain) ?? []
        list.push({ variant: parsed.variant, img, name: file.name })
        found.set(parsed.terrain, list)
        if (terrainPriority(parsed.terrain) < 0) {
          problems.push(`"${parsed.terrain}" não está na ordem de prioridade (terrain.ts): fica abaixo de todos.`)
        }
      }
    }
    for (const key of MASK_KEYS) nextMasks[key] ??= { data: defaultMask(key), custom: false }
    terrains = [...found.entries()]
      .sort((a, b) => terrainPriority(a[0]) - terrainPriority(b[0]))
      .map(([key, list]) => {
        list.sort((a, b) => a.variant - b.variant)
        return { key, variants: list.map((row) => row.img), files: list.map((row) => row.name) }
      })
    masks = nextMasks
    warnings = problems
    if (cells.length === 0) preset('clareira')
    if (!selected || !terrainByKey.has(selected)) selected = terrains[terrains.length - 1]?.key ?? null
  }

  // Mapas de teste. Usam os dois primeiros terrenos achados (o de baixo e o de cima).
  function preset(kind: 'clareira' | 'caminho' | 'xadrez' | 'ilhas' | 'cheio') {
    const low = terrains[0]?.key ?? 'terra'
    const high = terrains[1]?.key ?? terrains[0]?.key ?? 'grama'
    const next: (string | null)[] = []
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        let lowHere = false
        if (kind === 'clareira') lowHere = (col - 4.5) ** 2 + (row - 4.5) ** 2 < 7
        else if (kind === 'caminho') lowHere = col === 4 || col === 5 || (row === 6 && col > 4)
        else if (kind === 'xadrez') lowHere = (col + row) % 2 === 0
        else if (kind === 'ilhas') lowHere = !((col % 4 === 1 || col % 4 === 2) && (row % 4 === 1 || row % 4 === 2))
        next.push(kind === 'cheio' ? (selected ?? high) : lowHere ? low : high)
      }
    }
    cells = next
  }

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, width, height)
    const grid: TerrainGrid = { cols: COLS, rows: ROWS, cells }
    const scratch = document.createElement('canvas')
    scratch.width = TILE_W
    scratch.height = TILE_H
    const sctx = scratch.getContext('2d')!
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const key = cells[row * COLS + col]
        const terrain = key ? terrainByKey.get(key) : undefined
        const o = tileOrigin(col, row)
        const x = originX + o.x
        const y = o.y
        if (terrain) ctx.drawImage(pick(terrain, col, row), x, y)
        for (const overlay of overlaysAt(grid, col, row)) {
          const over = terrainByKey.get(overlay.terrain)
          if (!over) continue
          sctx.globalCompositeOperation = 'source-over'
          sctx.clearRect(0, 0, TILE_W, TILE_H)
          sctx.putImageData(maskImage(overlay.masks), 0, 0)
          sctx.globalCompositeOperation = 'source-in'
          if (debugMasks) {
            sctx.fillStyle = '#ff2bd6'
            sctx.fillRect(0, 0, TILE_W, TILE_H)
          } else sctx.drawImage(pick(over, col, row), 0, 0)
          ctx.drawImage(scratch, x, y)
        }
      }
    }
    if (showGrid) drawGrid(ctx)
  }

  function pick(terrain: Terrain, col: number, row: number): HTMLImageElement {
    const index = useVariants ? variantAt(col, row, terrain.variants.length) : 0
    return terrain.variants[index] ?? terrain.variants[0]!
  }

  function maskImage(keys: MaskKey[]): ImageData {
    const image = new ImageData(TILE_W, TILE_H)
    for (const key of keys) {
      const mask = masks[key]?.data
      if (!mask) continue
      for (let i = 0; i < mask.length; i += 1) if (mask[i]) image.data[i * 4 + 3] = 255
    }
    return image
  }

  // Linha de 1 pixel nas bordas de cima de cada losango, meio transparente.
  function drawGrid(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgb(0 0 0 / 0.28)'
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const o = tileOrigin(col, row)
        for (let step = 0; step < TILE_W / 2; step += 1) {
          const yy = o.y + Math.floor(step / 2)
          ctx.fillRect(originX + o.x + TILE_W / 2 - 1 - step, yy, 1, 1)
          ctx.fillRect(originX + o.x + TILE_W / 2 + step, yy, 1, 1)
        }
      }
    }
  }

  $effect(() => {
    // Redesenha quando qualquer coisa que entra no desenho muda.
    void [cells, terrains, masks, showGrid, debugMasks, useVariants, canvas]
    draw()
  })

  let painting = false
  function paintAt(event: PointerEvent) {
    if (!canvas || !selected) return
    const rect = canvas.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width - originX
    const py = ((event.clientY - rect.top) / rect.height) * height
    const { col, row } = cellAt(px, py)
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return
    const index = row * COLS + col
    if (cells[index] === selected) return
    cells[index] = selected
  }

  onMount(() => {
    zoom = Math.max(2, Math.min(6, Math.floor((window.innerWidth - 24) / width)))
    void poll()
    const timer = setInterval(() => void poll(), 1000)
    return () => clearInterval(timer)
  })
</script>

<main class="lab">
  <header>
    <h1>Laboratório de tiles</h1>
    <p class="hint">
      Salve os PNGs em <code>{dir || 'art/tiles/'}</code>. A página recarrega sozinha em ~1 s.
    </p>
  </header>

  <div class="stage" style:width="{width * zoom}px">
    <canvas
      bind:this={canvas}
      {width}
      {height}
      style:width="{width * zoom}px"
      style:height="{height * zoom}px"
      onpointerdown={(event) => {
        painting = true
        ;(event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId)
        paintAt(event)
      }}
      onpointermove={(event) => {
        if (painting) paintAt(event)
      }}
      onpointerup={() => (painting = false)}
      onpointercancel={() => (painting = false)}
    ></canvas>
  </div>

  <section class="panel">
    <h2>Pintar com</h2>
    <div class="palette">
      {#each terrains as terrain (terrain.key)}
        <button type="button" class="swatch" class:on={selected === terrain.key} onclick={() => (selected = terrain.key)}>
          <img src={terrain.variants[0]?.src} alt="" />
          <span>{terrain.key}</span>
          <small>{terrain.variants.length} {terrain.variants.length === 1 ? 'variação' : 'variações'}</small>
        </button>
      {:else}
        <p>Nenhum tile achado ainda.</p>
      {/each}
    </div>

    <h2>Mapas de teste</h2>
    <div class="row">
      <button type="button" class="btn" onclick={() => preset('clareira')}>Clareira</button>
      <button type="button" class="btn" onclick={() => preset('caminho')}>Caminho</button>
      <button type="button" class="btn" onclick={() => preset('ilhas')}>Ilhas</button>
      <button type="button" class="btn" onclick={() => preset('xadrez')}>Xadrez</button>
      <button type="button" class="btn" onclick={() => preset('cheio')}>Tudo com o escolhido</button>
    </div>

    <h2>Ver</h2>
    <div class="row">
      <label><input type="checkbox" bind:checked={showGrid} /> Grade</label>
      <label><input type="checkbox" bind:checked={debugMasks} /> Bordas em rosa</label>
      <label><input type="checkbox" bind:checked={useVariants} /> Variações</label>
      <label>
        Zoom
        <input type="range" min="1" max="8" bind:value={zoom} />
        {zoom}×
      </label>
    </div>

    <h2>Máscaras das bordas</h2>
    <div class="masks">
      {#each MASK_KEYS as key (key)}
        <span class="mask" class:custom={masks[key]?.custom}>{key}{masks[key]?.custom ? '' : ' (padrão)'}</span>
      {/each}
    </div>

    {#if warnings.length > 0}
      <h2>Avisos</h2>
      <ul class="warnings">
        {#each warnings as warning (warning)}<li>{warning}</li>{/each}
      </ul>
    {/if}

    <details>
      <summary>Como nomear os arquivos</summary>
      <ul>
        <li>Terreno: <code>grama-1.png</code>, <code>grama-2.png</code>… (cada número é uma variação, sorteada por bloco).</li>
        <li>Tamanho: {TILE_W}×{TILE_H}, o losango do molde (<code>referencia/molde-grama.png</code>).</li>
        <li>Bordas: <code>mascara-lado-ne.png</code> (lados ne, se, so, no) e <code>mascara-canto-n.png</code> (cantos n, l, s, o). Pixel pintado = onde o terreno vizinho entra. Sem o arquivo, vale a máscara padrão.</li>
        <li>Quem cobre quem (da menor para a maior prioridade): {TERRAIN_ORDER.join(', ')}.</li>
      </ul>
    </details>
  </section>
</main>

<style>
  .lab {
    display: grid;
    gap: 1rem;
    padding: 0.75rem;
    min-height: 100vh;
    background: #20262a;
    color: #f2efe6;
    font-family: 'Pixelify Sans', system-ui, sans-serif;
  }

  h1 {
    margin: 0;
    font-size: 1.4rem;
  }

  h2 {
    margin: 0.75rem 0 0.35rem;
    font-size: 1rem;
  }

  .hint {
    margin: 0.25rem 0 0;
    opacity: 0.8;
  }

  code {
    font-size: 0.85em;
    word-break: break-all;
  }

  .stage {
    max-width: 100%;
    overflow: auto;
    background: #4e7a3a;
    border-radius: 6px;
  }

  canvas {
    display: block;
    image-rendering: pixelated;
    touch-action: none;
    cursor: crosshair;
  }

  .panel {
    max-width: 40rem;
  }

  .palette,
  .row,
  .masks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .swatch {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    min-width: 5.5rem;
    padding: 0.4rem;
    background: #2e363b;
    color: inherit;
    border: 2px solid #4a555c;
    border-radius: 6px;
    font: inherit;
  }

  .swatch.on {
    border-color: #f2c94c;
  }

  .swatch img {
    width: 72px;
    height: 36px;
    image-rendering: pixelated;
  }

  .swatch small {
    opacity: 0.7;
  }

  .btn {
    min-height: 44px;
    padding: 0 0.8rem;
    background: #2e363b;
    color: inherit;
    border: 2px solid #4a555c;
    border-radius: 6px;
    font: inherit;
  }

  label {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    min-height: 44px;
  }

  .mask {
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    background: #2e363b;
    font-size: 0.85rem;
    opacity: 0.7;
  }

  .mask.custom {
    opacity: 1;
    background: #3c5a34;
  }

  .warnings {
    margin: 0;
    padding-left: 1.2rem;
    color: #f2c94c;
  }
</style>

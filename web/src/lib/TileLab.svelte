<script lang="ts">
  import { onMount } from 'svelte'
  import {
    biomeName,
    FLOORS,
    MATERIAL_NAMES,
    OBJECTS,
    recognizeHabitats,
    type GardenCell,
    type Zone,
  } from '@habitat'
  import { drawFloor, type FloorAssets } from './floor'
  import {
    MASK_KEYS,
    TILE_H,
    TILE_W,
    TERRAIN_ORDER,
    cellAt,
    defaultMask,
    parseTileFile,
    terrainPriority,
    tileOrigin,
    type MaskKey,
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
  /** Escala do desenho em px de CSS: o que cabe na tela, em pixels inteiros do aparelho. */
  let zoom = $state(2)
  let showGrid = $state(false)
  let debugMasks = $state(false)
  let useVariants = $state(true)
  let cells = $state<(string | null)[]>([])
  let canvas = $state<HTMLCanvasElement | null>(null)
  let lastStamp = ''

  // Modo habitats (5.22): pinta chão e objetos e vê o que o motor reconhece.
  // No modo habitats, casa sem chão (null) é o gramado neutro, desenhado como grama.
  let habitatMode = $state(false)
  let objects = $state<(string | null)[]>([])
  /** O que pintar no modo habitats: um chão, um objeto, o gramado ou a borracha de objeto. */
  let brush = $state<{ kind: 'floor' | 'object'; key: string | null }>({ kind: 'floor', key: 'areia' })

  const BIOME_COLORS: Record<string, string> = {
    lago: '#3d7fd6',
    cratera: '#e0602c',
    usina: '#f2c230',
    'bosque-sombrio': '#7a4fa8',
    rochedo: '#a07850',
    'campo-gelado': '#9ad8f0',
    pradaria: '#4caa3c',
    basico: '#d8d0b8',
  }
  /** Chão sem tile ainda: losango em cor sólida. */
  const FLOOR_COLORS: Record<string, string> = {
    neve: '#eef4f8',
    lava: '#d8441c',
    'chao-escuro': '#3c3448',
    caminho: '#c8b48c',
  }
  const OBJECT_COLORS: Record<string, string> = {
    rocha: '#8a8a8a',
    arvore: '#2f7a2c',
    'arvore-escura': '#3a2850',
    tronco: '#8a5a2c',
    cogumelo: '#d04848',
    cristal: '#9ad8f0',
    gerador: '#f2c230',
    cerca: '#c89a5a',
  }
  const floorKeys = Object.keys(FLOORS)
  const objectKeys = Object.keys(OBJECTS)

  const zones = $derived.by((): Zone[] => {
    if (!habitatMode) return []
    const list: GardenCell[] = []
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const floor = cells[row * COLS + col] ?? null
        const object = objects[row * COLS + col] ?? null
        if (floor || object) list.push({ col, row, floor, object })
      }
    }
    return recognizeHabitats(list)
  })

  function startHabitats() {
    habitatMode = true
    cells = Array.from({ length: COLS * ROWS }, () => null)
    objects = Array.from({ length: COLS * ROWS }, () => null)
  }

  function stopHabitats() {
    habitatMode = false
    objects = []
    preset('clareira')
  }

  function zoneText(zone: Zone): string {
    const size = `${zone.tiles.length} ${zone.tiles.length === 1 ? 'casa' : 'casas'}`
    if (zone.tooSmall) return `Pequena demais · ${size} (precisa de 6)`
    const head = zone.biome ? `${biomeName(zone.biome)} · ${size} · ${zone.capacity} vagas` : size
    if (!zone.nearest) return head
    const gaps = zone.nearest.gaps
      .map((gap) => `${gap.materials.map((m) => MATERIAL_NAMES[m]).join(' + ')} ${gap.have} de ${gap.need}`)
      .join(', ')
    return `${head} · para ${biomeName(zone.nearest.biome)} falta ${gaps}`
  }

  function fillDiamond(ctx: CanvasRenderingContext2D, col: number, row: number, color: string) {
    const o = tileOrigin(col, row)
    ctx.fillStyle = color
    for (let y = 0; y < TILE_H; y += 1) {
      const half = y < TILE_H / 2 ? 1 + 2 * y : 1 + 2 * (TILE_H - 1 - y)
      ctx.fillRect(originX + o.x + TILE_W / 2 - half, o.y + y, half * 2, 1)
    }
  }

  function drawHabitats(ctx: CanvasRenderingContext2D) {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const floor = cells[row * COLS + col]
        if (floor && !terrainByKey.has(floor)) fillDiamond(ctx, col, row, FLOOR_COLORS[floor] ?? '#ff00ff')
      }
    }
    ctx.globalAlpha = 0.35
    for (const zone of zones) {
      const color = zone.biome ? (BIOME_COLORS[zone.biome] ?? '#fff') : '#000'
      for (const tile of zone.tiles) fillDiamond(ctx, tile.col, tile.row, color)
    }
    ctx.globalAlpha = 1
    // Objeto: um bloquinho com contorno, no meio do losango.
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const object = objects[row * COLS + col]
        if (!object) continue
        const o = tileOrigin(col, row)
        const x = originX + o.x + TILE_W / 2 - 3
        const y = o.y + TILE_H / 2 - 6
        ctx.fillStyle = '#1b1b1b'
        ctx.fillRect(x - 1, y - 1, 8, 8)
        ctx.fillStyle = OBJECT_COLORS[object] ?? '#ff00ff'
        ctx.fillRect(x, y, 6, 6)
      }
    }
    // Número da zona na casa-âncora, em pixels (3×5).
    zones.forEach((zone, index) => {
      const anchor = zone.tiles[0]
      if (!anchor) return
      const o = tileOrigin(anchor.col, anchor.row)
      drawDigit(ctx, index + 1, originX + o.x + TILE_W / 2 - 2, o.y + 2)
    })
  }

  const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111']
  function drawDigit(ctx: CanvasRenderingContext2D, value: number, x: number, y: number) {
    const text = String(value)
    const w = text.length * 4 + 1
    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(x - 1, y - 1, w, 7)
    ctx.fillStyle = '#ffffff'
    ;[...text].forEach((char, i) => {
      const bits = DIGITS[Number(char)] ?? ''
      for (let p = 0; p < 15; p += 1) if (bits[p] === '1') ctx.fillRect(x + i * 4 + (p % 3), y + Math.floor(p / 3), 1, 1)
    })
  }

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
    const assets: FloorAssets = {
      terrains: new Map(terrains.map((terrain) => [terrain.key, terrain.variants])),
      masks: new Map(Object.entries(masks).map(([key, mask]) => [key as MaskKey, mask.data])),
    }
    const floorCells = habitatMode
      ? cells.map((cell) => (cell && terrainByKey.has(cell) ? cell : cell === null ? 'grama' : null))
      : cells
    drawFloor(ctx, { cols: COLS, rows: ROWS, cells: floorCells }, assets, { offsetX: originX, variants: useVariants, debugMasks })
    if (habitatMode) drawHabitats(ctx)
    if (showGrid) drawGrid(ctx)
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
    void [cells, terrains, masks, showGrid, debugMasks, useVariants, canvas, objects, zones, habitatMode]
    draw()
  })

  let painting = false
  function paintAt(event: PointerEvent) {
    if (!canvas || (!habitatMode && !selected)) return
    const rect = canvas.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width - originX
    const py = ((event.clientY - rect.top) / rect.height) * height
    const { col, row } = cellAt(px, py)
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return
    const index = row * COLS + col
    if (habitatMode) {
      if (brush.kind === 'object') objects[index] = brush.key
      else cells[index] = brush.key
      return
    }
    if (cells[index] === selected) return
    cells[index] = selected
  }

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  /** Zoom que cabe na largura da tela, em pixels inteiros do aparelho. */
  function fitZoom(): number {
    const available = Math.max(120, window.innerWidth - 24)
    return Math.max(1, Math.floor((available * dpr) / width)) / dpr
  }
  onMount(() => {
    zoom = fitZoom()
    const onResize = () => (zoom = fitZoom())
    window.addEventListener('resize', onResize)
    void poll()
    const timer = setInterval(() => void poll(), 1000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', onResize)
    }
  })
</script>

<main class="lab">
  <header>
    <h1>Laboratório de tiles</h1>
    <p class="hint">
      Salve os PNGs em <code>{dir || 'art/tiles/'}</code>. A página recarrega sozinha em ~1 s.
    </p>
  </header>

  <div class="stage">
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

  <section class="controls">
    <h2>Habitats</h2>
    {#if habitatMode}
      <p class="hint">Pinte chão e objetos; o motor reconhece as zonas na hora (seção 5.22). Gramado e caminho separam habitats; a cerca também.</p>
      <div class="palette">
        <button type="button" class="swatch" class:on={brush.kind === 'floor' && brush.key === null} onclick={() => (brush = { kind: 'floor', key: null })}>
          <span>gramado</span><small>neutro</small>
        </button>
        {#each floorKeys as key (key)}
          <button type="button" class="swatch" class:on={brush.kind === 'floor' && brush.key === key} onclick={() => (brush = { kind: 'floor', key })}>
            {#if terrainByKey.get(key)?.variants[0]}<img src={terrainByKey.get(key)?.variants[0]?.src} alt="" />{:else}<i class="dot" style:background={FLOOR_COLORS[key]}></i>{/if}
            <span>{key}</span><small>chão</small>
          </button>
        {/each}
        {#each objectKeys as key (key)}
          <button type="button" class="swatch" class:on={brush.kind === 'object' && brush.key === key} onclick={() => (brush = { kind: 'object', key })}>
            <i class="dot" style:background={OBJECT_COLORS[key]}></i>
            <span>{key}</span><small>objeto</small>
          </button>
        {/each}
        <button type="button" class="swatch" class:on={brush.kind === 'object' && brush.key === null} onclick={() => (brush = { kind: 'object', key: null })}>
          <span>tirar objeto</span><small>borracha</small>
        </button>
      </div>
      <ol class="zones">
        {#each zones as zone, index (index)}
          <li><i class="dot" style:background={zone.biome ? BIOME_COLORS[zone.biome] : '#000'}></i>{index + 1}. {zoneText(zone)}</li>
        {:else}
          <li>Nenhuma zona ainda: pinte algum chão.</li>
        {/each}
      </ol>
      <div class="row">
        <button type="button" class="btn" onclick={startHabitats}>Limpar</button>
        <button type="button" class="btn" onclick={stopHabitats}>Voltar aos tiles</button>
      </div>
    {:else}
      <div class="row">
        <button type="button" class="btn" onclick={startHabitats}>Testar habitats</button>
      </div>
    {/if}

    {#if !habitatMode}
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

    {/if}

    <h2>Ver</h2>
    <div class="row">
      <label><input type="checkbox" bind:checked={showGrid} /> Grade</label>
      <label><input type="checkbox" bind:checked={debugMasks} /> Bordas em rosa</label>
      <label><input type="checkbox" bind:checked={useVariants} /> Variações</label>
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
  :global(html),
  :global(body) {
    margin: 0;
    background: #20262a;
  }

  .lab {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    padding: 0.75rem 0.75rem calc(1.5rem + env(safe-area-inset-bottom));
    min-height: 100dvh;
    background: #20262a;
    color: #f2efe6;
    font-family: 'Pixelify Sans', system-ui, sans-serif;
    font-variant-ligatures: none;
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
    box-sizing: border-box;
    justify-self: start;
    max-width: 100%;
    overflow: hidden;
    background: #4e7a3a;
    border-radius: 6px;
  }

  canvas {
    display: block;
    image-rendering: pixelated;
    touch-action: none;
    cursor: crosshair;
  }

  .controls {
    min-width: 0;
    max-width: 40rem;
  }

  details {
    margin-top: 0.75rem;
  }

  summary {
    min-height: 44px;
    line-height: 44px;
    cursor: pointer;
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

  .dot {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 1px solid #1b1b1b;
    vertical-align: middle;
  }

  .zones {
    margin: 0.6rem 0;
    padding-left: 0;
    list-style: none;
    display: grid;
    gap: 0.3rem;
  }

  .zones .dot {
    margin-right: 0.4rem;
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

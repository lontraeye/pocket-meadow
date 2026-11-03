<script lang="ts">
  // Vitrine do jardim (`/vitrine.html`, só no `npm run dev`): os arbustos de
  // berry crescendo e com frutas, a árvore de Apricorn e a máquina, cada um no
  // seu bloco de grama (ou canteiro), com o mesmo encaixe do jardim. O Vite
  // recarrega a página quando um PNG de art/ muda.
  import { onMount } from 'svelte'
  import { BENCH_IDLE, BENCH_READY, BENCH_SHEET, benchWorkFrame } from './bench'

  const art = import.meta.glob('../../../art/jardim/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >
  const tiles = import.meta.glob('../../../art/tiles/*.png', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >
  const find = (files: Record<string, string>, name: string) =>
    Object.entries(files).find(([file]) => file.endsWith(`/${name}`))?.[1] ?? null

  const BERRIES = [
    ['oran', 'Oran'],
    ['razz', 'Razz'],
    ['lum', 'Lum'],
    ['golden-razz', 'Golden Razz'],
    ['pinap', 'Pinap'],
    ['silver-pinap', 'Silver Pinap'],
    ['nanab', 'Nanab'],
  ] as const

  /** O que vai em cada bloco: imagem (ou quadro da máquina), chão e encaixe. */
  type Item = {
    label: string
    src: string | null
    frame?: 'idle' | 'work' | 'ready'
    floor: 'grama' | 'canteiro'
    /**
     * Quanto a borda de baixo da imagem desce do centro do bloco, em pixels da
     * arte (o mesmo do jardim): árvore 2, arbusto 1, máquina 6 (a ponta de baixo).
     */
    foot: number
  }
  const stage = (suffix: string, tag: string) =>
    BERRIES.map(([key, name]): Item => ({
      label: tag ? `${name} ${tag}` : name,
      src: find(art, `arbusto-${key}${suffix}.png`),
      floor: 'canteiro',
      foot: 1,
    }))
  const rows: Item[][] = [
    stage('-semente', 'semente'),
    stage('-muda', 'muda'),
    stage('', ''),
    stage('-frutos', 'pronta'),
    [
      { label: 'Arbusto seco', src: find(art, 'arbusto-seco.png'), floor: 'canteiro', foot: 1 },
      { label: 'Árvore', src: find(art, 'arvore-apricorn.png'), floor: 'grama', foot: 2 },
      { label: 'Árvore cheia', src: find(art, 'arvore-apricorn-frutos.png'), floor: 'grama', foot: 2 },
      { label: 'Máquina parada', src: BENCH_SHEET, frame: 'idle', floor: 'grama', foot: 6 },
      { label: 'Trabalhando', src: BENCH_SHEET, frame: 'work', floor: 'grama', foot: 6 },
      { label: 'Pronta', src: BENCH_SHEET, frame: 'ready', floor: 'grama', foot: 6 },
    ],
  ]

  const COLS = Math.max(...rows.map((row) => row.length))
  /** Um bloco (24) e um respiro entre os itens. */
  const STEP_X = 28
  const ROW_H = 50
  const W = COLS * STEP_X + 24
  const H = rows.length * ROW_H + 8
  const centerX = (i: number) => 24 + i * STEP_X
  const centerY = (r: number) => 34 + r * ROW_H

  let zoom = $state(4)
  let canvas = $state<HTMLCanvasElement | null>(null)
  let images = $state<Map<string, HTMLImageElement> | null>(null)
  let time = $state(0)

  function load(url: string): Promise<HTMLImageElement> {
    const image = new Image()
    image.src = url
    return image.decode().then(() => image)
  }

  onMount(() => {
    const urls = new Set<string>([
      ...rows.flat().flatMap((item) => (item.src ? [item.src] : [])),
      ...['grama-1.png', 'grama-2.png', 'canteiro-1.png'].flatMap((name) => find(tiles, name) ?? []),
    ])
    void Promise.all([...urls].map(async (url) => [url, await load(url)] as const)).then((pairs) => (images = new Map(pairs)))
    let frame = 0
    const loop = (now: number) => {
      time = now
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  })

  $effect(() => {
    if (!canvas || !images) return
    const now = time
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(zoom, 0, 0, zoom, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const grass = [find(tiles, 'grama-1.png'), find(tiles, 'grama-2.png')].flatMap((url) =>
      url && images!.get(url) ? [images!.get(url)!] : [],
    )
    const bedUrl = find(tiles, 'canteiro-1.png')
    const bed = bedUrl ? images.get(bedUrl) : undefined
    rows.forEach((row, r) => {
      const cy = centerY(r)
      // Chão: uma faixa de losangos de grama (duas fileiras intercaladas).
      for (let k = -1; k * 24 < W + 24; k += 1) {
        for (const [dx, dy] of [
          [0, -6],
          [12, 0],
          [0, 6],
        ] as const) {
          const tile = grass[Math.abs(k + r + dy) % grass.length]
          if (tile) ctx.drawImage(tile, k * 24 + dx, cy + dy - 6)
        }
      }
      row.forEach((item, i) => {
        if (item.floor === 'canteiro' && bed) ctx.drawImage(bed, centerX(i) - 12, cy - 6)
      })
      row.forEach((item, i) => {
        const image = item.src ? images!.get(item.src) : undefined
        if (!image) return
        const cx = centerX(i)
        // Borda de baixo da imagem `foot` pixels abaixo do centro do bloco, como no jardim.
        const bottom = cy + item.foot
        if (item.frame) {
          const index = item.frame === 'idle' ? BENCH_IDLE : item.frame === 'ready' ? BENCH_READY : benchWorkFrame(now)
          ctx.drawImage(image, index * 24, 0, 24, 32, cx - 12, bottom - 32, 24, 32)
        } else {
          ctx.drawImage(image, cx - image.width / 2, bottom - image.height)
        }
      })
    })
  })
</script>

<main class="vitrine">
  <header>
    <h1>Vitrine do jardim</h1>
    <label>
      Zoom
      <input type="range" min="2" max="8" step="1" bind:value={zoom} />
      {zoom}×
    </label>
  </header>
  <div class="stage">
    <canvas bind:this={canvas} width={W * zoom} height={H * zoom}></canvas>
    <div class="labels">
      {#each rows as row, r (r)}
        {#each row as item, i (i)}
          <span style:left="{centerX(i) * zoom}px" style:top="{(centerY(r) + 8) * zoom}px">
            {item.label}{item.src ? '' : ' (sem arte)'}
          </span>
        {/each}
      {/each}
    </div>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #1d2a1f;
    color: #f0ecd8;
    font-family: 'Pixelify Sans', system-ui, sans-serif;
  }

  .vitrine {
    padding: 12px;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-bottom: 12px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
  }

  label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stage {
    position: relative;
    width: fit-content;
    max-width: 100%;
    overflow: auto;
  }

  canvas {
    display: block;
    image-rendering: pixelated;
  }

  .labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .labels span {
    position: absolute;
    transform: translateX(-50%);
    padding: 1px 4px;
    background: rgb(0 0 0 / 0.55);
    font-size: 12px;
    white-space: nowrap;
  }
</style>

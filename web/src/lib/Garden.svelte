<script lang="ts">
  import { snapIconSize, snapPixelScale, snapToDevice } from './pixelSnap.svelte'
  import { spriteLoading } from './spriteLoading'
  import { serverClock } from './serverClock.svelte'
  import { formatCountdown } from './time'
  import { untrack } from 'svelte'
  import {
    api,
    berryIconSrc,
    errorText,
    giftIconSrc,
    giftLabel,
    itemLabel,
    type ApiError,
    type GameState,
    type GardenGift,
    type PlotState,
    type TreeView,
  } from './api'
  import PmdSprite from './PmdSprite.svelte'
  import { buildFloorAssets, drawFloor, floorPattern, type FloorAssets } from './floor'
  import { BUBBLES, type BubbleKind } from './bubbles'
  import { loadTreeArt, treePixels, type TreeArt, type TreeColor } from './apricornTree'
  import {
    BENCH_FRAMES,
    BENCH_H,
    BENCH_IDLE,
    BENCH_READY,
    benchSheet,
    BENCH_W,
    benchDone,
    benchWorkFrame,
  } from './bench'
  import BenchPanel from './BenchPanel.svelte'
  import Modal from './Modal.svelte'
  import { TILE_H, TILE_W, type TerrainGrid } from './terrain'
  import PokemonSheet from './PokemonSheet.svelte'
  import WeatherIcon from './WeatherIcon.svelte'
  import WeatherLayer from './WeatherLayer.svelte'
  import { play, playCry } from './sound'
  import { pickAt, plotTileAt, warmSpriteMasks, type GardenHit } from './spriteHit'
  import {
    gardenExtent,
    gardenSprite,
    groundAt,
    preloadPmd,
    showdownSrc,
    type GardenLook,
    type PmdAnimName,
  } from './sprites'

  let {
    game,
    onState,
    openPlotIndex = null,
    onPlotOpened,
  }: {
    game: GameState
    onState: () => Promise<void>
    openPlotIndex?: number | null
    onPlotOpened?: () => void
  } = $props()

  let plotIndex = $state<number | null>(null)
  let plotMessage = $state('')
  let plotPending = $state(false)
  let harvestResult = $state<{ berryKey: string; berries: number; died: boolean } | null>(null)
  let confirmUproot = $state(false)
  let selectedId = $state<number | null>(null)

  const plotsByIndex = $derived(new Map(game.plots.map((plot) => [plot.plotIndex, plot])))
  const seedRows = $derived(
    game.inventory.filter((row) => row.itemKey.startsWith('seed:') && row.quantity > 0),
  )

  const clock = serverClock(() => game.now)

  // Arbustos de berry (arte em art/jardim/arbustos/): um por berry, sem frutas
  // enquanto cresce e com frutas quando fica pronto. Sem arte, fica o desenho antigo.
  const bushFiles = import.meta.glob('../../../art/jardim/arbustos/arbusto-*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>
  const bushArt = new Map(
    Object.entries(bushFiles).map(([file, url]) => [file.slice(file.lastIndexOf('/') + 1, -'.png'.length), url]),
  )
  /** Desenho do canteiro no estágio: semente, muda, crescida, com frutos ou seco. */
  function bushSrc(berryKey: string, look: BushLook): string | null {
    if (look === 'seco') return bushArt.get('arbusto-seco') ?? null
    const suffix = look === 'crescida' ? '' : `-${look}`
    return bushArt.get(`arbusto-${berryKey}${suffix}`) ?? null
  }
  type BushLook = 'semente' | 'muda' | 'crescida' | 'frutos' | 'seco'
  /**
   * No primeiro crescimento (antes da primeira colheita) o arbusto passa por
   * semente, muda e crescida; depois disso fica crescido até dar frutos de novo.
   */
  function bushLook(plot: PlotState): BushLook {
    if (plot.deadAt !== null) return 'seco'
    const now = clock.now()
    if (now >= plot.readyAt) return 'frutos'
    if (plot.harvests > 0) return 'crescida'
    const progress = (now - plot.plantedAt) / Math.max(1, plot.readyAt - plot.plantedAt)
    return progress < 0.25 ? 'semente' : progress < 0.6 ? 'muda' : 'crescida'
  }
  /**
   * Quanto o pé do arbusto (a borda de baixo da imagem) desce do centro do
   * canteiro, em pixels da arte: com 1, o tronco entra no meio do losango e as
   * raízes não encostam na ponta de baixo.
   */
  const BUSH_FOOT = 1

  function plotStage(plot: PlotState | undefined): 'empty' | 'planted' | 'growing' | 'ready' | 'dead' {
    if (!plot) return 'empty'
    if (plot.deadAt !== null) return 'dead'
    const now = clock.now()
    if (now >= plot.readyAt) return 'ready'
    const total = Math.max(1, plot.readyAt - plot.plantedAt)
    const progress = (now - plot.plantedAt) / total
    return progress < 0.2 ? 'planted' : 'growing'
  }

  /** Duração de crescimento legível: "48 min", "4h", "1h 30m". */
  function growText(ms: number): string {
    const min = Math.round(ms / 60000)
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    const m = min % 60
    return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
  }

  function remainingMs(readyAt: number): number {
    return Math.max(0, readyAt - clock.now())
  }

  function openPlot(index: number) {
    selectedId = null
    plotIndex = index
    plotMessage = ''
    harvestResult = null
    confirmUproot = false
  }

  $effect(() => {
    if (openPlotIndex === null || openPlotIndex === undefined) return
    openPlot(openPlotIndex)
    onPlotOpened?.()
  })

  function closePlot() {
    plotIndex = null
    plotMessage = ''
    harvestResult = null
    confirmUproot = false
  }

  async function plant(berryKey: string) {
    if (plotIndex === null) return
    plotPending = true
    plotMessage = ''
    try {
      const response = await api(`/api/plots/${plotIndex}/plant`, { berryKey })
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
      if (!response.ok) {
        plotMessage = errorText(payload)
        return
      }
      await onState()
      closePlot()
    } catch {
      plotMessage = 'Sem conexão com o servidor.'
    } finally {
      plotPending = false
    }
  }

  async function advancePlot(body: { minutes: number } | { ready: true }) {
    if (plotIndex === null) return
    plotPending = true
    plotMessage = ''
    try {
      const response = await api('/api/dev/plots/advance', { plotIndex, ...body })
      if (!response.ok) plotMessage = errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError)
      await onState()
    } catch {
      plotMessage = 'Sem conexão com o servidor.'
    } finally {
      plotPending = false
    }
  }

  async function uproot() {
    if (plotIndex === null) return
    plotPending = true
    plotMessage = ''
    try {
      const response = await api(`/api/plots/${plotIndex}/uproot`, {})
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & { seedReturned?: boolean }
      confirmUproot = false
      if (!response.ok) {
        plotMessage = errorText(payload)
        return
      }
      await onState()
      const cleared = (payload as { cleared?: boolean }).cleared === true
      const seeds = Number((payload as { seeds?: number }).seeds ?? 0)
      plotMessage = cleared
        ? seeds > 0
          ? `Limpou o arbusto seco e achou ${seeds} semente${seeds === 1 ? '' : 's'}!`
          : 'Limpou o arbusto seco. Não sobrou semente.'
        : payload.seedReturned
          ? 'Arrancou. A semente voltou para a mochila.'
          : 'Arrancou. A semente se perdeu.'
      if (cleared && seeds > 0) play('harvest')
    } catch {
      plotMessage = 'Sem conexão com o servidor.'
    } finally {
      plotPending = false
    }
  }

  async function harvest() {
    if (plotIndex === null) return
    plotPending = true
    plotMessage = ''
    try {
      const response = await api(`/api/plots/${plotIndex}/harvest`, {})
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & {
        berryKey?: string
        berries?: number
        died?: boolean
      }
      if (!response.ok) {
        plotMessage = errorText(payload)
        return
      }
      harvestResult = {
        berryKey: String(payload.berryKey ?? ''),
        berries: Number(payload.berries ?? 0),
        died: payload.died === true,
      }
      play('harvest')
      await onState()
    } catch {
      plotMessage = 'Sem conexão com o servidor.'
    } finally {
      plotPending = false
    }
  }

  // Zona andável 12×12. O mundo tem uma margem em volta só para a câmera ter
  // folga; o gramado de fora (mais escuro) é o fundo do .lawn, que não acaba.
  const playCols = 12
  const playRows = 12
  const margin = 10
  const worldCols = playCols + margin * 2
  const worldRows = playRows + margin * 2
  const playCol0 = margin
  const playRow0 = margin
  const playColEnd = margin + playCols
  const playRowEnd = margin + playRows
  // Faixa de z: chão (0..span-1), entidades (span..) — sprites grandes não furam o gramado.
  const depthSpan = worldCols + worldRows
  // Zoom manual (1–3). Abertura mais afastada (~8 tiles de largura).
  const scaleMin = 1
  const scaleMax = 3
  // Passo de meio: o PMD vai de 2× a 6× (sempre inteiro, sem borrar o pixel).
  const scaleStep = 0.5
  const wheelStepPx = 60
  // Pinça: abrir ou fechar 20% a distância entre os dedos muda um passo.
  const pinchStepRatio = 1.2
  const defaultViewTiles = 8
  const baseTileW = 48
  const baseTileH = 24
  const showdownSize = 64
  const stepMs = 480
  const idleMinMs = 1600
  const idleMaxMs = 3000
  const sleepChance = 0.15
  const sleepMinMs = 20_000
  const sleepMaxMs = 40_000
  // Virar de uma direção para a vizinha (Walk e Idle têm 8) antes de andar
  // numa direção nova, em vez de girar na hora.
  const turnStepMs = 110
  const sleepDir = 0
  // Casa da frente ocupada por outro: espera e tenta de novo; passando disso, muda de destino.
  const blockedWaitMs = 350
  const blockedTries = 4
  const panDragPx = 6

  // A pose de sono do PMD olha para ↙ em quase todas as espécies. Quem dorme
  // olhando para a direita (↘ → ↗) usa a pose espelhada, para não virar de lado.
  function sleepFlip(walker: Walker): boolean {
    return walker.anim === 'Sleep' && walker.dir >= 1 && walker.dir <= 3
  }

  // Onde o Zzz nasce, a partir do ponto do chão: perto do focinho, um pouco à
  // frente e abaixo do alto da cabeça (dado do manifest), e sobe para a frente.
  // A pose de sono olha para ↙, então "frente" é a esquerda (direita se espelhada).
  // Sem o dado, um pouco acima do sprite.
  const zzzForward = 4
  const zzzDrop = 3
  function zzzSpot(walker: Walker, look: GardenLook): { x: number; y: number; drift: number } {
    if (look.kind === 'pmd' && look.anims.Sleep.head) {
      const sheet = look.anims.Sleep
      const ground = groundAt(sheet, walker.dir, 0)
      const [headX = 0, headY = 0] = sheet.head ?? []
      const forward = sleepFlip(walker) ? 1 : -1
      // Espelhado, o pixel x vira (w - 1 - x): a distância ao chão troca de sinal.
      const x = ((headX - ground.x) * -forward + zzzForward * forward) * pmdScale
      return { x, y: (headY + zzzDrop - ground.y) * pmdScale, drift: forward }
    }
    const lift = look.kind === 'pmd' ? 22 * pmdScale : showdownSize * scale * 0.6
    return { x: 0, y: -lift, drift: 1 }
  }

  /**
   * Ponto do nome e do balão: logo acima do alto da cabeça (px a partir do
   * chão), pela posição da cabeça que a folha PMD traz para cada direção.
   */
  function headAnchor(walker: Walker, look: GardenLook): { x: number; y: number } {
    const gap = Math.max(4, 4 * scale)
    if (look.kind !== 'pmd') return { x: 0, y: -(showdownSize * scale + gap) }
    const sheet = look.anims[walker.anim] ?? look.anims.Idle
    const row = sheet.dirs <= 1 ? 0 : Math.min(walker.dir, sheet.dirs - 1)
    const ground = groundAt(sheet, row, 0)
    const headX = sheet.head?.[row * 2]
    const headY = sheet.head?.[row * 2 + 1]
    if (headX === undefined || headY === undefined) return { x: 0, y: -(ground.y * pmdScale + gap) }
    const flip = sleepFlip(walker) ? -1 : 1
    return { x: (headX + 0.5 - ground.x) * pmdScale * flip, y: (headY - ground.y) * pmdScale - gap }
  }

  function inPlay(col: number, row: number): boolean {
    return col >= playCol0 && col < playColEnd && row >= playRow0 && row < playRowEnd
  }

  // Horta: um espaço reservado de 2×2 blocos perto do canto de baixo, com os 4
  // canteiros (PLOT_SLOT_LEVELS no servidor); os ainda fechados aparecem com
  // cadeado. É a primeira "estrutura" do jardim: as máquinas (5.16) seguem o
  // mesmo molde de blocos reservados.
  const hortaCol0 = playCol0 + 1
  const hortaRow0 = playRowEnd - 3
  const hortaCols = 2
  const hortaRows = 2

  function isPlotCell(col: number, row: number): boolean {
    return col >= hortaCol0 && col < hortaCol0 + hortaCols && row >= hortaRow0 && row < hortaRow0 + hortaRows
  }

  function plotIndexAt(col: number, row: number): number {
    return (row - hortaRow0) * hortaCols + (col - hortaCol0)
  }

  // Árvore de Apricorn (5.23): um bloco ao lado da horta, com uma casa livre
  // entre os dois para o passeio. As raízes formam um losango pequeno com o
  // centro 2 pixels (da arte) acima da última linha: é esse centro que pisa no
  // meio do bloco. A máquina é diferente: a última linha dela é a ponta de baixo
  // do losango do chão, então ela se apoia na ponta de baixo do bloco.
  const TREE_FOOT = 2
  const treeCol = hortaCol0 + hortaCols + 1
  const treeRow = hortaRow0 + 1
  /** Onde fica cada árvore: a vermelha ao lado da horta, as outras depois da bancada. */
  const TREE_CELLS: Record<string, { col: number; row: number }> = {
    apricorn_tree: { col: treeCol, row: treeRow },
    apricorn_tree_blue: { col: treeCol + 4, row: treeRow },
    apricorn_tree_yellow: { col: treeCol + 6, row: treeRow },
  }

  function isTreeCell(col: number, row: number): boolean {
    return Object.values(TREE_CELLS).some((cell) => cell.col === col && cell.row === row)
  }

  // Bancada de bolas (5.23): ao lado da árvore, com uma casa no meio. O
  // operador sai do passeio e fica nessa casa, virado para a máquina.
  const benchCol = treeCol + 2
  const benchRow = treeRow
  const operatorCol = benchCol - 1
  const operatorRow = benchRow
  const hasOperator = $derived(game.garden.bench.operatorId !== null)

  function isBenchCell(col: number, row: number): boolean {
    return (col === benchCol && row === benchRow) || (hasOperator && col === operatorCol && row === operatorRow)
  }

  function isWalkable(col: number, row: number): boolean {
    return inPlay(col, row) && !isPlotCell(col, row) && !isTreeCell(col, row) && !isBenchCell(col, row)
  }

  type Walker = {
    id: number
    speciesId: number
    displayName: string
    level: number
    isShiny: boolean
    col: number
    row: number
    dir: number
    anim: PmdAnimName
  }

  let lawn = $state<HTMLDivElement | null>(null)
  let scale = $state(1)
  let lawnW = $state(0)
  let lawnH = $state(0)
  let stageBoxW = $state(0)
  let stageBoxH = $state(0)
  let panX = $state(0)
  let panY = $state(0)
  /** Já escolheu zoom inicial e centrou a câmera nesta montagem. */
  let viewSeeded = false
  let time = $state(0)
  let walkers = $state<Walker[]>([])
  // Comandos de teste (botão no card em modo dev), ligados pelo $effect do passeio.
  let devCommands: { sleep: (id: number) => void; wake: (id: number) => void } | null = null
  const devTools = $derived(game.devTools)

  type Step = { col: number; row: number; dir: number }

  const tileW = $derived(baseTileW * scale)
  const tileH = $derived(baseTileH * scale)
  // Escala do sprite em pixels inteiros da tela (escala do Windows, zoom do
  // navegador): senão os pixels saem de tamanhos diferentes.
  const pmdScale = $derived(snapPixelScale(2 * scale))
  /** Pixel do balão: o mesmo tamanho dos pixels do sprite, sem passar de 2× no zoom alto. */
  const bubblePx = $derived(Math.min(pmdScale, snapPixelScale(2)))
  const halfW = $derived(tileW / 2)
  const halfH = $derived(tileH / 2)

  const gardenPokemon = $derived(
    [...game.pokemon.filter((mon) => mon.location === 'garden' && mon.id !== game.garden.bench.operatorId)]
      .sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
        return a.id - b.id
      })
      .slice(0, game.gardenMaxVisible),
  )

  const selected = $derived(game.pokemon.find((mon) => mon.id === selectedId) ?? null)

  // Balão de diálogo (5.21), como nos jogos de fazenda: o coração fica fixo
  // enquanto dá para fazer carinho (tocar no balão ou no Pokémon faz o
  // carinho); a fruta fica fixa enquanto está com fome; a carinha triste quando a
  // felicidade está baixa; a feliz logo depois do carinho e, de vez em quando,
  // em quem está feliz e de barriga cheia.
  let happyUntil = $state<Record<number, number>>({})
  let petting = $state<Record<number, boolean>>({})
  // Quem está feliz sorri de vez em quando, um por vez em horários diferentes
  // (a fase vem do id): uns 3 s a cada ~40 s.
  const SMILE_EVERY_MS = 40_000
  const SMILE_FOR_MS = 3_000
  function smileNow(id: number, now: number): boolean {
    return (now + id * 7919) % SMILE_EVERY_MS < SMILE_FOR_MS
  }
  // A fome fica fixa, como o coração; quando os dois valem, trocam a cada 3 s.
  const ALTERNATE_MS = 3_000
  function alternateNow(id: number, now: number): boolean {
    return Math.floor((now + id * 977) / ALTERNATE_MS) % 2 === 0
  }
  const bubbleById = $derived.by(() => {
    const now = clock.now()
    const out = new Map<number, BubbleKind>()
    for (const mon of game.pokemon) {
      const hungry = mon.pet.hunger < game.garden.needThreshold
      const canPet = (mon.pet.petReadyAt === null || mon.pet.petReadyAt <= now) && mon.pet.affection < 90
      if ((happyUntil[mon.id] ?? 0) > Date.now()) out.set(mon.id, 'happy')
      // Com fome e querendo carinho, os dois balões se alternam (cada um no seu ritmo, pelo id).
      else if (hungry && canPet) out.set(mon.id, alternateNow(mon.id, now) ? 'hunger' : 'pet')
      else if (hungry) out.set(mon.id, 'hunger')
      else if (canPet) out.set(mon.id, 'pet')
      else if (mon.pet.happiness < 35) out.set(mon.id, 'sad')
      else if (mon.pet.happiness >= 60 && mon.pet.hunger >= game.garden.needThreshold && smileNow(mon.id, now))
        out.set(mon.id, 'happy')
    }
    return out
  })

  async function onBubble(id: number, kind: BubbleKind) {
    if (kind !== 'pet') {
      selectedId = id
      return
    }
    if (petting[id]) return
    petting[id] = true
    try {
      const response = await api(`/api/garden/pets/${id}/pet`, {})
      if (!response.ok) {
        showGiftToast(errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError))
        return
      }
      happyUntil[id] = Date.now() + 2500
      setTimeout(() => {
        if ((happyUntil[id] ?? 0) <= Date.now()) delete happyUntil[id]
      }, 2600)
      play('levelup')
      await onState()
    } finally {
      delete petting[id]
    }
  }

  // Presentes no chão: cada um numa casa fixa (pelo id), fora dos canteiros.
  const giftSpots = $derived.by(() => {
    void game.plotSlotsUnlocked
    const spots = walkableSpots()
    return game.garden.gifts.map((gift) => ({
      gift,
      spot: spots[(gift.id * 7919) % Math.max(1, spots.length)] ?? { col: playCol0, row: playRow0 },
    }))
  })
  let giftToast = $state('')
  let giftToastTimer: ReturnType<typeof setTimeout> | null = null

  async function collectGift(gift: GardenGift) {
    const response = await api(`/api/garden/gifts/${gift.id}/collect`, {})
    if (response.ok) {
      showGiftToast(`Ganhou ${giftLabel(gift.itemKey, gift.quantity, game.berries, game.balls.list)}!`)
      play('harvest')
    } else {
      showGiftToast(errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError))
    }
    await onState()
  }

  // Pendurados agora: o que o servidor contou mais os que ficaram prontos depois.
  function readyOf(tree: TreeView, now: number): number {
    return Math.min(tree.cap, tree.ready + tree.readyAts.filter((at) => at <= now).length)
  }
  const treeReady = $derived.by(() => {
    const now = clock.now()
    return new Map(game.garden.trees.map((tree) => [tree.key, readyOf(tree, now)]))
  })
  // Marcador de tempo de cada árvore: quantos estão pendurados, quanto falta
  // para o próximo nascer e a barrinha dele. Cheia, só "cheia".
  const treeTimers = $derived.by(() => {
    const now = clock.now()
    const out = new Map<string, { text: string; progress: number }>()
    for (const tree of game.garden.trees) {
      const ready = treeReady.get(tree.key) ?? 0
      if (!tree.unlocked || ready >= tree.cap) continue
      const next = tree.readyAts.find((at) => at > now)
      if (next === undefined) continue
      out.set(tree.key, {
        text: `${ready}/${tree.cap} · ${formatCountdown(next - now)}`,
        progress: Math.max(0, Math.min(1, 1 - (next - now) / tree.unitMs)),
      })
    }
    return out
  })
  let treeShake = $state<string | null>(null)
  let treeArts = $state<Partial<Record<TreeColor, TreeArt>>>({})
  $effect(() => {
    for (const color of ['red', 'blue', 'yellow'] as const) {
      void loadTreeArt(color).then((art) => (treeArts = { ...treeArts, [color]: art }))
    }
  })
  let harvestingTree = $state(false)

  function unlockText(tree: TreeView): string {
    return 'trainerLevel' in tree.unlock
      ? `abre no nível ${tree.unlock.trainerLevel} de treinador`
      : `abre com a bancada no nível ${tree.unlock.benchLevel}`
  }

  async function onTree(tree: TreeView) {
    const name = itemLabel(tree.itemKey, game.berries)
    if (!tree.unlocked) {
      showGiftToast(`A árvore de ${name} ${unlockText(tree)}.`)
      return
    }
    const ready = treeReady.get(tree.key) ?? 0
    if (ready === 0) {
      const next = tree.readyAts.find((at) => at > clock.now())
      showGiftToast(next ? `Próximo ${name} em ${formatCountdown(next - clock.now())}.` : 'Nada para colher agora.')
      return
    }
    if (harvestingTree) return
    harvestingTree = true
    treeShake = tree.key
    setTimeout(() => (treeShake = null), 450)
    try {
      const response = await api('/api/garden/tree/harvest', { key: tree.key })
      if (response.ok) {
        const body = (await response.json()) as { quantity: number; itemKey: string }
        showGiftToast(`Colheu ${body.quantity} ${itemLabel(body.itemKey, game.berries)}${body.quantity === 1 ? '' : ' ×' + body.quantity}!`)
        play('harvest')
      } else {
        showGiftToast(errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError))
      }
      await onState()
    } finally {
      harvestingTree = false
    }
  }

  const benchOperator = $derived(game.pokemon.find((mon) => mon.id === game.garden.bench.operatorId) ?? null)
  /** Quadro parado da máquina: pronta (lote acabado com bolas esperando) ou parada. */
  const benchState = $derived.by((): 'idle' | 'working' | 'ready' => {
    const job = game.garden.bench.job
    if (!job) return 'idle'
    return benchDone(job, clock.now()) >= job.quantity ? 'ready' : 'working'
  })
  /** Quadro do trabalho, pelo relógio da animação. */
  const benchWork = $derived(
    game.garden.bench.unlocked && benchState === 'working' ? benchWorkFrame(time) : null,
  )
  /** Poké Balls prontas no lote, esperando coletar. */
  const benchReady = $derived.by(() => {
    const job = game.garden.bench.job
    return job ? (benchDone(job, clock.now()) - job.collected) * job.perUnit : 0
  })
  let benchOpen = $state(false)
  // Marcador de tempo da máquina: bolas já prontas, quanto falta para o lote
  // acabar e a barrinha do lote. Acabado, fica só "N prontas".
  const benchTimer = $derived.by(() => {
    const bench = game.garden.bench
    const now = clock.now()
    // Upgrade em andamento: o nível novo e quanto falta.
    if (bench.upgrade) {
      const total = Math.max(1, bench.upgrade.endsAt - bench.upgrade.startedAt)
      return {
        text: `Nv ${bench.upgrade.toLevel} · ${formatCountdown(bench.upgrade.endsAt - now)}`,
        progress: Math.max(0, Math.min(1, (now - bench.upgrade.startedAt) / total)),
      }
    }
    const job = bench.job
    if (!job || benchState !== 'working') return null
    const endsAt = job.startedAt + job.quantity * job.unitMs
    return {
      text: `${benchReady > 0 ? `${benchReady} · ` : ''}${formatCountdown(endsAt - now)}`,
      progress: Math.max(0, Math.min(1, (now - job.startedAt) / (job.quantity * job.unitMs))),
    }
  })

  function onBench() {
    const bench = game.garden.bench
    if (!bench.unlocked) {
      showGiftToast(`A bancada de bolas abre no nível ${bench.unlockLevel} de treinador.`)
      return
    }
    play('tap')
    benchOpen = true
  }

  function showLockedPlot() {
    showGiftToast(game.nextPlotSlotLevel ? `Esse canteiro abre no nível ${game.nextPlotSlotLevel} de treinador.` : 'Canteiro fechado.')
  }

  function showGiftToast(text: string) {
    giftToast = text
    if (giftToastTimer) clearTimeout(giftToastTimer)
    giftToastTimer = setTimeout(() => (giftToast = ''), 2200)
  }
  const selectedAsleep = $derived(walkers.find((walker) => walker.id === selectedId)?.anim === 'Sleep')

  // Quanto os sprites passam do ponto do chão, em px na escala 1. Depende só de
  // quem está no jardim, não da animação atual: senão o palco muda de tamanho
  // quando alguém troca de animação e o jardim inteiro pula.
  const extent = $derived.by(() => {
    const out = { side: 0, up: 0, down: 0 }
    for (const mon of gardenPokemon) {
      const reach = gardenExtent(gardenSprite(mon.speciesId, mon.isShiny))
      out.side = Math.max(out.side, reach.left, reach.right)
      out.up = Math.max(out.up, reach.up)
      out.down = Math.max(out.down, reach.down)
    }
    return out
  })

  const padX = $derived(Math.max(0, extent.side * scale - halfW))
  const padTop = $derived(Math.max(0, extent.up * scale - halfH))
  const padBottom = $derived(Math.max(0, extent.down * scale - halfH))

  const originX = $derived(worldRows * halfW + padX)
  const originY = $derived(padTop)
  const stageW = $derived((worldCols + worldRows) * halfW + padX * 2)
  const stageH = $derived(originY + (worldCols + worldRows) * halfH + padBottom)

  function metricsFor(nextScale: number) {
    const hw = (baseTileW * nextScale) / 2
    const hh = (baseTileH * nextScale) / 2
    const px = Math.max(0, extent.side * nextScale - hw)
    const pt = Math.max(0, extent.up * nextScale - hh)
    const pb = Math.max(0, extent.down * nextScale - hh)
    const ox = worldRows * hw + px
    const oy = pt
    const sw = (worldCols + worldRows) * hw + px * 2
    const sh = oy + (worldCols + worldRows) * hh + pb
    return { hw, hh, ox, oy, sw, sh }
  }

  // O chão é desenhado no canvas (floor); só os canteiros viram elemento, para o toque.
  const tiles = $derived(
    Array.from({ length: playCols * playRows }, (_, index) => ({
      col: playCol0 + (index % playCols),
      row: playRow0 + Math.floor(index / playCols),
    })).filter((tile) => isPlotCell(tile.col, tile.row)),
  )

  // Fundo do gramado: losangos iguais aos ladrilhos, em verde mais escuro, que
  // seguem o pan e o zoom. Cada quadro do padrão (tileW × tileH) tem um
  // losango inteiro no meio (cor dos ladrilhos sem .alt) e os cantos na cor
  // .alt, então o xadrez continua o dos ladrilhos sem emenda.
  // Chão em blocos (5.22): os tiles de art/tiles/ entram no build pelo glob.
  // A zona jogável é um canvas (grama, e terra nos canteiros, com as bordas);
  // fora dela, o fundo do gramado é um padrão de grama que se repete.
  const tileFiles = import.meta.glob('../../../art/tiles/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
  let floorAssets = $state<FloorAssets | null>(null)
  let lawnPatternUrl = $state<string | null>(null)
  let floorCanvas = $state<HTMLCanvasElement | null>(null)
  /** Escala da arte (24×12) para o bloco do jardim (48×24 no zoom 1). */
  const floorScale = $derived(tileW / TILE_W)
  const floorW = (playCols + playRows) * (TILE_W / 2)
  const floorH = (playCols + playRows) * (TILE_H / 2)
  const floorOriginX = playRows * (TILE_W / 2)

  $effect(() => {
    void buildFloorAssets(
      Object.entries(tileFiles).map(([file, url]) => ({ name: file.slice(file.lastIndexOf('/') + 1), url })),
    ).then((assets) => {
      floorAssets = assets
      lawnPatternUrl = floorPattern(assets, 'grama')?.toDataURL() ?? null
    })
  })

  $effect(() => {
    if (!floorCanvas || !floorAssets) return
    const cells: (string | null)[] = []
    for (let row = 0; row < playRows; row += 1) {
      for (let col = 0; col < playCols; col += 1) {
        cells.push(isPlotCell(playCol0 + col, playRow0 + row) ? 'canteiro' : 'grama')
      }
    }
    const grid: TerrainGrid = { cols: playCols, rows: playRows, cells }
    const ctx = floorCanvas.getContext('2d')!
    ctx.clearRect(0, 0, floorW, floorH)
    drawFloor(ctx, grid, floorAssets, { offsetX: floorOriginX })
  })

  const floorBox = $derived.by(() => {
    const spot = place(playCol0, playRow0)
    return { left: spot.x - floorOriginX * floorScale, top: spot.y }
  })

  // Fundo do gramado: o padrão de grama acompanha o pan e o zoom, com o vértice
  // de um bloco no canto do padrão (o padrão é um período da grade).
  const lawnBackground = $derived.by(() => {
    const spot = place(playCol0, playRow0)
    const size = (lawnPatternUrl ? 4 : 1) * floorScale
    return {
      image: lawnPatternUrl ? `url("${lawnPatternUrl}")` : 'none',
      size: `${size * TILE_W}px ${size * TILE_H}px`,
      position: `${panX + spot.x}px ${panY + spot.y}px`,
    }
  })

  // O click cai no quadro do sprite (ou do presente) da frente, que tem muita
  // folga transparente. Vale o primeiro, da frente para trás, com pixel visível
  // sob o ponto. Sem pixel em nenhum, ou máscara ainda carregando, fica quem
  // recebeu o click. Teclado (detail 0) não tem ponto: fica o botão focado.
  function onGardenTap(event: MouseEvent, clicked: GardenHit) {
    const picked = event.detail > 0 ? pickAt(event.clientX, event.clientY) : undefined
    // O arbusto é um retângulo com muito vazio por cima dos canteiros de trás:
    // tocado no vazio, vale o canteiro (losango) sob o dedo, se houver.
    if (picked === null && clicked.kind === 'plot') {
      const under = plotTileAt(event.clientX, event.clientY)
      if (under !== null) openPlot(under)
      return
    }
    const hit = picked ?? clicked
    if (hit.kind === 'plot') {
      openPlot(hit.id)
      return
    }
    if (hit.kind === 'gift') {
      const gift = game.garden.gifts.find((g) => g.id === hit.id)
      if (gift) void collectGift(gift)
      return
    }
    const walker = walkers.find((w) => w.id === hit.id)
    if (!walker) return
    // Como nos jogos de fazenda: tocar em quem quer carinho já faz o carinho.
    if (bubbleById.get(walker.id) === 'pet') {
      void onBubble(walker.id, 'pet')
      return
    }
    selectedId = walker.id
    playCry(walker.speciesId)
  }

  function place(col: number, row: number): { x: number; y: number } {
    return {
      x: originX + (col - row) * halfW,
      y: originY + (col + row) * halfH,
    }
  }

  /** Limita o pan para a viewport não alcançar a borda do mundo (gramado “sem fim”). */
  function clampPan(x: number, y: number, viewW: number, viewH: number, sw: number, sh: number): { x: number; y: number } {
    // Folga ~2 tiles: a câmera para antes da última fileira do estágio.
    const padX = Math.min(viewW * 0.35, baseTileW * scale * 2)
    const padY = Math.min(viewH * 0.35, baseTileH * scale * 4)
    let minX: number
    let maxX: number
    let minY: number
    let maxY: number
    if (sw <= viewW) {
      minX = maxX = (viewW - sw) / 2
    } else {
      minX = viewW - sw + padX
      maxX = -padX
      if (minX > maxX) {
        minX = maxX = (viewW - sw) / 2
      }
    }
    if (sh <= viewH) {
      minY = maxY = (viewH - sh) / 2
    } else {
      minY = viewH - sh + padY
      maxY = -padY
      if (minY > maxY) {
        minY = maxY = (viewH - sh) / 2
      }
    }
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    }
  }

  function centerPanOnPlay(viewW: number, viewH: number, sw: number, sh: number, hw: number, hh: number, ox: number, oy: number) {
    const midCol = playCol0 + (playCols - 1) / 2
    const midRow = playRow0 + (playRows - 1) / 2
    const cx = ox + (midCol - midRow) * hw
    const cy = oy + (midCol + midRow) * hh + hh
    return clampPan(viewW / 2 - cx, viewH / 2 - cy, viewW, viewH, sw, sh)
  }

  /** Arredonda para o passo de zoom, dentro de 1–3. */
  function snapScale(raw: number): number {
    const snapped = Math.round(raw / scaleStep) * scaleStep
    return Math.min(scaleMax, Math.max(scaleMin, snapped))
  }

  /**
   * Muda o zoom mantendo parado o ponto do jardim que está sob `focus` (o
   * mouse ou o meio da pinça, em px do gramado). Sem `focus`, usa o centro.
   */
  function applyZoom(nextRaw: number, focus?: { x: number; y: number }) {
    const nextScale = snapScale(nextRaw)
    const prevScale = untrack(() => scale)
    if (nextScale === prevScale) return
    const node = lawn
    const viewW = node?.clientWidth ?? lawnW
    const viewH = node?.clientHeight ?? lawnH
    const prevPanX = untrack(() => panX)
    const prevPanY = untrack(() => panY)
    const { sw, sh } = metricsFor(nextScale)
    stageBoxW = sw
    stageBoxH = sh
    scale = nextScale
    saveZoom(nextScale)
    if (!viewW || !viewH) return
    const fx = focus?.x ?? viewW / 2
    const fy = focus?.y ?? viewH / 2
    const ratio = nextScale / prevScale
    const clamped = clampPan(fx - (fx - prevPanX) * ratio, fy - (fy - prevPanY) * ratio, viewW, viewH, sw, sh)
    panX = clamped.x
    panY = clamped.y
  }

  // O zoom escolhido fica no aparelho, como o volume: volta igual depois do F5.
  const zoomKey = 'pm-garden-zoom'
  /** Nomes/níveis sobre os Pokémon: ligado por padrão; o olho guarda a escolha. */
  const labelsKey = 'pm-garden-labels'

  function loadZoom(): number | null {
    try {
      const value = Number(localStorage.getItem(zoomKey))
      return value >= scaleMin && value <= scaleMax ? value : null
    } catch {
      return null
    }
  }

  function saveZoom(value: number) {
    try {
      localStorage.setItem(zoomKey, String(value))
    } catch {
      // Sem armazenamento (aba anônima, bloqueado): só não lembra.
    }
  }

  function loadLabels(): boolean {
    try {
      const value = localStorage.getItem(labelsKey)
      if (value === '0') return false
      if (value === '1') return true
    } catch {
      /* sem storage */
    }
    return true
  }

  function saveLabels(on: boolean) {
    try {
      localStorage.setItem(labelsKey, on ? '1' : '0')
    } catch {
      /* sem storage */
    }
  }

  let showLabels = $state(loadLabels())
  // Grade de teste (só com DEV_TOOLS): contorno de cada bloco e os ocupados pintados.
  let showGrid = $state(false)

  function toggleLabels() {
    showLabels = !showLabels
    saveLabels(showLabels)
  }

  /** Ponto do evento em px do gramado. */
  function lawnPoint(clientX: number, clientY: number): { x: number; y: number } {
    const box = lawn?.getBoundingClientRect()
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) }
  }

  // Rodinha do mouse: um passo de zoom a cada "dente". O touchpad manda vários
  // deltas pequenos, então soma até passar do limiar.
  $effect(() => {
    const node = lawn
    if (!node) return
    let acc = 0
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY
      acc += delta
      if (Math.abs(acc) < wheelStepPx) return
      const direction = acc < 0 ? 1 : -1
      acc = 0
      applyZoom(untrack(() => scale) + direction * scaleStep, lawnPoint(event.clientX, event.clientY))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  })

  $effect(() => {
    const node = lawn
    if (!node) {
      viewSeeded = false
      return
    }
    const measure = () => {
      const viewW = node.clientWidth
      const viewH = node.clientHeight
      lawnW = viewW
      lawnH = viewH
      if (!viewSeeded) {
        viewSeeded = true
        // Abertura mais afastada que o encaixe apertado de ~5 tiles.
        const nextScale = snapScale(loadZoom() ?? viewW / (defaultViewTiles * baseTileW))
        scale = nextScale
        const { hw, hh, ox, oy, sw, sh } = metricsFor(nextScale)
        stageBoxW = sw
        stageBoxH = sh
        const centered = centerPanOnPlay(viewW, viewH, sw, sh, hw, hh, ox, oy)
        panX = centered.x
        panY = centered.y
        return
      }
      const current = untrack(() => scale)
      const { sw, sh } = metricsFor(current)
      stageBoxW = sw
      stageBoxH = sh
      // Não ler pan reativo aqui: senão cada arrasto recria o observer.
      const clamped = clampPan(untrack(() => panX), untrack(() => panY), viewW, viewH, sw, sh)
      panX = clamped.x
      panY = clamped.y
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  })

  // Pan por arrastar: limiar evita roubar toque em canteiro/Pokémon.
  // Dois dedos: pinça de zoom (o pan para até sobrar um dedo só).
  $effect(() => {
    const node = lawn
    if (!node) return
    let pointerId: number | null = null
    let startX = 0
    let startY = 0
    let originPanX = 0
    let originPanY = 0
    let dragging = false
    let suppressClick = false
    const touches = new Map<number, { x: number; y: number }>()
    let pinchBase = 0

    const pinchDistance = () => {
      const [a, b] = [...touches.values()]
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    }

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      // Prepara as máscaras dos sprites sob o dedo para o click (onGardenTap).
      warmSpriteMasks(event.clientX, event.clientY)
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (touches.size === 2) {
          pinchBase = pinchDistance()
          pointerId = null
          dragging = false
          suppressClick = true
          return
        }
      }
      if (touches.size > 1) return
      pointerId = event.pointerId
      startX = event.clientX
      startY = event.clientY
      originPanX = panX
      originPanY = panY
      dragging = false
    }

    const onMove = (event: PointerEvent) => {
      if (touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (touches.size === 2 && pinchBase > 0) {
          const distance = pinchDistance()
          const ratio = distance / pinchBase
          if (ratio >= pinchStepRatio || ratio <= 1 / pinchStepRatio) {
            const [a, b] = [...touches.values()]
            const mid = lawnPoint((a!.x + b!.x) / 2, (a!.y + b!.y) / 2)
            applyZoom(untrack(() => scale) + (ratio > 1 ? scaleStep : -scaleStep), mid)
            pinchBase = distance
          }
          return
        }
      }
      if (pointerId !== event.pointerId) return
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (!dragging) {
        if (dx * dx + dy * dy < panDragPx * panDragPx) return
        dragging = true
        suppressClick = true
        try {
          node.setPointerCapture(event.pointerId)
        } catch {
          // Alguns alvos já capturam; seguimos sem capture.
        }
      }
      const next = clampPan(originPanX + dx, originPanY + dy, lawnW, lawnH, stageBoxW, stageBoxH)
      panX = next.x
      panY = next.y
    }

    const onUp = (event: PointerEvent) => {
      if (touches.delete(event.pointerId) && touches.size < 2) pinchBase = 0
      if (pointerId !== event.pointerId) return
      pointerId = null
      if (dragging) {
        try {
          node.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }
      dragging = false
    }

    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    // Sem isso, um clique que começa numa imagem (sprite, berry) ou em algo
    // selecionado às vezes vira o arrasto nativo do navegador (a "imagem
    // fantasma"), que engole os pointermove e trava o pan até soltar.
    const onDragStart = (event: DragEvent) => event.preventDefault()
    node.addEventListener('dragstart', onDragStart)
    node.addEventListener('pointerdown', onDown)
    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerup', onUp)
    node.addEventListener('pointercancel', onUp)
    node.addEventListener('click', onClickCapture, true)
    return () => {
      node.removeEventListener('dragstart', onDragStart)
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', onUp)
      node.removeEventListener('pointercancel', onUp)
      node.removeEventListener('click', onClickCapture, true)
    }
  })

  $effect(() => {
    for (const mon of gardenPokemon) {
      const look = gardenSprite(mon.speciesId, mon.isShiny)
      if (look.kind === 'pmd') preloadPmd(mon.speciesId, look.shinySheet)
    }
  })

  // Quem está no jardim e com qual sprite. O passeio só recomeça quando isso
  // muda: o estado novo (presente, carinho, missão) não pode parar todo mundo.
  const gardenKey = $derived(gardenPokemon.map((mon) => `${mon.id}:${mon.speciesId}:${mon.isShiny ? 1 : 0}`).join('|'))

  // Nome e nível mudam sem recomeçar o passeio.
  $effect(() => {
    const byId = new Map(gardenPokemon.map((mon) => [mon.id, mon]))
    for (const walker of untrack(() => walkers)) {
      const mon = byId.get(walker.id)
      if (!mon) continue
      const name = mon.nickname ?? mon.displayName
      if (walker.displayName !== name) walker.displayName = name
      if (walker.level !== mon.level) walker.level = mon.level
    }
  })

  $effect(() => {
    void gardenKey
    const mons = untrack(() => gardenPokemon)
    // Cada um nasce numa casa sorteada do jardim todo, olhando para um lado
    // qualquer (antes saíam em ordem e se amontoavam no canto de cima).
    // Provisório: o PC e os biomas vão decidir onde cada um fica.
    // Quem já estava andando fica onde está: o estado novo (coletar um
    // presente, dar carinho) não pode embaralhar o jardim.
    const previous = new Map(untrack(() => walkers).map((walker) => [walker.id, walker]))
    const taken = new Set<string>()
    const kept = new Map<number, { col: number; row: number; dir: number }>()
    for (const mon of mons) {
      const before = previous.get(mon.id)
      if (!before) continue
      const col = Math.round(before.col)
      const row = Math.round(before.row)
      if (!isWalkable(col, row) || taken.has(`${col},${row}`)) continue
      taken.add(`${col},${row}`)
      kept.set(mon.id, { col, row, dir: before.dir })
    }
    const spots = shuffled(walkableSpots()).filter((spot) => !taken.has(`${spot.col},${spot.row}`))
    let nextSpot = 0
    const created = mons.map((mon) => {
      const spot =
        kept.get(mon.id) ?? spots[nextSpot++ % Math.max(1, spots.length)] ?? { col: playCol0, row: playRow0 }
      return {
        id: mon.id,
        speciesId: mon.speciesId,
        displayName: mon.nickname ?? mon.displayName,
        level: mon.level,
        isShiny: mon.isShiny,
        col: spot.col,
        row: spot.row,
        dir: kept.get(mon.id)?.dir ?? Math.floor(Math.random() * 8),
        anim: 'Idle' as const,
      }
    })
    walkers = created
    const live = untrack(() => walkers)

    // Uma casa, um Pokémon. Cada um é dono da casa onde está e reserva a
    // próxima antes de dar o passo; só solta a de trás ao chegar. Se a próxima
    // tem dono, espera parado e tenta de novo; depois de algumas vezes desiste
    // e escolhe outro destino (assim dois cara a cara não travam).
    const occupied = new Map<string, number>()
    const cell = (col: number, row: number) => `${col},${row}`
    const takenByOther = (walker: Walker) => (col: number, row: number) => {
      const holder = occupied.get(cell(col, row))
      return holder !== undefined && holder !== walker.id
    }
    function reserve(walker: Walker, col: number, row: number): boolean {
      if (takenByOther(walker)(col, row)) return false
      occupied.set(cell(col, row), walker.id)
      return true
    }
    function release(walker: Walker, col: number, row: number) {
      const key = cell(col, row)
      if (occupied.get(key) === walker.id) occupied.delete(key)
    }
    /** Solta tudo o que ele segura e fica só com a casa onde está agora. */
    function settle(walker: Walker) {
      for (const [key, holder] of occupied) if (holder === walker.id) occupied.delete(key)
      reserve(walker, Math.round(walker.col), Math.round(walker.row))
    }
    for (const walker of live) reserve(walker, walker.col, walker.row)

    let cancelled = false
    const frames: number[] = []
    const waits: number[] = []
    // Cada Pokémon segue um plano (passear, dormir…). Trocar o número do plano
    // faz os timers e frames pendentes do plano antigo pararem sozinhos.
    const plans = new Map<number, number>()
    const alive = (walker: Walker, plan: number) => !cancelled && plans.get(walker.id) === plan

    function canSleep(walker: Walker): boolean {
      // O Sleep só tem a direção 0 (de frente). Só dorme quem já olha para ela
      // ou para uma vizinha (↘ ↙), para a troca não parecer um giro. Dorme
      // direto, sem virar: virar mostraria o Idle de frente para a câmera.
      const facing = (walker.dir - sleepDir + 8) % 8
      return facing <= 1 || facing >= 7
    }

    // Mantém a direção em que estava: o Sleep tem uma pose só, e a direção
    // decide se ela é espelhada (ver sleepFlip) e de onde ele vira ao acordar.
    function sleep(walker: Walker, plan: number) {
      walker.anim = 'Sleep'
      waits.push(
        window.setTimeout(() => wander(walker, plan), sleepMinMs + Math.random() * (sleepMaxMs - sleepMinMs)),
      )
    }

    function wander(walker: Walker, plan: number) {
      if (!alive(walker, plan)) return
      if (canSleep(walker) && Math.random() < sleepChance) {
        sleep(walker, plan)
        return
      }
      const hereCol = Math.round(walker.col)
      const hereRow = Math.round(walker.row)
      const target = pickWalkTarget(hereCol, hereRow, takenByOther(walker))
      if (!target) {
        waits.push(
          window.setTimeout(() => wander(walker, plan), idleMinMs + Math.random() * (idleMaxMs - idleMinMs)),
        )
        return
      }
      walkSteps(walker, plan, route(hereCol, hereRow, target.col, target.row), () => {
        walker.anim = 'Idle'
        waits.push(
          window.setTimeout(() => wander(walker, plan), idleMinMs + Math.random() * (idleMaxMs - idleMinMs)),
        )
      })
    }

    function walkSteps(walker: Walker, plan: number, steps: Step[], done: () => void) {
      let index = 0
      let blocked = 0
      const next = () => {
        if (!alive(walker, plan)) return
        const step = steps[index]
        if (!step) {
          done()
          return
        }
        if (!reserve(walker, step.col, step.row)) {
          // Casa da frente ocupada: espera parado; insistindo demais, desiste
          // do caminho (o done volta ao passeio, que sorteia outro destino).
          walker.anim = 'Idle'
          blocked += 1
          if (blocked > blockedTries) done()
          else waits.push(window.setTimeout(next, blockedWaitMs))
          return
        }
        blocked = 0
        index += 1
        turn(walker, plan, step.dir, () => {
          walker.anim = 'Walk'
          const fromCol = walker.col
          const fromRow = walker.row
          const started = performance.now()
          const tick = (now: number) => {
            if (!alive(walker, plan)) return
            const progress = Math.min(1, (now - started) / stepMs)
            walker.col = fromCol + (step.col - fromCol) * progress
            walker.row = fromRow + (step.row - fromRow) * progress
            if (progress < 1) frames.push(requestAnimationFrame(tick))
            else {
              const leftCol = Math.round(fromCol)
              const leftRow = Math.round(fromRow)
              // Saindo do meio de um passo, o arredondado pode ser a própria casa nova.
              if (leftCol !== step.col || leftRow !== step.row) release(walker, leftCol, leftRow)
              next()
            }
          }
          frames.push(requestAnimationFrame(tick))
        })
      }
      next()
    }

    // Gira parado (Idle), uma direção vizinha por vez, pelo lado mais curto.
    // Se já está olhando para lá, segue direto, sem interromper o Walk.
    function turn(walker: Walker, plan: number, target: number, done: () => void) {
      if (!alive(walker, plan)) return
      if (walker.dir === target) {
        done()
        return
      }
      const clockwise = (target - walker.dir + 8) % 8
      walker.anim = 'Idle'
      walker.dir = (walker.dir + (clockwise <= 4 ? 1 : 7)) % 8
      waits.push(window.setTimeout(() => turn(walker, plan, target, done), turnStepMs))
    }

    function start(walker: Walker, delay: number) {
      const plan = (plans.get(walker.id) ?? 0) + 1
      plans.set(walker.id, plan)
      settle(walker)
      waits.push(window.setTimeout(() => wander(walker, plan), delay))
    }

    // Só para testes: termina o passo atual, anda até ficar olhando para ↘ ou
    // ↙ e dorme.
    const sleepNow = (id: number) => {
      const walker = live.find((item) => item.id === id)
      if (!walker) return
      const plan = (plans.get(walker.id) ?? 0) + 1
      plans.set(walker.id, plan)

      // No meio de um passo, a posição é fracionada: o destino do passo é o
      // bloco seguinte na direção em que ele está andando.
      let col = walker.col
      let row = walker.row
      if (walker.dir === 1) col = Math.ceil(col)
      else if (walker.dir === 5) col = Math.floor(col)
      else if (walker.dir === 7) row = Math.ceil(row)
      else if (walker.dir === 3) row = Math.floor(row)
      col = Math.round(col)
      row = Math.round(row)
      // O passo interrompido segurava duas casas: fica só com a de destino.
      for (const [key, holder] of occupied) if (holder === walker.id) occupied.delete(key)
      reserve(walker, col, row)
      const steps: Step[] = []
      if (col !== walker.col || row !== walker.row) steps.push({ col, row, dir: walker.dir })

      // Terminar o passo não muda a direção, então dá para checar já.
      if (!canSleep(walker)) {
        if (isWalkable(col + 1, row)) steps.push({ col: col + 1, row, dir: 1 })
        else if (isWalkable(col, row + 1)) steps.push({ col, row: row + 1, dir: 7 })
        else if (isWalkable(col - 1, row)) steps.push({ col: col - 1, row, dir: 5 }, { col: col - 1, row, dir: 1 })
        else if (isWalkable(col, row - 1)) steps.push({ col, row: row - 1, dir: 3 }, { col, row: row - 1, dir: 1 })
      }
      walkSteps(walker, plan, steps, () => sleep(walker, plan))
    }

    // Só para testes: acorda e volta a passear.
    const wakeNow = (id: number) => {
      const walker = live.find((item) => item.id === id)
      if (!walker) return
      walker.anim = 'Idle'
      start(walker, idleMinMs)
    }

    devCommands = { sleep: sleepNow, wake: wakeNow }

    for (const walker of live) start(walker, 400)

    return () => {
      cancelled = true
      devCommands = null
      for (const frame of frames) cancelAnimationFrame(frame)
      for (const wait of waits) clearTimeout(wait)
    }
  })

  $effect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const loop = (now: number) => {
      time = now
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  })

  /** Cópia embaralhada (Fisher–Yates). */
  function shuffled<T>(items: T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[out[i], out[j]] = [out[j]!, out[i]!]
    }
    return out
  }

  function walkableSpots(): { col: number; row: number }[] {
    const spots: { col: number; row: number }[] = []
    for (let row = playRow0; row < playRowEnd; row += 1) {
      for (let col = playCol0; col < playColEnd; col += 1) {
        if (isWalkable(col, row)) spots.push({ col, row })
      }
    }
    return spots
  }

  function pickWalkTarget(
    hereCol: number,
    hereRow: number,
    taken: (col: number, row: number) => boolean,
  ): { col: number; row: number } | null {
    const spots = walkableSpots().filter(
      (spot) => (spot.col !== hereCol || spot.row !== hereRow) && !taken(spot.col, spot.row),
    )
    if (spots.length === 0) return null
    return spots[Math.floor(Math.random() * spots.length)] ?? null
  }

  /** Caminho em L que não pisa em canteiro; se precisar, sobe da fileira dos plots antes. */
  function route(fromCol: number, fromRow: number, toCol: number, toRow: number): Step[] {
    const direct = orthRoute(fromCol, fromRow, toCol, toRow, true)
    if (direct && pathClear(direct)) return direct
    const alt = orthRoute(fromCol, fromRow, toCol, toRow, false)
    if (alt && pathClear(alt)) return alt

    // Em cima de um canteiro (ou rota cruzando): sai para o norte e tenta de novo.
    if (isPlotCell(fromCol, fromRow) && isWalkable(fromCol, fromRow - 1)) {
      const escape: Step[] = [{ col: fromCol, row: fromRow - 1, dir: 3 }]
      return [...escape, ...route(fromCol, fromRow - 1, toCol, toRow)]
    }
    const viaRow = Math.min(fromRow, toRow, hortaRow0 - 1)
    const via = orthRoute(fromCol, fromRow, fromCol, viaRow, false)
    const rest = orthRoute(fromCol, viaRow, toCol, toRow, true)
    if (via && rest && pathClear(via) && pathClear(rest)) return [...via, ...rest]
    return []
  }

  function orthRoute(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    colFirst: boolean,
  ): Step[] {
    const steps: Step[] = []
    let col = fromCol
    let row = fromRow
    const runCol = () => {
      const delta = Math.sign(toCol - col)
      while (col !== toCol) {
        col += delta
        steps.push({ col, row, dir: delta > 0 ? 1 : 5 })
      }
    }
    const runRow = () => {
      const delta = Math.sign(toRow - row)
      while (row !== toRow) {
        row += delta
        steps.push({ col, row, dir: delta > 0 ? 7 : 3 })
      }
    }
    if (colFirst) {
      runCol()
      runRow()
    } else {
      runRow()
      runCol()
    }
    return steps
  }

  function pathClear(steps: Step[]): boolean {
    return steps.every((step) => isWalkable(step.col, step.row))
  }
</script>

<div class="layout">
  <div
    class="lawn"
    bind:this={lawn}
    aria-label="Jardim"
    style:background-image={lawnBackground.image}
    style:background-size={lawnBackground.size}
    style:background-position={lawnBackground.position}
  >
    <div
      class="stage"
      style:width="{stageW}px"
      style:height="{stageH}px"
      style:transform="translate({snapToDevice(panX)}px, {snapToDevice(panY)}px)"
    >
      <canvas
        class="floor"
        bind:this={floorCanvas}
        width={floorW}
        height={floorH}
        style:left="{floorBox.left}px"
        style:top="{floorBox.top}px"
        style:width="{floorW * floorScale}px"
        style:height="{floorH * floorScale}px"
        aria-hidden="true"
      ></canvas>
      {#each tiles as tile (`${tile.col}-${tile.row}`)}
        {@const spot = place(tile.col, tile.row)}
        {@const isPlot = isPlotCell(tile.col, tile.row)}
        {@const plotIdx = isPlot ? plotIndexAt(tile.col, tile.row) : -1}
        {@const locked = plotIdx >= game.plotSlotsUnlocked}
        {@const plot = isPlot ? plotsByIndex.get(plotIdx) : undefined}
        {@const stage = isPlot ? plotStage(plot) : null}
        {#if isPlot}
          <button
            type="button"
            class="tile plot"
            class:planted={stage === 'planted'}
            class:growing={stage === 'growing'}
            class:ready={stage === 'ready'}
            style:left="{spot.x}px"
            style:top="{spot.y}px"
            style:width="{tileW}px"
            style:height="{tileH}px"
            style:margin-left="{-halfW}px"
            style:z-index={tile.col + tile.row + depthSpan}
            class:locked
            data-plot={locked ? undefined : plotIdx}
            aria-label={locked ? `Canteiro ${plotIdx + 1}, fechado` : `Canteiro ${plotIdx + 1}`}
            onclick={() => (locked ? showLockedPlot() : openPlot(plotIdx))}
          >
            <!-- Sem arte para a berry: o desenho antigo do canteiro. -->
            {#if plot && !bushSrc(plot.berryKey, bushLook(plot))}
              {#if stage === 'planted'}
                <span class="crop sprout" aria-hidden="true"></span>
              {:else if stage === 'growing' || stage === 'dead'}
                <span class="crop bush" aria-hidden="true"></span>
              {:else if stage === 'ready'}
                <img class="crop berry" src={berryIconSrc(plot.berryKey)} alt="" />
              {/if}
            {/if}
          </button>
          <!-- O arbusto passa do losango do canteiro: fica fora do botão, sem pegar toque. -->
          {#if plot}
            {@const bush = bushSrc(plot.berryKey, bushLook(plot))}
            {#if bush}
              <!-- Tocar no arbusto também abre o canteiro (pixel a pixel, como os Pokémon). -->
              <button
                type="button"
                class="bush-art"
                class:ripe={stage === 'ready'}
                data-plot={plotIdx}
                tabindex="-1"
                aria-hidden="true"
                style:left="{snapToDevice(spot.x)}px"
                style:top="{snapToDevice(spot.y + halfH + BUSH_FOOT * pmdScale)}px"
                style:z-index={tile.col + tile.row + depthSpan + 1}
                onclick={(event) => onGardenTap(event, { kind: 'plot', id: plotIdx })}
              >
                <img src={bush} alt="" width={24 * pmdScale} height={32 * pmdScale} />
              </button>
            {/if}
          {/if}
        {/if}
      {/each}
      {#each game.garden.trees as tree (tree.key)}
        {@const cell = TREE_CELLS[tree.key]}
        {@const art = treeArts[tree.color]}
        {#if cell}
          {@const spot = place(cell.col, cell.row)}
          {@const ready = treeReady.get(tree.key) ?? 0}
          {@const timer = treeTimers.get(tree.key)}
          <button
            type="button"
            class="tree"
            class:locked={!tree.unlocked}
            class:shake={treeShake === tree.key}
            style:left="{snapToDevice(spot.x)}px"
            style:top="{snapToDevice(spot.y + halfH + TREE_FOOT * pmdScale)}px"
            style:z-index={cell.col + cell.row + depthSpan + 1}
            aria-label={!tree.unlocked
              ? `Árvore de ${itemLabel(tree.itemKey, game.berries)}, ${unlockText(tree)}`
              : `Árvore de ${itemLabel(tree.itemKey, game.berries)}: ${ready} de ${tree.cap}${tree.raining ? ', chuva acelerando' : ''}`}
            onclick={() => void onTree(tree)}
          >
            {#if art}
              <svg
                width={art.width * pmdScale}
                height={art.height * pmdScale}
                viewBox="0 0 {art.width} {art.height}"
                shape-rendering="crispEdges"
                aria-hidden="true"
              >
                {#each treePixels(art, tree.unlocked ? ready : 0) as px, index (index)}
                  <rect x={px.x} y={px.y} width="1" height="1" fill={px.color} />
                {/each}
              </svg>
            {/if}
            {#if tree.unlocked && ready >= tree.cap}
              <span class="tree-full" aria-hidden="true">cheia</span>
            {:else if timer}
              <span class="tree-full timer" aria-hidden="true">
                {timer.text}
                <i style:width="{timer.progress * 100}%"></i>
              </span>
            {/if}
          </button>
        {/if}
      {/each}
      {#if game.garden.bench}
        {@const spot = place(benchCol, benchRow)}
        {@const bench = game.garden.bench}
        {#if benchOperator}
          {@const look = gardenSprite(benchOperator.speciesId, benchOperator.isShiny)}
          {@const at = place(operatorCol, operatorRow)}
          <!-- O operador fica na casa ao lado, virado para a máquina. -->
          <button
            type="button"
            class="mon operator"
            style:left="{snapToDevice(at.x)}px"
            style:top="{snapToDevice(at.y + halfH)}px"
            style:--size="{showdownSize * scale}px"
            style:z-index={operatorCol + operatorRow + depthSpan + 1}
            aria-label={`${benchOperator.nickname ?? benchOperator.displayName} operando a bancada`}
            onclick={onBench}
          >
            {#if look.kind === 'pmd'}
              <PmdSprite
                speciesId={benchOperator.speciesId}
                shiny={look.shinySheet}
                anim="Idle"
                dir={1}
                scale={pmdScale}
                shadow={look.shadow}
                {time}
              />
            {:else}
              <span class="shadow" aria-hidden="true"></span>
              <img src={showdownSrc(benchOperator.speciesId, benchOperator.isShiny)} alt="" />
            {/if}
          </button>
        {/if}
        <button
          type="button"
          class="bench"
          class:locked={!bench.unlocked}
          class:working={bench.unlocked && benchState === 'working'}
          style:left="{snapToDevice(spot.x)}px"
          style:top="{snapToDevice(spot.y + tileH)}px"
          style:z-index={benchCol + benchRow + depthSpan + 1}
          aria-label={!bench.unlocked
            ? `Bancada de bolas, abre no nível ${bench.unlockLevel}`
            : benchReady > 0
              ? `Bancada de bolas: ${benchReady} prontas`
              : 'Bancada de bolas'}
          onclick={onBench}
        >
          <!-- Folha de quadros: parada, 24 de trabalho (em loop) e pronta. -->
          <span
            class="bench-sprite"
            style:width="{BENCH_W * pmdScale}px"
            style:height="{BENCH_H * pmdScale}px"
            style:background-image="url({benchSheet(bench.job?.recipeKey)})"
            style:background-size="{BENCH_W * BENCH_FRAMES * pmdScale}px {BENCH_H * pmdScale}px"
            style:background-position-x="{-(benchWork ?? (benchState === 'ready' && bench.unlocked ? BENCH_READY : BENCH_IDLE)) * BENCH_W * pmdScale}px"
            aria-hidden="true"
          ></span>
          {#if benchTimer}
            <span class="tree-full timer" aria-hidden="true">
              {benchTimer.text}
              <i style:width="{benchTimer.progress * 100}%"></i>
            </span>
          {:else if benchReady > 0}
            <span class="tree-full" aria-hidden="true">{benchReady} pronta{benchReady === 1 ? '' : 's'}</span>
          {/if}
        </button>
      {/if}
      {#each giftSpots as { gift, spot: cell } (gift.id)}
        {@const spot = place(cell.col, cell.row)}
        <button
          type="button"
          class="gift"
          style:left="{snapToDevice(spot.x)}px"
          style:top="{snapToDevice(spot.y + halfH)}px"
          style:--size="{Math.round(24 * scale)}px"
          style:z-index={cell.col + cell.row + depthSpan}
          aria-label={`Presente: ${giftLabel(gift.itemKey, gift.quantity, game.berries, game.balls.list)}`}
          data-gift={gift.id}
          onclick={(event) => onGardenTap(event, { kind: 'gift', id: gift.id })}
        >
          <img src={giftIconSrc(gift.itemKey)} alt="" />
        </button>
      {/each}
      {#if showGrid}
        <svg class="grid" width={stageW} height={stageH} style:z-index={depthSpan * 4} aria-hidden="true">
          {#each Array.from({ length: playCols * playRows }, (_, i) => ({ col: playCol0 + (i % playCols), row: playRow0 + Math.floor(i / playCols) })) as cell (`${cell.col}-${cell.row}`)}
            {@const at = place(cell.col, cell.row)}
            {@const kind = isPlotCell(cell.col, cell.row)
              ? 'horta'
              : isTreeCell(cell.col, cell.row)
                ? 'arvore'
                : isBenchCell(cell.col, cell.row)
                  ? 'maquina'
                  : null}
            <polygon
              class={kind ?? ''}
              points="{at.x},{at.y} {at.x + halfW},{at.y + halfH} {at.x},{at.y + tileH} {at.x - halfW},{at.y + halfH}"
            />
          {/each}
        </svg>
      {/if}
      {#each walkers as walker (walker.id)}
        {@const look = gardenSprite(walker.speciesId, walker.isShiny)}
        {@const spot = place(walker.col, walker.row)}
        <!-- O botão é o ponto do chão (centro do bloco); o sprite cresce a partir dele. -->
        <button
          class="mon"
          class:selected={selectedId === walker.id}
          style:left="{snapToDevice(spot.x)}px"
          style:top="{snapToDevice(spot.y + halfH)}px"
          style:--size="{showdownSize * scale}px"
          style:z-index={Math.round(walker.col + walker.row) + depthSpan + 1}
          aria-label={`${walker.displayName}, nível ${walker.level}`}
          data-walker={walker.id}
          onclick={(event) => onGardenTap(event, { kind: 'mon', id: walker.id })}
        >
          {#if showLabels}
            {@const head = headAnchor(walker, look)}
            <span class="mon-tag" style:left="{head.x}px" style:top="{head.y}px" aria-hidden="true">
              {walker.displayName} Lv {walker.level}
            </span>
          {/if}
          {#if look.kind === 'pmd'}
            <PmdSprite
              speciesId={walker.speciesId}
              shiny={look.shinySheet}
              anim={walker.anim}
              dir={walker.dir}
              scale={pmdScale}
              shadow={look.shadow}
              flip={sleepFlip(walker)}
              {time}
            >
              {#if look.sparkle}<span class="sparkle"></span>{/if}
            </PmdSprite>
          {:else}
            <span class="shadow" aria-hidden="true"></span>
            <img
              use:spriteLoading={showdownSrc(walker.speciesId, walker.isShiny)}
              src={showdownSrc(walker.speciesId, walker.isShiny)}
              alt=""
              style:transform={walker.dir === 5 || walker.dir === 7 ? 'scaleX(-1)' : undefined}
            />
          {/if}
          {#if walker.anim === 'Sleep'}
            <!-- Fora do PmdSprite: lá dentro o flip espelharia as letras. -->
            {@const zzz = zzzSpot(walker, look)}
            <span
              class="zzz"
              style:left="{zzz.x}px"
              style:top="{zzz.y}px"
              style:--drift={zzz.drift}
              aria-hidden="true"
            >
              <span>z</span><span>z</span><span>Z</span>
            </span>
          {/if}
        </button>
      {/each}
      <!-- Balões fora do botão do Pokémon: são botões próprios (o coração faz carinho). -->
      {#each walkers as walker (walker.id)}
        {@const kind = bubbleById.get(walker.id)}
        {#if kind}
          {@const look = gardenSprite(walker.speciesId, walker.isShiny)}
          {@const spot = place(walker.col, walker.row)}
          {@const art = BUBBLES[kind]}
          {@const head = headAnchor(walker, look)}
          <button
            type="button"
            class="bubble"
            class:tappable={kind === 'pet'}
            class:busy={petting[walker.id]}
            style:left="{snapToDevice(spot.x + head.x)}px"
            style:top="{snapToDevice(spot.y + halfH + head.y - (showLabels ? 16 : 0))}px"
            style:z-index={depthSpan * 3}
            aria-label={kind === 'pet'
              ? `Fazer carinho em ${walker.displayName}`
              : kind === 'hunger'
                ? `${walker.displayName} está com fome`
                : kind === 'sad'
                  ? `${walker.displayName} está triste`
                  : `${walker.displayName} está feliz`}
            onclick={() => void onBubble(walker.id, kind)}
          >
            <svg
              width={art.width * bubblePx}
              height={art.height * bubblePx}
              viewBox="0 0 {art.width} {art.height}"
              shape-rendering="crispEdges"
              aria-hidden="true"
            >
              {#each art.pixels as px, index (index)}
                <rect x={px.x} y={px.y} width="1" height="1" fill={px.color} />
              {/each}
            </svg>
            {#if kind === 'happy' && (happyUntil[walker.id] ?? 0) > Date.now()}
              <span class="hearts" aria-hidden="true"><i></i><i></i><i></i></span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>

    {#if giftToast}
      <div class="gift-toast" role="status">{giftToast}</div>
    {/if}

    <!-- Clima do dia sobre o jardim (véu de cor + chuva/vento/nuvens); não pega toque. -->
    <WeatherLayer weather={game.weather.key} />

    <!-- Zoom: + e − com a barrinha do nível no meio (tocar nela também escolhe). -->
    <div class="zoom" role="group" aria-label="Zoom">
      {#if devTools}
        <button
          type="button"
          class="zoom-btn"
          aria-pressed={showGrid}
          aria-label={showGrid ? 'Ocultar grade (teste)' : 'Mostrar grade (teste)'}
          title="Grade (teste)"
          onclick={() => (showGrid = !showGrid)}
        >
          <svg viewBox="0 0 12 12" width={snapIconSize(14)} height={snapIconSize(14)} aria-hidden="true" shape-rendering="crispEdges">
            <rect x="1" y="1" width="10" height="1" /><rect x="1" y="5" width="10" height="1" /><rect x="1" y="10" width="10" height="1" />
            <rect x="1" y="1" width="1" height="10" /><rect x="5" y="1" width="1" height="10" /><rect x="10" y="1" width="1" height="10" />
          </svg>
        </button>
      {/if}
      <button
        type="button"
        class="zoom-btn"
        aria-pressed={showLabels}
        aria-label={showLabels ? 'Ocultar nomes e níveis' : 'Mostrar nomes e níveis'}
        title={showLabels ? 'Ocultar nomes' : 'Mostrar nomes'}
        onclick={toggleLabels}
      >
        <!-- Olho em pixels (grade 12×12), retângulos como o +/−. -->
        <svg viewBox="0 0 12 12" width={snapIconSize(14)} height={snapIconSize(14)} aria-hidden="true" shape-rendering="crispEdges">
          {#if showLabels}
            <rect x="3" y="3" width="6" height="1" />
            <rect x="2" y="4" width="1" height="1" /><rect x="9" y="4" width="1" height="1" />
            <rect x="1" y="5" width="1" height="2" /><rect x="10" y="5" width="1" height="2" />
            <rect x="2" y="7" width="1" height="1" /><rect x="9" y="7" width="1" height="1" />
            <rect x="3" y="8" width="6" height="1" />
            <rect x="5" y="5" width="2" height="2" />
          {:else}
            <rect x="1" y="5" width="10" height="1" />
            <rect x="2" y="2" width="1" height="1" /><rect x="3" y="3" width="1" height="1" />
            <rect x="4" y="4" width="1" height="1" /><rect x="7" y="6" width="1" height="1" />
            <rect x="8" y="7" width="1" height="1" /><rect x="9" y="8" width="1" height="1" />
          {/if}
        </svg>
      </button>
      <button
        type="button"
        class="zoom-btn"
        aria-label="Aproximar"
        disabled={scale >= scaleMax}
        onclick={() => applyZoom(scale + scaleStep)}
      >
        <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true"><path d="M5 1h2v4h4v2H7v4H5V7H1V5h4z" /></svg>
      </button>
      <button
        type="button"
        class="zoom-track"
        aria-label={`Zoom ${String(scale).replace('.', ',')}×`}
        onclick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const t = 1 - (event.clientY - box.top) / box.height
          applyZoom(scaleMin + t * (scaleMax - scaleMin))
        }}
      >
        <span class="zoom-fill" style:height="{((scale - scaleMin) / (scaleMax - scaleMin)) * 100}%"></span>
      </button>
      <button
        type="button"
        class="zoom-btn"
        aria-label="Afastar"
        disabled={scale <= scaleMin}
        onclick={() => applyZoom(scale - scaleStep)}
      >
        <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true"><path d="M1 5h10v2H1z" /></svg>
      </button>
    </div>
  </div>

  {#if benchOpen}
    <Modal label="Bancada de bolas" wide onBackdrop={() => (benchOpen = false)}>
      <BenchPanel {game} {onState} onClose={() => (benchOpen = false)} />
    </Modal>
  {/if}

  {#if plotIndex !== null}
    {@const plot = plotsByIndex.get(plotIndex)}
    {@const stage = plotStage(plot)}
    {@const berry = plot ? game.berries.find((row) => row.key === plot.berryKey) : null}
    <div class="overlay" role="presentation">
      <button type="button" class="backdrop" aria-label="Fechar" onclick={closePlot}></button>
      <div class="panel sheet plot-sheet" role="dialog" aria-modal="true" aria-label="Canteiro">
        <header class="sheet-head">
          <h2>Canteiro {plotIndex + 1}</h2>
          <button type="button" class="btn" onclick={closePlot}>Fechar</button>
        </header>
        <div class="plot-body">
          {#if plotMessage}<p class="alert" role="status">{plotMessage}</p>{/if}
          {#if harvestResult}
            <p class="good">
              Colheu {harvestResult.berries} {itemLabel(`berry:${harvestResult.berryKey}`, game.berries)}.
            </p>
            {#if harvestResult.died}
              <p class="hint">O arbusto secou depois desta colheita. Limpe o canteiro: com sorte, sai 1 ou 2 sementes.</p>
            {:else}
              <p class="hint">O arbusto continua no canteiro e vai dar frutos de novo.</p>
            {/if}
            <button type="button" class="btn btn-primary" onclick={closePlot}>Ok</button>
          {:else if stage === 'empty'}
            <p class="hint">Escolha uma semente para plantar.</p>
            {#if seedRows.length === 0}
              <p class="hint">Sem sementes na mochila.</p>
            {:else}
              <ul class="seed-list">
                {#each seedRows as row (row.itemKey)}
                  {@const key = row.itemKey.slice(5)}
                  {@const info = game.berries.find((berry) => berry.key === key)}
                  {@const favorite = info?.favoriteWeather === game.weather.key}
                  <li>
                    <button type="button" class="btn choice" class:favorite disabled={plotPending} onclick={() => void plant(key)}>
                      <img src={berryIconSrc(key)} alt="" width="28" height="28" />
                      <span>{itemLabel(row.itemKey, game.berries)} ×{row.quantity}</span>
                      {#if info}
                        <small class="seed-time">
                          <!-- Clima favorito da semente; hoje bate: cresce mais rápido. -->
                          <span class="seed-weather" title="Clima favorito">
                            <WeatherIcon weather={info.favoriteWeather} size={12} />
                          </span>
                          <!-- Primeiros frutos (o arbusto cresce antes); depois, a cada growMs. -->
                          {growText((favorite ? info.growMs * game.weatherGrowFactor : info.growMs) * game.firstGrowthMult)}
                          · depois {growText(info.growMs)}
                          {#if favorite}· −{Math.round((1 - game.weatherGrowFactor) * 100)}% hoje{/if}
                        </small>
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else if plot && (stage === 'planted' || stage === 'growing')}
            {@const left = remainingMs(plot.readyAt)}
            {@const total = Math.max(1, plot.readyAt - plot.plantedAt)}
            {@const progress = Math.min(1, 1 - left / total)}
            <p class="hint">
              {berry?.name ?? plot.berryKey}
              {plot.harvests > 0 ? 'dando frutos de novo…' : 'crescendo…'}
            </p>
            <div class="bar" aria-hidden="true"><span style:width="{progress * 100}%"></span></div>
            <p class="timer">{formatCountdown(left)}</p>
            {#if game.devTools}
              <div class="dev-row">
                <button type="button" class="btn" disabled={plotPending} onclick={() => void advancePlot({ minutes: 10 })}>+10 min (teste)</button>
                <button type="button" class="btn" disabled={plotPending} onclick={() => void advancePlot({ ready: true })}>Pronta agora (teste)</button>
              </div>
            {/if}
            {#if confirmUproot}
              <p class="hint">
                Arrancar antes de ficar pronta tem {Math.round((1 - game.uprootSeedReturnChance) * 100)}% de chance de
                perder a semente.
              </p>
              <button type="button" class="btn" disabled={plotPending} onclick={() => void uproot()}>Arrancar mesmo assim</button>
              <button type="button" class="btn" disabled={plotPending} onclick={() => (confirmUproot = false)}>Cancelar</button>
            {:else}
              <button type="button" class="btn" disabled={plotPending} onclick={() => (confirmUproot = true)}>Arrancar</button>
            {/if}
          {:else if plot && stage === 'dead'}
            <p class="hint">
              O arbusto de {berry?.name ?? plot.berryKey} secou depois de {plot.harvests}
              {plot.harvests === 1 ? 'colheita' : 'colheitas'}. Limpe o canteiro para plantar de novo: com sorte,
              sai 1 ou 2 sementes.
            </p>
            <button type="button" class="btn btn-primary" disabled={plotPending} onclick={() => void uproot()}>Limpar</button>
          {:else if plot && stage === 'ready'}
            <p class="hint">{berry?.name ?? plot.berryKey} pronta.</p>
            <button type="button" class="btn btn-primary" disabled={plotPending} onclick={() => void harvest()}>
              Colher
            </button>
          {/if}
        </div>
      </div>
    </div>
  {:else if selected}
    <PokemonSheet
      {game}
      mon={selected}
      dev={devTools
        ? {
            asleep: selectedAsleep,
            toggle: () => {
              if (!selected) return
              if (selectedAsleep) devCommands?.wake(selected.id)
              else devCommands?.sleep(selected.id)
            },
          }
        : null}
      onClose={() => (selectedId = null)}
      {onState}
    />
  {/if}
</div>

<style>
  .layout {
    display: flex;
    flex: 1;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .lawn {
    position: relative;
    /* Contexto de empilhamento próprio: o clima (WeatherLayer, z-index 5) fica
       preso ao gramado e não passa por cima do HUD e dos docks (z-index 4). */
    isolation: isolate;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    /* Nada no jardim se seleciona nem se arrasta como imagem (ver onDragStart). */
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    /* O padrão (tamanho e posição) vem do script: lawnBackground. */
    background-color: #4e8f2f;
    background-repeat: repeat;
    image-rendering: pixelated;
  }

  .lawn:active {
    cursor: grabbing;
  }

  .stage {
    position: absolute;
    left: 0;
    top: 0;
    flex: none;
    will-change: transform;
  }

  /* Chão em blocos (canvas da zona jogável): pixels da arte em escala inteira ou quase. */
  .floor {
    position: absolute;
    z-index: 0;
    image-rendering: pixelated;
    pointer-events: none;
  }

  /* Canteiro: o chão (terra) vem do canvas; o botão é só a área de toque, em losango. */
  .tile {
    position: absolute;
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  }

  .tile.plot {
    cursor: pointer;
    padding: 0;
    border: 0;
    background: transparent;
    touch-action: manipulation;
  }

  /* Canteiro fechado: escurecido, com um cadeado no meio. */
  .tile.plot.locked {
    background: rgb(20 16 10 / 0.35);
  }

  .tile.plot:focus-visible {
    outline: var(--px) dashed var(--ink);
    outline-offset: 2px;
  }

  .crop {
    position: absolute;
    left: 50%;
    top: 28%;
    z-index: 2;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .zoom {
    position: absolute;
    z-index: 6;
    left: calc(0.5rem + env(safe-area-inset-left));
    bottom: calc(4.1rem + env(safe-area-inset-bottom));
    display: grid;
    justify-items: center;
    /* Os botões já têm 44px de toque; o ícone pequeno no meio dá o respiro. */
    gap: 0;
    padding: 0;
    background: none;
    pointer-events: auto;
    cursor: default;
  }

  .zoom-btn {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    cursor: pointer;
    touch-action: manipulation;
  }

  .zoom-btn svg {
    fill: currentColor;
    filter: drop-shadow(0 1px 0 #000);
  }

  .zoom-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .zoom-btn:focus-visible,
  .zoom-track:focus-visible {
    outline: var(--px) dashed #fff;
    outline-offset: 1px;
  }

  /* Área de toque; a barrinha visível é o ::before, fina, no meio. */
  .zoom-track {
    position: relative;
    box-sizing: border-box;
    width: 44px;
    height: 48px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  .zoom-track::before {
    content: '';
    position: absolute;
    left: calc(50% - 1px);
    top: 3px;
    bottom: 3px;
    width: 2px;
    background: #ffffff40;
  }

  .zoom-fill {
    position: absolute;
    left: calc(50% - 1px);
    bottom: 3px;
    width: 2px;
    max-height: calc(100% - 6px);
    background: #fff;
    transition: height 0.12s steps(3, end);
  }

  .dev-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .bush-art {
    position: absolute;
    display: block;
    padding: 0;
    border: 0;
    background: none;
    transform: translate(-50%, -100%);
    cursor: pointer;
    touch-action: manipulation;
  }

  .bush-art img {
    display: block;
    image-rendering: pixelated;
    filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.25));
  }

  .crop.sprout {
    width: 10px;
    height: 14px;
    background: #5f9e3a;
    clip-path: polygon(50% 0, 100% 70%, 70% 100%, 30% 100%, 0 70%);
  }

  .crop.bush {
    width: 18px;
    height: 16px;
    background: #4f8a32;
    border-radius: 40% 40% 20% 20%;
    box-shadow: 6px 4px 0 #3f7228, -6px 4px 0 #3f7228;
  }

  .crop.berry {
    width: 22px;
    height: 22px;
    image-rendering: pixelated;
  }

  @media (prefers-reduced-motion: no-preference) {
    .tile.ready .crop.berry {
      animation: berry-bob 1.4s ease-in-out infinite;
    }
  }

  @keyframes berry-bob {
    0%,
    100% {
      transform: translateX(-50%) translateY(0);
    }
    50% {
      transform: translateX(-50%) translateY(-3px);
    }
  }

  .mon {
    position: absolute;
    width: 0;
    height: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  .mon:focus-visible {
    outline: none;
  }

  /* Nome + nível numa linha: branco com contorno preto (lê no claro e no escuro).
     Sem overflow:hidden — senão a borda do text-shadow corta nas laterais. */
  .mon-tag {
    position: absolute;
    left: 0;
    z-index: 2;
    transform: translate(-50%, -100%);
    padding: 0.05rem 0.12rem;
    color: #fff;
    font-size: 0.72rem;
    font-weight: 800;
    line-height: 1.25;
    white-space: nowrap;
    text-shadow:
      0 var(--px) 0 #000,
      0 calc(var(--px) * -1) 0 #000,
      var(--px) 0 0 #000,
      calc(var(--px) * -1) 0 0 #000,
      var(--px) var(--px) 0 #000,
      calc(var(--px) * -1) var(--px) 0 #000,
      var(--px) calc(var(--px) * -1) 0 #000,
      calc(var(--px) * -1) calc(var(--px) * -1) 0 #000;
    pointer-events: none;
  }

  /* Só o fallback do Showdown; a sombra do PMD fica no PmdSprite. */
  .shadow {
    position: absolute;
    left: calc(var(--size) * -0.25);
    top: calc(var(--size) * -0.06);
    width: calc(var(--size) * 0.5);
    height: calc(var(--size) * 0.12);
    border-radius: 50%;
    background: #00000030;
    pointer-events: none;
  }

  .sparkle {
    position: absolute;
    top: 6%;
    right: 10%;
    width: 4px;
    height: 4px;
    background: #fff4a8;
    box-shadow: 2px 0 0 #e0a800;
    animation: spark 2.8s steps(1, end) infinite;
    pointer-events: none;
  }

  @keyframes spark {
    0%,
    78% {
      opacity: 0;
    }
    79%,
    100% {
      opacity: 1;
    }
  }

  /* Zzz de quem dorme: três letras que nascem no alto da cabeça (zzzSpot),
     sobem em diagonal para o lado dela crescendo e somem, uma atrás da outra. */
  /* Presente no chão (5.21): o ponto do botão é o centro do bloco. */
  .tree {
    position: absolute;
    padding: 0;
    border: 0;
    background: none;
    transform: translate(-50%, -100%);
    cursor: pointer;
    touch-action: manipulation;
  }

  .tree svg {
    display: block;
    filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.3));
  }

  .tree.locked svg {
    filter: grayscale(0.7) brightness(0.6);
  }

  .tree.shake svg {
    transform-origin: 50% 100%;
    animation: tree-shake 0.45s steps(6, jump-none);
  }

  .bench {
    position: absolute;
    padding: 0;
    border: 0;
    background: none;
    transform: translate(-50%, -100%);
    cursor: pointer;
    touch-action: manipulation;
  }

  .grid {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }

  .grid polygon {
    fill: none;
    stroke: rgb(255 255 255 / 0.55);
    stroke-width: 1;
  }

  .grid polygon.horta {
    fill: rgb(255 200 60 / 0.25);
  }

  .grid polygon.arvore {
    fill: rgb(80 200 80 / 0.35);
  }

  .grid polygon.maquina {
    fill: rgb(80 160 255 / 0.35);
  }

  .bench-sprite {
    display: block;
    background-repeat: no-repeat;
    image-rendering: pixelated;
    filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.3));
  }

  .bench.locked .bench-sprite {
    filter: grayscale(0.7) brightness(0.6);
  }


  .tree-full {
    position: absolute;
    left: 50%;
    top: -4px;
    transform: translate(-50%, -100%);
    padding: 2px 7px;
    background: #fff8e6;
    border: 2px solid #3a2a14;
    box-shadow: 0 2px 0 rgb(0 0 0 / 0.25);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
    color: #3a2a14;
    white-space: nowrap;
    pointer-events: none;
  }

  /* Marcador com tempo: a barrinha corre no pé da etiqueta. */
  .tree-full.timer {
    padding-bottom: 7px;
    font-variant-numeric: tabular-nums;
  }

  .tree-full.timer i {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 5px;
    background: #6fc46a;
    box-shadow: inset 0 -2px 0 #3f9a45;
  }

  @keyframes tree-shake {
    20% {
      transform: rotate(-3deg);
    }
    40% {
      transform: rotate(3deg);
    }
    60% {
      transform: rotate(-2deg);
    }
    80% {
      transform: rotate(2deg);
    }
  }

  .gift {
    position: absolute;
    width: var(--size);
    height: var(--size);
    margin: calc(var(--size) * -0.85) 0 0 calc(var(--size) * -0.5);
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    animation: gift-bob 1.6s ease-in-out infinite;
  }

  .gift img {
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
    filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.35));
  }

  @keyframes gift-bob {
    50% {
      transform: translateY(-3px);
    }
  }

  /* Balão de diálogo: a ponta fica sobre a cabeça do Pokémon. */
  .bubble {
    position: absolute;
    padding: 0;
    border: 0;
    background: none;
    transform: translate(-50%, -100%);
    pointer-events: none;
    animation: gift-bob 1.4s ease-in-out infinite;
  }

  .bubble.tappable {
    pointer-events: auto;
    cursor: pointer;
  }

  .bubble.busy {
    opacity: 0.6;
  }

  .bubble svg {
    display: block;
  }

  .hearts {
    position: absolute;
    left: 50%;
    top: 0;
    pointer-events: none;
  }

  .hearts i {
    position: absolute;
    width: 8px;
    height: 7px;
    background: #e05a7a;
    clip-path: polygon(50% 100%, 0 40%, 0 15%, 20% 0, 50% 18%, 80% 0, 100% 15%, 100% 40%);
    animation: heart-up 1.1s ease-out forwards;
    opacity: 0;
  }

  .hearts i:nth-child(2) {
    left: -12px;
    animation-delay: 0.15s;
  }

  .hearts i:nth-child(3) {
    left: 10px;
    animation-delay: 0.3s;
  }

  @keyframes heart-up {
    0% {
      opacity: 0;
      transform: translateY(6px) scale(0.6);
    }
    30% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translateY(-20px) scale(1.1);
    }
  }

  .gift-toast {
    position: absolute;
    left: 50%;
    top: 0.75rem;
    z-index: 30;
    transform: translateX(-50%);
    padding: 0.4rem 0.75rem;
    background: rgb(20 24 20 / 0.85);
    color: #fff;
    font-weight: 700;
    border-radius: 8px;
    pointer-events: none;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .gift,
    .bubble,
    .hearts i {
      animation: none;
    }
  }

  .zzz {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  /* A letra (~8×14px) fica centrada em x e com a base no ponto. */
  .zzz span {
    position: absolute;
    left: -4px;
    top: -14px;
    font-size: 14px;
    font-weight: 800;
    line-height: 1;
    color: #eef2ff;
    text-shadow:
      0 var(--px) 0 var(--ink),
      0 calc(var(--px) * -1) 0 var(--ink),
      var(--px) 0 0 var(--ink),
      calc(var(--px) * -1) 0 0 var(--ink);
    opacity: 0;
  }

  @media (prefers-reduced-motion: no-preference) {
    .zzz span {
      animation: zzz-float 2.4s steps(12, end) infinite;
    }

    .zzz span:nth-child(2) {
      animation-delay: 0.8s;
    }

    .zzz span:nth-child(3) {
      animation-delay: 1.6s;
    }
  }

  /* Sem animação: um "zZ" parado já diz que está dormindo. */
  @media (prefers-reduced-motion: reduce) {
    .zzz span:nth-child(n + 2) {
      opacity: 1;
    }

    .zzz span:nth-child(3) {
      transform: translate(calc(var(--drift) * 9px), -10px);
    }
  }

  @keyframes zzz-float {
    0% {
      transform: translate(0, 0) scale(0.6);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    75% {
      opacity: 1;
    }
    100% {
      transform: translate(calc(var(--drift) * 16px), -28px) scale(1.2);
      opacity: 0;
    }
  }

  .mon img {
    position: absolute;
    left: calc(var(--size) * -0.5);
    top: calc(var(--size) * -1);
    display: block;
    width: var(--size);
    height: var(--size);
    object-fit: contain;
    object-position: bottom;
  }

  .mon.selected img,
  .mon.selected :global(.sprite),
  .mon:focus-visible img,
  .mon:focus-visible :global(.sprite) {
    filter: drop-shadow(2px 0 0 #fff) drop-shadow(-2px 0 0 #fff) drop-shadow(0 2px 0 #fff) drop-shadow(0 -2px 0 #fff);
  }

  .hint {
    margin: 0;
    color: var(--ink-soft);
    font-weight: 600;
  }

  .overlay {
    position: fixed;
    z-index: 40;
    inset: 0;
    display: grid;
    place-items: center;
    padding:
      calc(env(safe-area-inset-top) + 0.5rem)
      calc(env(safe-area-inset-right) + 0.5rem)
      calc(env(safe-area-inset-bottom) + 0.5rem)
      calc(env(safe-area-inset-left) + 0.5rem);
    box-sizing: border-box;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: #1a1208aa;
    cursor: pointer;
  }

  .plot-sheet {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: min(100%, 28rem);
    height: fit-content;
    max-height: 100%;
    min-width: 0;
    margin: 0;
    overflow: hidden;
  }

  .plot-body {
    display: grid;
    gap: 0.5rem;
    flex: 0 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .sheet-head h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .seed-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }

  /* Ícone à esquerda; nome em cima e tempo embaixo (quebra em tela estreita). */
  .seed-list .choice {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 0.5rem;
    row-gap: 0.1rem;
    width: 100%;
    min-width: 0;
    min-height: 44px;
    text-align: left;
  }

  .seed-list .choice img {
    grid-row: span 2;
  }

  .seed-list img {
    image-rendering: pixelated;
  }

  .seed-list span {
    flex: 1;
    min-width: 0;
  }

  /* Tempo de crescimento com o ícone do clima favorito na frente. */
  .seed-list .seed-time {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .seed-list .seed-weather {
    flex: none;
    display: inline-grid;
  }

  /* Hoje é o clima favorito dela: cresce mais rápido. */
  .seed-list .choice.favorite {
    box-shadow:
      inset 0 0 0 2px var(--accent),
      inset 0 -3px 0 var(--accent-shade);
  }

  .bar {
    height: 12px;
    background: #00000022;
    box-shadow: inset 0 0 0 var(--px) #00000033;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .timer {
    margin: 0;
    font-weight: 700;
  }

  .good,
  .alert {
    margin: 0;
  }

  .good {
    font-weight: 700;
  }

</style>

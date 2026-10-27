// Sons do jogo (PLANNING.md, seção 6.3).
//
// Web Audio, e não `new Audio()`: o Safari só deixa um <audio> tocar dentro de
// um toque, e boa parte dos sons vem depois (grito quando o encontro volta do
// servidor, chacoalhadas por timer na cena, level up nos destaques). Um único
// AudioContext liberado no primeiro toque toca o resto a qualquer momento.
// Qualquer falha (arquivo, rede, navegador sem Web Audio) vira silêncio.

export type SfxName =
  | 'tap'
  | 'harvest'
  | 'release'
  | 'shake'
  | 'catch'
  | 'escape'
  | 'levelup'
  | 'fast'
  | 'charged'
  | 'hit'
  | 'faint'

const MUTE_KEY = 'pocket-meadow-mute'
// Metade do volume da primeira versão, que estava alto demais (2026-10-27).
const SFX_VOLUME = 0.14
const CRY_VOLUME = 0.17
const sfxNames: SfxName[] = [
  'tap',
  'harvest',
  'release',
  'shake',
  'catch',
  'escape',
  'levelup',
  'fast',
  'charged',
  'hit',
  'faint',
]
// Som que demora mais que isso para ficar pronto (rede, decodificação) já não
// combina com o que está na tela: melhor não tocar.
const MAX_LATE_MS = 500

const VOLUME_KEY = 'pocket-meadow-volume'

let muted = readMute()
// Volume geral de 0 a 1, multiplicado pelos volumes base acima (barra no HUD).
let volume = readVolume()
let context: AudioContext | null = null
let bound = false
// Promessa por URL: o mesmo som pedido duas vezes baixa e decodifica uma só.
const buffers = new Map<string, Promise<AudioBuffer | null>>()
// Gritos pedidos antes do áudio ser liberado; baixam assim que ele for.
const pendingCries = new Set<number>()

/** Liga o áudio no primeiro toque e o retoma depois (o iOS suspende ao trocar de app). */
export function bindAudioUnlock(): void {
  if (typeof window === 'undefined' || bound) return
  bound = true
  const wake = () => {
    const ctx = ensureContext()
    if (!ctx) return
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined)
    // Os efeitos são poucos e pequenos: ficam prontos para o primeiro uso.
    for (const name of sfxNames) void load(sfxUrl(name))
    for (const id of pendingCries) void load(cryUrl(id))
    pendingCries.clear()
  }
  window.addEventListener('pointerdown', wake, { capture: true })
  window.addEventListener('keydown', wake, { capture: true })
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(next: boolean): void {
  muted = next
  writeMute(next)
}

export function toggleMute(): boolean {
  setMuted(!muted)
  return muted
}

export function getVolume(): number {
  return volume
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next))
  try {
    localStorage.setItem(VOLUME_KEY, String(volume))
  } catch {
    // Modo privado: o volume vale só nesta sessão.
  }
}

export function play(name: SfxName): void {
  void start(sfxUrl(name), SFX_VOLUME)
}

/** Grito da espécie. Use warmCries antes para ele sair na hora. */
export function playCry(speciesId: number): void {
  if (!Number.isInteger(speciesId) || speciesId <= 0) return
  void start(cryUrl(speciesId), CRY_VOLUME)
}

/**
 * Deixa gritos baixados e decodificados (os do jardim, o do selvagem que está
 * chegando). Antes do áudio ser liberado, só anota e baixa no primeiro toque.
 */
export function warmCries(speciesIds: readonly number[]): void {
  for (const id of speciesIds) {
    if (!Number.isInteger(id) || id <= 0) continue
    if (context) void load(cryUrl(id))
    else pendingCries.add(id)
  }
}

function sfxUrl(name: SfxName): string {
  return `/sounds/sfx/${name}.mp3`
}

function cryUrl(speciesId: number): string {
  return `/sounds/cries/${speciesId}.mp3`
}

async function start(url: string, baseVolume: number): Promise<void> {
  // Antes do primeiro toque não há contexto: o navegador nem deixaria tocar.
  const ctx = context
  if (muted || volume === 0 || !ctx || ctx.state !== 'running') return
  const askedAt = performance.now()
  const buffer = await load(url)
  // O jogador pode ter silenciado enquanto o arquivo baixava.
  if (!buffer || muted || ctx.state !== 'running') return
  // Chegou tarde demais para o momento (rede lenta no primeiro uso).
  if (performance.now() - askedAt > MAX_LATE_MS) return
  // O Firefox no Windows diz "running" mas leva 1–3 s para abrir a saída de
  // áudio; enquanto o relógio não anda, o som ficaria na fila e sairia
  // atrasado (o grito tocava segundos depois da ficha abrir).
  if (ctx.currentTime === 0) return
  try {
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = baseVolume * volume
    source.buffer = buffer
    source.connect(gain).connect(ctx.destination)
    source.start()
  } catch {
    // Silêncio.
  }
}

function load(url: string): Promise<AudioBuffer | null> {
  const known = buffers.get(url)
  if (known) return known
  const ctx = context
  if (!ctx) return Promise.resolve(null)
  const pending = fetch(url)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
    .then((data) => ctx.decodeAudioData(data))
    .catch(() => {
      // Falhou (rede?): esquece, para a próxima vez tentar de novo.
      buffers.delete(url)
      return null
    })
  buffers.set(url, pending)
  return pending
}

function ensureContext(): AudioContext | null {
  if (context) return context
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    context = Ctor ? new Ctor() : null
  } catch {
    context = null
  }
  return context
}

function readVolume(): number {
  // Sem preferência salva: metade do máximo (barra do HUD em 50%).
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw === null) return 0.5
    const value = Number(raw)
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
  } catch {
    return 0.5
  }
}

function readMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function writeMute(next: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    // Modo privado / storage cheio: o mudo vale só nesta sessão.
  }
}

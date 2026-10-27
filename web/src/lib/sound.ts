// Sons do jogo (PLANNING.md, seção 6.3).
//
// Web Audio, e não `new Audio()`: o Safari só deixa um <audio> tocar dentro de
// um toque, e boa parte dos sons vem depois (grito quando o encontro volta do
// servidor, chacoalhadas por timer na cena, level up nos destaques). Um único
// AudioContext liberado no primeiro toque toca o resto a qualquer momento.
// Qualquer falha (arquivo, rede, navegador sem Web Audio) vira silêncio.

export type SfxName = 'tap' | 'harvest' | 'release' | 'shake' | 'catch' | 'escape' | 'levelup'

const MUTE_KEY = 'pocket-meadow-mute'
const SFX_VOLUME = 0.28
const CRY_VOLUME = 0.34
const sfxNames: SfxName[] = ['tap', 'harvest', 'release', 'shake', 'catch', 'escape', 'levelup']

let muted = readMute()
let context: AudioContext | null = null
let bound = false
// Promessa por URL: o mesmo som pedido duas vezes baixa e decodifica uma só.
const buffers = new Map<string, Promise<AudioBuffer | null>>()

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

export function play(name: SfxName): void {
  void start(sfxUrl(name), SFX_VOLUME)
}

/** Grito da espécie, baixado só na primeira vez que toca. */
export function playCry(speciesId: number): void {
  if (!Number.isInteger(speciesId) || speciesId <= 0) return
  void start(`/sounds/cries/${speciesId}.mp3`, CRY_VOLUME)
}

function sfxUrl(name: SfxName): string {
  return `/sounds/sfx/${name}.mp3`
}

async function start(url: string, volume: number): Promise<void> {
  // Antes do primeiro toque não há contexto: o navegador nem deixaria tocar.
  const ctx = context
  if (muted || !ctx || ctx.state !== 'running') return
  const buffer = await load(url)
  // O jogador pode ter silenciado enquanto o arquivo baixava.
  if (!buffer || muted || ctx.state !== 'running') return
  try {
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = volume
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

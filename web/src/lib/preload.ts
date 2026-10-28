import type { GameState } from './api'
import { gardenSprite, loadPmd, loadPmdBattle, showdownSrc } from './sprites'

// Arte da abertura (App.svelte). Molduras de painel/botão agora são CSS
// (tema clássico); esta lista fica só com o que ainda é PNG.
const uiArt: string[] = []
// Os ícones das berries também saem de game.berries; esta lista cobre a tela
// de login, que ainda não tem o estado.
const itemArt = ['oran', 'pinap', 'razz', 'nanab', 'lum'].map((key) => `/sprites/items/${key}-berry.png`)
const fonts = ['400 16px "Pixelify Sans"', '600 16px "Pixelify Sans"', '700 16px "Pixelify Sans"']

const loaded = new Map<string, Promise<void>>()

/** Baixa e decodifica. Resolve mesmo com erro: a abertura não pode travar numa imagem. */
export function loadImage(url: string): Promise<void> {
  const known = loaded.get(url)
  if (known) return known
  const image = new Image()
  image.src = url
  const ready = image.decode().catch(() => {
    loaded.delete(url)
  })
  loaded.set(url, ready)
  return ready
}

/** Tudo que a tela de login usa. */
export function baseTasks(): Promise<unknown>[] {
  return [
    // Os iniciais aparecem no cadastro, logo depois do primeiro login.
    ...[...uiArt, ...itemArt, '/sprites/items/poke-ball.png', ...[1, 4, 7].map((id) => `/sprites/showdown/${id}.gif`)].map(
      loadImage,
    ),
    ...fonts.map((font) => document.fonts.load(font).catch(() => undefined)),
  ]
}

/** O jardim do jogador: folhas PMD (ou GIF, quem não tem PMD) e os ícones das berries do config. */
export function gameTasks(game: GameState): Promise<unknown>[] {
  const tasks: Promise<unknown>[] = game.berries.map((berry) => loadImage(`/sprites/items/${berry.key}-berry.png`))
  const seen = new Set<string>()
  for (const mon of game.pokemon) {
    if (mon.location !== 'garden') continue
    const look = gardenSprite(mon.speciesId, mon.isShiny)
    const key = look.kind === 'pmd' ? `pmd:${mon.speciesId}:${look.shinySheet}` : look.src
    if (seen.has(key)) continue
    seen.add(key)
    tasks.push(look.kind === 'pmd' ? loadPmd(mon.speciesId, look.shinySheet) : loadImage(look.src))
  }
  return tasks
}

/**
 * Sprite de uma espécie pronto para aparecer (folhas PMD ou o GIF), por no
 * máximo `capMs`. Usado antes de mostrar o encontro e a cena: o botão segura o
 * "Procurando…" em vez de o Pokémon surgir pela metade.
 */
export function spriteReady(speciesId: number, isShiny: boolean, capMs = 2500): Promise<void> {
  const look = gardenSprite(speciesId, isShiny)
  const load = look.kind === 'pmd' ? loadPmd(speciesId, look.shinySheet) : loadImage(showdownSrc(speciesId, isShiny))
  return Promise.race([load, new Promise<void>((resolve) => setTimeout(resolve, capMs))])
}

/**
 * Folhas de jardim e de batalha dos lutadores, por no máximo `capMs`. Quem não
 * tem PMD baixa o GIF. Mesmo teto do `spriteReady`: a cena segue se a rede atrasar.
 */
export function battleSpritesReady(
  fighters: { speciesId: number; isShiny: boolean }[],
  capMs = 2500,
): Promise<void> {
  const load = Promise.all(
    fighters.map((fighter) => {
      const look = gardenSprite(fighter.speciesId, fighter.isShiny)
      if (look.kind !== 'pmd') return loadImage(showdownSrc(fighter.speciesId, fighter.isShiny))
      return Promise.all([loadPmd(fighter.speciesId, look.shinySheet), loadPmdBattle(fighter.speciesId, look.shinySheet)])
    }),
  ).then(() => undefined)
  return Promise.race([load, new Promise<void>((resolve) => setTimeout(resolve, capMs))])
}

/**
 * Espera as tarefas, avisando o progresso, por no máximo `timeoutMs`. Passado
 * o limite, segue assim mesmo: o que faltar aparece com a Poké Ball.
 */
export async function warmUp(
  tasks: Promise<unknown>[],
  onProgress: (done: number, total: number) => void,
  timeoutMs = 10_000,
): Promise<void> {
  let done = 0
  onProgress(0, tasks.length)
  const all = Promise.all(tasks.map((task) => task.finally(() => onProgress(++done, tasks.length))))
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  await Promise.race([all, limit])
  clearTimeout(timer)
}

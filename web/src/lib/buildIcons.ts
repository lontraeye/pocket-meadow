import type { PieceKey } from '@garden/layout'
import bushUrl from '../../../art/jardim/arbustos/arbusto-oran-frutos.png?url'
import treeRedUrl from '../../../art/jardim/arvore-apricorn-frutos.png?url'
import treeBlueUrl from '../../../art/jardim/arvore-apricorn-frutos-azul.png?url'
import treeYellowUrl from '../../../art/jardim/arvore-apricorn-frutos-amarelo.png?url'
import { BENCH_FRAMES, BENCH_IDLE, BENCH_SHEET } from './bench'
import { HEAL_FRAMES, HEAL_SHEET } from './healMachine'

// Catálogo do modo Construir (PROGRESSAO.md 4.3): o ícone de cada peça sai da
// própria arte do jardim (todas 24×32), e as peças se dividem em categorias,
// como as abas de um catálogo de construção.

export const ICON_W = 24
export const ICON_H = 32

/** Folha (url), quantos quadros tem e qual quadro mostrar. */
export type PieceIcon = { src: string; frames: number; frame: number }

export const PIECE_ICONS: Record<PieceKey, PieceIcon> = {
  // O canteiro é chão: o ícone é o arbusto de Oran com frutos.
  berry_plot: { src: bushUrl, frames: 1, frame: 0 },
  ball_bench: { src: BENCH_SHEET, frames: BENCH_FRAMES, frame: BENCH_IDLE },
  // O último quadro é a máquina com as 4 cargas.
  heal_machine: { src: HEAL_SHEET, frames: HEAL_FRAMES, frame: HEAL_FRAMES - 1 },
  apricorn_tree: { src: treeRedUrl, frames: 1, frame: 0 },
  apricorn_tree_blue: { src: treeBlueUrl, frames: 1, frame: 0 },
  apricorn_tree_yellow: { src: treeYellowUrl, frames: 1, frame: 0 },
}

export type BuildCategory = 'horta' | 'producao' | 'cuidado'

export const BUILD_CATEGORIES: readonly { key: BuildCategory; name: string; pieces: readonly PieceKey[] }[] = [
  { key: 'horta', name: 'Horta', pieces: ['berry_plot'] },
  { key: 'producao', name: 'Produção', pieces: ['ball_bench', 'apricorn_tree', 'apricorn_tree_blue', 'apricorn_tree_yellow'] },
  { key: 'cuidado', name: 'Cuidado', pieces: ['heal_machine'] },
]

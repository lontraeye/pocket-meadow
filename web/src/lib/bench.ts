// Bancada de bolas no jardim (PLANNING.md, seção 5.23). Arte do usuário em
// art/jardim/maquina-apricorn.png: uma folha de 24×32 por quadro (fonte no GIF
// ao lado). O quadro 0 é a máquina parada (montado tirando o Apricorn do
// primeiro quadro do GIF); do 1 ao 24, a alavanca e o Apricorn virando Poké
// Ball, em loop enquanto trabalha; o 25, a bola pronta.

import sheetUrl from '../../../art/jardim/maquina-apricorn.png?url'
import greatSheetUrl from '../../../art/jardim/maquina-apricorn-great.png?url'
import ultraSheetUrl from '../../../art/jardim/maquina-apricorn-ultra.png?url'

export const BENCH_SHEET = sheetUrl
/** A folha da receita do lote (Great e Ultra são recolorações, recolorir-apricorn.py). */
export function benchSheet(recipeKey: string | null | undefined): string {
  if (recipeKey === 'great_ball') return greatSheetUrl
  if (recipeKey === 'ultra_ball') return ultraSheetUrl
  return sheetUrl
}
export const BENCH_W = 24
export const BENCH_H = 32
export const BENCH_FRAMES = 26
export const BENCH_IDLE = 0
export const BENCH_WORK_FIRST = 1
export const BENCH_READY = 25

/**
 * Tempo de cada quadro do trabalho (ms). O GIF tem 330 ms em todos (8 s por
 * volta); aqui o meio passa rápido e o começo e o fim seguram um pouco.
 */
const WORK_MS = [400, ...Array.from({ length: 22 }, () => 110), 300]
const WORK_TOTAL = WORK_MS.reduce((sum, ms) => sum + ms, 0)

/** Quadro do trabalho em `time` (ms, do relógio da animação). */
export function benchWorkFrame(time: number): number {
  let t = ((time % WORK_TOTAL) + WORK_TOTAL) % WORK_TOTAL
  let index = 0
  while (index < WORK_MS.length - 1 && t >= WORK_MS[index]!) {
    t -= WORK_MS[index]!
    index += 1
  }
  return BENCH_WORK_FIRST + index
}

export { benchDone } from './benchJob'

// Nomes dos prêmios para o texto da tela (Liga, rival): "3 Ultra Balls".

import { APRICORN_BLUE, APRICORN_ITEM, APRICORN_YELLOW } from './apricorn.js'

const NAMES: Readonly<Record<string, { one: string; many: string }>> = {
  'ball:poke': { one: 'Poké Ball', many: 'Poké Balls' },
  'ball:great': { one: 'Great Ball', many: 'Great Balls' },
  'ball:ultra': { one: 'Ultra Ball', many: 'Ultra Balls' },
  [APRICORN_ITEM]: { one: 'Apricorn vermelho', many: 'Apricorns vermelhos' },
  [APRICORN_BLUE]: { one: 'Apricorn azul', many: 'Apricorns azuis' },
  [APRICORN_YELLOW]: { one: 'Apricorn amarelo', many: 'Apricorns amarelos' },
}

export function rewardLabel(item: { itemKey: string; quantity: number }): string {
  const name = NAMES[item.itemKey]
  const label = name ? (item.quantity === 1 ? name.one : name.many) : item.itemKey
  return `${item.quantity} ${label}`
}

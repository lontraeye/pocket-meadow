import type { StatBlock } from '../stats.js'

const EV_PER_STAT = 252
const EV_TOTAL = 510

/** Aplica o EV yield do selvagem com tetos 252 / 510. */
export function applyEvYield(current: StatBlock, yieldEvs: StatBlock): StatBlock {
  const next = { ...current }
  const order: (keyof StatBlock)[] = ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed']
  let total = order.reduce((sum, key) => sum + next[key], 0)
  for (const key of order) {
    const roomStat = EV_PER_STAT - next[key]
    const roomTotal = EV_TOTAL - total
    const gain = Math.min(yieldEvs[key], roomStat, roomTotal)
    if (gain > 0) {
      next[key] += gain
      total += gain
    }
  }
  return next
}

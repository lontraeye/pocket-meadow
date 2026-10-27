import { simConfig } from './sim/config.js'
import type { MoveInfo } from './traits.js'

const AILMENT_PT: Record<string, string> = {
  burn: 'queimar',
  poison: 'envenenar',
  paralysis: 'paralisar',
  sleep: 'adormecer',
  freeze: 'congelar',
  confusion: 'confundir',
}

const STAT_PT: Record<string, string> = {
  attack: 'Ataque',
  defense: 'Defesa',
  spAttack: 'Ataque Esp.',
  spDefense: 'Defesa Esp.',
  speed: 'Velocidade',
}

/** Texto curto do efeito do golpe para a ficha (já com ÷ no rápido). */
export function moveEffectText(info: MoveInfo, slot: 'fast' | 'charged'): string | null {
  const parts: string[] = []
  // Como na simulação: vale o lugar do golpe, não o poder.
  const isFast = slot === 'fast'

  if (info.drain && info.drain > 0) {
    parts.push(info.drain === 50 ? 'Recupera metade do dano' : `Recupera ${info.drain}% do dano`)
  } else if (info.drain && info.drain < 0) {
    parts.push(`Recuo de ${-info.drain}% do dano`)
  }

  if (info.ailment && (info.ailmentChance ?? 0) > 0) {
    const allowed =
      !isFast || (simConfig.fastAilments as readonly string[]).includes(info.ailment)
    if (allowed) {
      let chance = info.ailmentChance ?? 0
      if (isFast) chance = Math.floor(chance / simConfig.fastEffectChanceDivisor)
      const verb = AILMENT_PT[info.ailment] ?? info.ailment
      if (chance > 0) parts.push(`${chance}% de ${verb}`)
    }
  }

  if ((info.statChanges?.length ?? 0) > 0 && (info.statChance ?? 0) > 0) {
    let chance = info.statChance ?? 0
    if (isFast) chance = Math.floor(chance / simConfig.fastEffectChanceDivisor)
    if (chance > 0) {
      const who = info.statOnSelf ? 'em si' : 'no alvo'
      const bits = (info.statChanges ?? []).map((row) => {
        const arrow = row.stages > 0 ? `+${row.stages}` : `${row.stages}`
        return `${STAT_PT[row.stat] ?? row.stat} ${arrow}`
      })
      parts.push(`${chance}%: ${bits.join(', ')} (${who})`)
    }
  }

  if ((info.critRate ?? 0) >= 1) parts.push('Crítico alto')

  return parts.length > 0 ? parts.join(' · ') : null
}

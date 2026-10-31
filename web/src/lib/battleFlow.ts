import type { BattleOutcome, PendingEncounter } from './api'
import type { HighlightCard } from './highlights'

/**
 * O que muda no fluxo de uma luta conforme o adversário (selvagem, líder e,
 * depois, rival, Equipe Rocket, Liga): o que dizer ao vencer ou perder, se
 * existe captura, quais prêmios mostrar. A luta em si é a mesma; o resto da
 * tela pergunta aqui em vez de supor que todo adversário é um selvagem.
 */
export type Opponent = NonNullable<BattleOutcome['opponent']>

/** Resposta antiga (sem `opponent`, de uma luta salva antes): selvagem. */
export function opponentOf(battle: Pick<BattleOutcome, 'opponent'>): Opponent {
  return battle.opponent ?? { kind: 'wild' }
}

/** Contra treinador não tem captura: vencer encerra o encontro. */
export function isTrainerBattle(battle: Pick<BattleOutcome, 'opponent'>): boolean {
  return opponentOf(battle).kind !== 'wild'
}

/** Primeira linha do resumo na tela de luta. */
export function recapIntro(battle: BattleOutcome, encounter: Pick<PendingEncounter, 'displayName'>): string {
  const opponent = opponentOf(battle)
  if (!battle.won) return opponent.kind === 'wild' ? 'Seu time foi derrotado…' : `O ${opponent.name} venceu…`
  return opponent.kind === 'wild' ? `${encounter.displayName} desmaiou!` : `Você venceu o ${opponent.name}!`
}

/** Linhas do resumo depois do XP: o prêmio do treinador vencido (marco, ferramentas). */
export function prizeLines(battle: BattleOutcome): string[] {
  const opponent = opponentOf(battle)
  if (!battle.won || opponent.kind !== 'leader' || !opponent.cleared) return []
  const lines = [`Conquistou o ${opponent.cleared.name}!`]
  if (opponent.cleared.grants.length > 0) lines.push(`Agora você tem: ${opponent.cleared.grants.join(', ')}.`)
  return lines
}

/** Cartão do desfecho (derrota, captura, fuga, vitória sobre treinador); null = ainda decide a captura. */
export function outcomeCard(battle: BattleOutcome): HighlightCard | null {
  const opponent = opponentOf(battle)
  if (!battle.won) {
    return opponent.kind === 'wild'
      ? { id: 'lost', title: 'Derrota', detail: 'Seus Pokémon não se machucaram.', tone: 'bad' }
      : { id: 'lost', title: 'Derrota', detail: `Treine o time e desafie o ${opponent.name} de novo.`, tone: 'bad' }
  }
  if (opponent.kind === 'leader') {
    if (!opponent.cleared) return { id: 'defeated', title: `Venceu o ${opponent.name}`, tone: 'good' }
    const grants = opponent.cleared.grants.length > 0 ? ` · Ganhou: ${opponent.cleared.grants.join(', ')}` : ''
    return {
      id: 'defeated',
      title: `${opponent.cleared.name} conquistado!`,
      detail: `Capítulo ${opponent.cleared.opens} aberto${grants}`,
      tone: 'good',
      sound: 'levelup',
    }
  }
  if (battle.caught) return { id: 'caught', title: 'Capturado!', detail: 'Entrou no jardim.', tone: 'good' }
  if (battle.status === 'escaped') return { id: 'escaped', title: 'Escapou', detail: 'Você venceu, mas ele fugiu.', tone: 'neutral' }
  return null
}

/** Texto da tela final. */
export function resultLine(
  battle: BattleOutcome & { left?: boolean },
): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  const opponent = opponentOf(battle)
  if (opponent.kind === 'leader') {
    if (!battle.won) return { text: 'Derrota. Treine o time e desafie de novo.', tone: 'bad' }
    return {
      text: opponent.cleared ? `Você venceu o ${opponent.name}! ${opponent.cleared.name} conquistado.` : `Você venceu o ${opponent.name}!`,
      tone: 'good',
    }
  }
  if (battle.caught) return { text: 'Capturado! Entrou no jardim.', tone: 'good' }
  if (battle.left) return { text: 'Você venceu e deixou ele ir.', tone: 'neutral' }
  if (battle.won) return { text: 'Você venceu, mas ele fugiu.', tone: 'neutral' }
  return { text: 'Derrota. Seus Pokémon não se machucaram.', tone: 'bad' }
}

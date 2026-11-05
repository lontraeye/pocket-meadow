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

/** "o Líder de Violet", "a Elite da Liga (Psíquico)": a Elite pede o artigo feminino. */
export function trainerTitle(opponent: Opponent): string {
  if (opponent.kind === 'wild') return ''
  return `${opponent.trainerKind === 'elite' ? 'a' : 'o'} ${opponent.name}`
}

/** Primeira linha do resumo na tela de luta. */
export function recapIntro(battle: BattleOutcome, encounter: Pick<PendingEncounter, 'displayName'>): string {
  const opponent = opponentOf(battle)
  if (!battle.won) return opponent.kind === 'wild' ? 'Seu time foi derrotado…' : `${capitalize(trainerTitle(opponent))} venceu…`
  return opponent.kind === 'wild' ? `${encounter.displayName} desmaiou!` : `Você venceu ${trainerTitle(opponent)}!`
}

/** Linhas do resumo depois do XP: o prêmio do treinador vencido (marco, ferramentas). */
export function prizeLines(battle: BattleOutcome): string[] {
  const opponent = opponentOf(battle)
  if (!battle.won || opponent.kind !== 'trainer') return []
  if (opponent.league?.status === 'won' && opponent.league.rewards.length > 0) return opponent.league.rewards
  if (opponent.league?.status === 'active' && opponent.league.nextName) return [`Próxima: ${opponent.league.nextName}`]
  if (opponent.rival && opponent.rival.rewards.length > 0) return [`Prêmio: ${opponent.rival.rewards.join(', ')}.`]
  if (opponent.trainerKind !== 'leader' || !opponent.cleared) return []
  const lines = [`Conquistou o ${opponent.cleared.name}!`]
  if (opponent.cleared.grants.length > 0) lines.push(`Agora você tem: ${opponent.cleared.grants.join(', ')}.`)
  return lines
}

/** Cartão do desfecho (derrota, captura, fuga, vitória sobre treinador); null = ainda decide a captura. */
export function outcomeCard(battle: BattleOutcome): HighlightCard | null {
  const opponent = opponentOf(battle)
  if (!battle.won) {
    if (opponent.kind === 'trainer' && opponent.league) {
      return { id: 'lost', title: 'Derrota', detail: 'A tentativa acabou. A Liga recomeça da primeira luta.', tone: 'bad' }
    }
    return opponent.kind === 'wild'
      ? { id: 'lost', title: 'Derrota', detail: 'Cure o time no jardim antes de tentar de novo.', tone: 'bad' }
      : { id: 'lost', title: 'Derrota', detail: `Treine o time e desafie ${trainerTitle(opponent)} de novo.`, tone: 'bad' }
  }
  if (opponent.kind === 'trainer' && opponent.league?.champion) {
    const rewards = opponent.league.rewards.length > 0 ? ` · ${opponent.league.rewards.join(', ')}` : ''
    return {
      id: 'defeated',
      title: 'Campeão de Johto!',
      detail: `Capítulo ${opponent.league.opens ?? ''} aberto${rewards}`,
      tone: 'good',
      sound: 'levelup',
    }
  }
  if (opponent.kind === 'trainer' && opponent.league?.status === 'active') {
    return {
      id: 'defeated',
      title: `Venceu ${trainerTitle(opponent)}`,
      detail: opponent.league.nextName ? `Próxima: ${opponent.league.nextName}` : undefined,
      tone: 'good',
    }
  }
  if (opponent.kind === 'trainer' && opponent.trainerKind === 'leader') {
    if (!opponent.cleared) return { id: 'defeated', title: `Venceu ${trainerTitle(opponent)}`, tone: 'good' }
    const grants = opponent.cleared.grants.length > 0 ? ` · Ganhou: ${opponent.cleared.grants.join(', ')}` : ''
    return {
      id: 'defeated',
      title: `${opponent.cleared.name} conquistado!`,
      detail: `Capítulo ${opponent.cleared.opens} aberto${grants}`,
      tone: 'good',
      sound: 'levelup',
    }
  }
  if (opponent.kind === 'trainer') {
    const prize = opponent.rival && opponent.rival.rewards.length > 0 ? opponent.rival.rewards.join(', ') : undefined
    return { id: 'defeated', title: `Venceu ${trainerTitle(opponent)}`, detail: prize, tone: 'good' }
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
  if (opponent.kind === 'trainer' && opponent.league) {
    if (!battle.won || opponent.league.status === 'lost') {
      return { text: 'Derrota. A Liga recomeça da primeira luta.', tone: 'bad' }
    }
    if (opponent.league.champion) return { text: `Campeão de Johto! Capítulo ${opponent.league.opens ?? ''} aberto.`, tone: 'good' }
    return {
      text: opponent.league.nextName ? `Você venceu! Próxima: ${opponent.league.nextName}.` : `Você venceu ${trainerTitle(opponent)}!`,
      tone: 'good',
    }
  }
  if (opponent.kind === 'trainer' && opponent.trainerKind === 'leader') {
    if (!battle.won) return { text: 'Derrota. Treine o time e desafie de novo.', tone: 'bad' }
    return {
      text: opponent.cleared ? `Você venceu ${trainerTitle(opponent)}! ${opponent.cleared.name} conquistado.` : `Você venceu ${trainerTitle(opponent)}!`,
      tone: 'good',
    }
  }
  if (opponent.kind === 'trainer') {
    if (!battle.won) return { text: 'Derrota. Treine o time e desafie de novo.', tone: 'bad' }
    return { text: `Você venceu ${trainerTitle(opponent)}!`, tone: 'good' }
  }
  if (battle.caught) return { text: 'Capturado! Entrou no jardim.', tone: 'good' }
  if (battle.left) return { text: 'Você venceu e deixou ele ir.', tone: 'neutral' }
  if (battle.won) return { text: 'Você venceu, mas ele fugiu.', tone: 'neutral' }
  return { text: 'Derrota. Cure o time no jardim antes de tentar de novo.', tone: 'bad' }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

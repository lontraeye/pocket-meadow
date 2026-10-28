import {
  ballIconSrc,
  berryIconSrc,
  itemLabel,
  type BallInfo,
  type BattleOutcome,
  type BerryInfo,
  type ItemCredit,
  type MoveView,
  type RegionInfo,
} from './api'

function rewardIcon(itemKey: string, balls?: BallInfo[]): string | undefined {
  if (itemKey.startsWith('seed:')) return berryIconSrc(itemKey.slice(5))
  if (itemKey.startsWith('berry:')) return berryIconSrc(itemKey.slice(6))
  if (itemKey.startsWith('ball:')) {
    const key = itemKey.slice(5)
    const sprite = balls?.find((b) => b.key === key)?.sprite ?? key
    return ballIconSrc(sprite)
  }
  return undefined
}
import type { SfxName } from './sound'

export type HighlightCard = {
  id: string
  title: string
  detail?: string
  tone?: 'good' | 'bad' | 'neutral'
  iconSrc?: string
  /** Toca quando o cartão aparece. */
  sound?: SfxName
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}


export function battleHighlightCards(input: {
  battle: BattleOutcome
  nameOf: (pokemonId: number) => string
  canEvolve: (fighter: BattleOutcome['fighters'][number]) => boolean
  regions: RegionInfo[]
  berries: BerryInfo[]
  balls?: BallInfo[]
}): HighlightCard[] {
  const { battle, nameOf, canEvolve, regions, berries, balls } = input
  const cards: HighlightCard[] = []

  if (!battle.won) {
    cards.push(captureHighlightCard('lost'))
  } else if (battle.caught) {
    cards.push(captureHighlightCard('caught'))
  } else if (battle.status !== 'pending') {
    cards.push(captureHighlightCard('escaped'))
  }

  for (const fighter of battle.fighters) {
    if (fighter.xpGained <= 0 && fighter.levelsGained <= 0) continue
    const name = nameOf(fighter.pokemonId)
    const detail =
      fighter.levelsGained > 0
        ? `+${fighter.xpGained} XP · subiu para Nv ${fighter.level}`
        : `+${fighter.xpGained} XP`
    cards.push({
      id: `xp-${fighter.pokemonId}`,
      title: name,
      detail,
      tone: 'good',
      ...(fighter.levelsGained > 0 ? { sound: 'levelup' as const } : {}),
    })
    if (fighter.learnedMove) cards.push(learnedMoveCard(name, fighter.learnedMove))
    if (canEvolve(fighter)) {
      cards.push({
        id: `evolve-${fighter.pokemonId}`,
        title: `${name} pode evoluir`,
        tone: 'good',
      })
    }
  }

  cards.push(...trainerCards(battle.trainer, battle.trainerXpGained, regions))

  if (battle.seedDrop) {
    cards.push({
      id: 'seed',
      title: 'Semente ganha',
      detail: itemLabel(battle.seedDrop.itemKey, berries),
      iconSrc: berryIconSrc(battle.seedDrop.berryKey),
      tone: 'good',
    })
  }
  cards.push(...rewardCards(battle.levelRewards ?? [], berries, balls))

  return cards
}

export type CaptureOutcomeKind = 'lost' | 'caught' | 'escaped' | 'left'

/** Cartão do desfecho: derrota, captura, fuga da bola ou deixar ir. */
export function captureHighlightCard(kind: CaptureOutcomeKind): HighlightCard {
  switch (kind) {
    case 'lost':
      return { id: 'lost', title: 'Derrota', detail: 'Seus Pokémon não se machucaram.', tone: 'bad' }
    case 'caught':
      return { id: 'caught', title: 'Capturado!', detail: 'Entrou no jardim.', tone: 'good' }
    case 'escaped':
      return { id: 'escaped', title: 'Escapou', detail: 'Você venceu, mas ele fugiu.', tone: 'neutral' }
    case 'left':
      return { id: 'left', title: 'Deixou ir', detail: 'Você venceu e deixou ele ir.', tone: 'neutral' }
  }
}

const outcomeCardIds = new Set(['lost', 'caught', 'escaped', 'left'])

/** Coloca o cartão de captura na frente e acrescenta XP extra do lançamento. */
export function mergeCaptureOutcome(
  cards: HighlightCard[],
  kind: Exclude<CaptureOutcomeKind, 'lost'>,
  extra: HighlightCard[] = [],
): HighlightCard[] {
  const rest = cards.filter((card) => !outcomeCardIds.has(card.id))
  return [captureHighlightCard(kind), ...rest, ...extra]
}

/** XP e recompensas só do POST /throw (além do que a vitória já deu). */
export function throwRewardCards(input: {
  trainerXpGained?: number
  trainer?: { level: number; xp: number; levelsGained: number }
  levelRewards?: ItemCredit[]
  regions: RegionInfo[]
  berries: BerryInfo[]
  balls?: BallInfo[]
}): HighlightCard[] {
  const cards: HighlightCard[] = []
  if (input.trainer) cards.push(...trainerCards(input.trainer, input.trainerXpGained ?? 0, input.regions))
  cards.push(...rewardCards(input.levelRewards ?? [], input.berries, input.balls))
  return cards.map((card) => ({ ...card, id: `catch-${card.id}` }))
}

/** Nível ou XP do treinador e as regiões que o novo nível liberou. */
function trainerCards(
  trainer: { level: number; levelsGained: number },
  trainerXpGained: number,
  regions: RegionInfo[],
): HighlightCard[] {
  if (trainer.levelsGained <= 0) {
    return trainerXpGained > 0 ? [{ id: 'trainer-xp', title: 'Você', detail: `+${trainerXpGained} XP`, tone: 'neutral' }] : []
  }
  const from = trainer.level - trainer.levelsGained
  return [
    { id: 'trainer', title: `Treinador Nv ${trainer.level}`, detail: `Subiu do Nv ${from}`, tone: 'good', sound: 'levelup' },
    ...unlockedRegions(regions, from, trainer.level).map((region): HighlightCard => ({
      id: `region-${region.slug}`,
      title: `Nova região: ${region.name}`,
      detail: `Abre no Nv ${region.minTrainerLevel}`,
      tone: 'good',
    })),
  ]
}

function rewardCards(
  levelRewards: { itemKey: string; quantity: number }[],
  berries: BerryInfo[],
  balls?: BallInfo[],
): HighlightCard[] {
  return levelRewards.map((reward) => ({
    id: `reward-${reward.itemKey}`,
    title: 'Recompensa de nível',
    detail: `${itemLabel(reward.itemKey, berries, balls)} ×${reward.quantity}`,
    iconSrc: rewardIcon(reward.itemKey, balls),
    tone: 'good',
  }))
}

/** Destaques ao resgatar um bloco do álbum da Pokédex. */
export function albumClaimCards(input: {
  title: string
  reward: {
    items: { itemKey: string; quantity: number }[]
    genericCandies: number
    energy: number
  }
  berries: BerryInfo[]
  balls?: BallInfo[]
}): HighlightCard[] {
  const cards: HighlightCard[] = [
    {
      id: `album-${input.title}`,
      title: 'Álbum completo!',
      detail: input.title,
      tone: 'good',
      sound: 'levelup',
    },
  ]
  for (const item of input.reward.items) {
    cards.push({
      id: `album-item-${item.itemKey}`,
      title: 'Recompensa do álbum',
      detail: `${itemLabel(item.itemKey, input.berries, input.balls)} ×${item.quantity}`,
      iconSrc: rewardIcon(item.itemKey, input.balls),
      tone: 'good',
    })
  }
  if (input.reward.genericCandies > 0) {
    cards.push({
      id: 'album-generic',
      title: 'Doces genéricos',
      detail: `+${input.reward.genericCandies}`,
      tone: 'good',
    })
  }
  if (input.reward.energy > 0) {
    cards.push({
      id: 'album-energy',
      title: 'Energia',
      detail: `+${input.reward.energy}`,
      tone: 'good',
    })
  }
  return cards
}

export function unlockedRegions(regions: RegionInfo[], fromLevel: number, toLevel: number): RegionInfo[] {
  if (toLevel <= fromLevel) return []
  return regions
    .filter((region) => region.minTrainerLevel > fromLevel && region.minTrainerLevel <= toLevel)
    .sort((a, b) => a.minTrainerLevel - b.minTrainerLevel || a.slug.localeCompare(b.slug))
}

/** XP e level up de um Pokémon (alimentar, daycare). */
export function xpHighlightCards(input: {
  name: string
  xpGained: number
  levelsGained: number
  level: number
  canEvolve: boolean
  learnedMove?: MoveView | null
}): HighlightCard[] {
  const cards: HighlightCard[] = []
  if (input.levelsGained <= 0 && input.xpGained <= 0) return cards
  cards.push({
    id: 'feed-xp',
    title: input.name,
    detail:
      input.levelsGained > 0
        ? `+${input.xpGained} XP · subiu para Nv ${input.level}`
        : `+${input.xpGained} XP`,
    tone: 'good',
    ...(input.levelsGained > 0 ? { sound: 'levelup' as const } : {}),
  })
  if (input.learnedMove) cards.push(learnedMoveCard(input.name, input.learnedMove))
  if (input.canEvolve) {
    cards.push({ id: 'feed-evolve', title: `${input.name} pode evoluir`, tone: 'good' })
  }
  return cards
}

/** O carregado sorteado que entrou no slot vazio ao subir de nível. */
export function learnedMoveCard(name: string, move: MoveView): HighlightCard {
  return { id: `learned-${move.name}`, title: `${name} aprendeu ${move.displayName}`, detail: 'Golpe carregado', tone: 'good' }
}

export function evolveHighlightCards(input: {
  fromName: string
  toName: string
  trainerXpGained: number
  trainer: { level: number; levelsGained: number }
  levelRewards: { itemKey: string; quantity: number }[]
  regions: RegionInfo[]
  berries: BerryInfo[]
  balls?: BallInfo[]
  newMoves?: { fast: MoveView | null; charged: MoveView | null } | null
}): HighlightCard[] {
  const cards: HighlightCard[] = [
    {
      id: 'evolved',
      title: `${input.fromName} → ${input.toName}`,
      detail: 'Evoluiu!',
      tone: 'good',
    },
  ]
  if (input.newMoves) {
    const names = [input.newMoves.fast, input.newMoves.charged].filter((move) => move !== null).map((move) => move.displayName)
    if (names.length > 0) {
      cards.push({ id: 'evolved-moves', title: 'Golpes sorteados', detail: names.join(' · '), tone: 'neutral' })
    }
  }
  cards.push(...trainerCards(input.trainer, input.trainerXpGained, input.regions))
  cards.push(...rewardCards(input.levelRewards, input.berries, input.balls))
  return cards
}

export function pokeBallSrc(sprite = 'poke'): string {
  return `/sprites/items/${sprite}-ball.png`
}

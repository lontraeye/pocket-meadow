import {
  berryIconSrc,
  itemLabel,
  type BattleOutcome,
  type BerryInfo,
  type ItemCredit,
  type LearnEntryView,
  type RegionInfo,
} from './api'
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
  learnsetOf?: (pokemonId: number) => LearnEntryView[]
  regions: RegionInfo[]
  berries: BerryInfo[]
}): HighlightCard[] {
  const { battle, nameOf, canEvolve, learnsetOf, regions, berries } = input
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
    if (fighter.levelsGained > 0) {
      if (fighter.moveOffers && fighter.moveOffers.length > 0) {
        cards.push(...moveOfferCards(name, fighter.moveOffers))
      } else if (learnsetOf) {
        cards.push(
          ...moveLearnCards(name, learnsetOf(fighter.pokemonId), fighter.level - fighter.levelsGained, fighter.level),
        )
      }
    }
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
  cards.push(...rewardCards(battle.levelRewards ?? [], berries))

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
}): HighlightCard[] {
  const cards: HighlightCard[] = []
  if (input.trainer) cards.push(...trainerCards(input.trainer, input.trainerXpGained ?? 0, input.regions))
  cards.push(...rewardCards(input.levelRewards ?? [], input.berries))
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

function rewardCards(levelRewards: { itemKey: string; quantity: number }[], berries: BerryInfo[]): HighlightCard[] {
  return levelRewards.map((reward) => ({
    id: `reward-${reward.itemKey}`,
    title: 'Recompensa de nível',
    detail: `${itemLabel(reward.itemKey, berries)} ×${reward.quantity}`,
    iconSrc: reward.itemKey.startsWith('seed:') ? berryIconSrc(reward.itemKey.slice(5)) : undefined,
    tone: 'good',
  }))
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
  learnset?: LearnEntryView[]
  moveOffers?: LearnEntryView[]
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
  if (input.moveOffers && input.moveOffers.length > 0) {
    cards.push(...moveOfferCards(input.name, input.moveOffers))
  } else if (input.levelsGained > 0 && input.learnset) {
    cards.push(
      ...moveLearnCards(input.name, input.learnset, input.level - input.levelsGained, input.level),
    )
  }
  if (input.canEvolve) {
    cards.push({ id: 'feed-evolve', title: `${input.name} pode evoluir`, tone: 'good' })
  }
  return cards
}

export function moveOfferCards(name: string, offers: LearnEntryView[]): HighlightCard[] {
  return offers.map((entry) => ({
    id: `learn-${entry.move}-${entry.level}`,
    title: `${name} pode aprender ${entry.displayName ?? entry.move}`,
    detail: `Nv ${entry.level}`,
    tone: 'good' as const,
  }))
}

/** Cartões "X pode aprender Y" ao cruzar o nível do golpe de dano. */
export function moveLearnCards(
  name: string,
  learnset: LearnEntryView[],
  fromLevel: number,
  toLevel: number,
): HighlightCard[] {
  if (toLevel <= fromLevel) return []
  return moveOfferCards(
    name,
    learnset.filter((entry) => entry.level > fromLevel && entry.level <= toLevel),
  )
}

export function evolveHighlightCards(input: {
  fromName: string
  toName: string
  trainerXpGained: number
  trainer: { level: number; levelsGained: number }
  levelRewards: { itemKey: string; quantity: number }[]
  regions: RegionInfo[]
  berries: BerryInfo[]
  moveOffers?: LearnEntryView[]
}): HighlightCard[] {
  const cards: HighlightCard[] = [
    {
      id: 'evolved',
      title: `${input.fromName} → ${input.toName}`,
      detail: 'Evoluiu!',
      tone: 'good',
    },
  ]
  if (input.moveOffers?.length) cards.push(...moveOfferCards(input.toName, input.moveOffers))
  cards.push(...trainerCards(input.trainer, input.trainerXpGained, input.regions))
  cards.push(...rewardCards(input.levelRewards, input.berries))
  return cards
}

export function pokeBallSrc(): string {
  return '/sprites/items/poke-ball.png'
}

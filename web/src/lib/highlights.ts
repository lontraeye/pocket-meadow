import { berryIconSrc, itemLabel, type BattleOutcome, type BerryInfo, type RegionInfo } from './api'

export type HighlightCard = {
  id: string
  title: string
  detail?: string
  tone?: 'good' | 'bad' | 'neutral'
  iconSrc?: string
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Quantidade de chacoalhadas só para a cena (PLANNING.md 6.2). */
export function catchShakes(caught: boolean, catchChance: number | null): number {
  if (caught) return 3
  return 1 + (catchChance !== null && catchChance >= 0.5 ? 1 : 0)
}

export function battleHighlightCards(input: {
  battle: BattleOutcome
  nameOf: (pokemonId: number) => string
  canEvolve: (fighter: BattleOutcome['fighters'][number]) => boolean
  regions: RegionInfo[]
  berries: BerryInfo[]
}): HighlightCard[] {
  const { battle, nameOf, canEvolve, regions, berries } = input
  const cards: HighlightCard[] = []

  if (!battle.won) {
    cards.push({ id: 'lost', title: 'Derrota', detail: 'Seus Pokémon não se machucaram.', tone: 'bad' })
  } else if (battle.caught) {
    cards.push({ id: 'caught', title: 'Capturado!', detail: 'Entrou no jardim.', tone: 'good' })
  } else {
    cards.push({ id: 'escaped', title: 'Escapou', detail: 'Você venceu, mas ele fugiu.', tone: 'neutral' })
  }

  for (const fighter of battle.fighters) {
    if (fighter.xpGained <= 0 && fighter.levelsGained <= 0) continue
    const name = nameOf(fighter.pokemonId)
    const detail =
      fighter.levelsGained > 0
        ? `+${fighter.xpGained} XP · subiu para Nv ${fighter.level}`
        : `+${fighter.xpGained} XP`
    cards.push({ id: `xp-${fighter.pokemonId}`, title: name, detail, tone: 'good' })
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
    { id: 'trainer', title: `Treinador Nv ${trainer.level}`, detail: `Subiu do Nv ${from}`, tone: 'good' },
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
  })
  if (input.canEvolve) {
    cards.push({ id: 'feed-evolve', title: `${input.name} pode evoluir`, tone: 'good' })
  }
  return cards
}

export function evolveHighlightCards(input: {
  fromName: string
  toName: string
  trainerXpGained: number
  trainer: { level: number; levelsGained: number }
  levelRewards: { itemKey: string; quantity: number }[]
  regions: RegionInfo[]
  berries: BerryInfo[]
}): HighlightCard[] {
  const cards: HighlightCard[] = [
    {
      id: 'evolved',
      title: `${input.fromName} → ${input.toName}`,
      detail: 'Evoluiu!',
      tone: 'good',
    },
  ]
  cards.push(...trainerCards(input.trainer, input.trainerXpGained, input.regions))
  cards.push(...rewardCards(input.levelRewards, input.berries))
  return cards
}

export function pokeBallSrc(): string {
  return '/sprites/items/poke-ball.png'
}

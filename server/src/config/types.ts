/** Os 18 tipos atuais (inclui Fairy). Uso em combate entra na 8.2. */

export const pokemonTypes = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
] as const

export type PokemonType = (typeof pokemonTypes)[number]

export const typeDisplayNamePt: Record<PokemonType, string> = {
  normal: 'Normal',
  fire: 'Fogo',
  water: 'Água',
  electric: 'Elétrico',
  grass: 'Planta',
  ice: 'Gelo',
  fighting: 'Lutador',
  poison: 'Venenoso',
  ground: 'Terra',
  flying: 'Voador',
  psychic: 'Psíquico',
  bug: 'Inseto',
  rock: 'Pedra',
  ghost: 'Fantasma',
  dragon: 'Dragão',
  dark: 'Sombrio',
  steel: 'Aço',
  fairy: 'Fada',
}

export const damageClassDisplayNamePt = {
  physical: 'Físico',
  special: 'Especial',
} as const

/** Multiplicador: atacante → defensor → fator (0, 0.5, 1, 2). */
export type TypeChart = Record<PokemonType, Record<PokemonType, number>>

const N = 1
const W = 2
const R = 0.5
const I = 0

/** Tabela atual dos jogos principais (Gen 6+). */
export const typeEffectiveness: TypeChart = {
  normal: {
    normal: N, fire: N, water: N, electric: N, grass: N, ice: N, fighting: N, poison: N,
    ground: N, flying: N, psychic: N, bug: N, rock: R, ghost: I, dragon: N, dark: N, steel: R, fairy: N,
  },
  fire: {
    normal: N, fire: R, water: R, electric: N, grass: W, ice: W, fighting: N, poison: N,
    ground: N, flying: N, psychic: N, bug: W, rock: R, ghost: N, dragon: R, dark: N, steel: W, fairy: N,
  },
  water: {
    normal: N, fire: W, water: R, electric: N, grass: R, ice: N, fighting: N, poison: N,
    ground: W, flying: N, psychic: N, bug: N, rock: W, ghost: N, dragon: R, dark: N, steel: N, fairy: N,
  },
  electric: {
    normal: N, fire: N, water: W, electric: R, grass: R, ice: N, fighting: N, poison: N,
    ground: I, flying: W, psychic: N, bug: N, rock: N, ghost: N, dragon: R, dark: N, steel: N, fairy: N,
  },
  grass: {
    normal: N, fire: R, water: W, electric: N, grass: R, ice: N, fighting: N, poison: R,
    ground: W, flying: R, psychic: N, bug: R, rock: W, ghost: N, dragon: R, dark: N, steel: R, fairy: N,
  },
  ice: {
    normal: N, fire: R, water: R, electric: N, grass: W, ice: R, fighting: N, poison: N,
    ground: W, flying: W, psychic: N, bug: N, rock: N, ghost: N, dragon: W, dark: N, steel: R, fairy: N,
  },
  fighting: {
    normal: W, fire: N, water: N, electric: N, grass: N, ice: W, fighting: N, poison: R,
    ground: N, flying: R, psychic: R, bug: R, rock: W, ghost: I, dragon: N, dark: W, steel: W, fairy: R,
  },
  poison: {
    normal: N, fire: N, water: N, electric: N, grass: W, ice: N, fighting: N, poison: R,
    ground: R, flying: N, psychic: N, bug: N, rock: R, ghost: R, dragon: N, dark: N, steel: I, fairy: W,
  },
  ground: {
    normal: N, fire: W, water: N, electric: W, grass: R, ice: N, fighting: N, poison: W,
    ground: N, flying: I, psychic: N, bug: R, rock: W, ghost: N, dragon: N, dark: N, steel: W, fairy: N,
  },
  flying: {
    normal: N, fire: N, water: N, electric: R, grass: W, ice: N, fighting: W, poison: N,
    ground: N, flying: N, psychic: N, bug: W, rock: R, ghost: N, dragon: N, dark: N, steel: R, fairy: N,
  },
  psychic: {
    normal: N, fire: N, water: N, electric: N, grass: N, ice: N, fighting: W, poison: W,
    ground: N, flying: N, psychic: R, bug: N, rock: N, ghost: N, dragon: N, dark: I, steel: R, fairy: N,
  },
  bug: {
    normal: N, fire: R, water: N, electric: N, grass: W, ice: N, fighting: R, poison: R,
    ground: N, flying: R, psychic: W, bug: N, rock: N, ghost: R, dragon: N, dark: W, steel: R, fairy: R,
  },
  rock: {
    normal: N, fire: W, water: N, electric: N, grass: N, ice: W, fighting: R, poison: N,
    ground: R, flying: W, psychic: N, bug: W, rock: N, ghost: N, dragon: N, dark: N, steel: R, fairy: N,
  },
  ghost: {
    normal: I, fire: N, water: N, electric: N, grass: N, ice: N, fighting: I, poison: N,
    ground: N, flying: N, psychic: W, bug: N, rock: N, ghost: W, dragon: N, dark: R, steel: N, fairy: N,
  },
  dragon: {
    normal: N, fire: N, water: N, electric: N, grass: N, ice: N, fighting: N, poison: N,
    ground: N, flying: N, psychic: N, bug: N, rock: N, ghost: N, dragon: W, dark: N, steel: R, fairy: I,
  },
  dark: {
    normal: N, fire: N, water: N, electric: N, grass: N, ice: N, fighting: R, poison: N,
    ground: N, flying: N, psychic: W, bug: N, rock: N, ghost: W, dragon: N, dark: R, steel: N, fairy: R,
  },
  steel: {
    normal: N, fire: R, water: R, electric: R, grass: N, ice: W, fighting: N, poison: N,
    ground: N, flying: N, psychic: N, bug: N, rock: W, ghost: N, dragon: N, dark: N, steel: R, fairy: W,
  },
  fairy: {
    normal: N, fire: R, water: N, electric: N, grass: N, ice: N, fighting: W, poison: R,
    ground: N, flying: N, psychic: N, bug: N, rock: N, ghost: N, dragon: W, dark: W, steel: R, fairy: N,
  },
}

export function isPokemonType(value: string): value is PokemonType {
  return (pokemonTypes as readonly string[]).includes(value)
}

export function typeLabelPt(type: string): string {
  return isPokemonType(type) ? typeDisplayNamePt[type] : type
}

export function damageClassLabelPt(damageClass: string): string {
  if (damageClass === 'physical' || damageClass === 'special') {
    return damageClassDisplayNamePt[damageClass]
  }
  return damageClass
}

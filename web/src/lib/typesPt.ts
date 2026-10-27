const typePt: Record<string, string> = {
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

const classPt: Record<string, string> = {
  physical: 'Físico',
  special: 'Especial',
}

export function typeLabelPt(type: string): string {
  return typePt[type] ?? type
}

export function damageClassLabelPt(damageClass: string): string {
  return classPt[damageClass] ?? damageClass
}

// Textos dos habitats (5.22) para a bandeja do Construir e as etiquetas do
// jardim: o nome do tipo, os pontos que faltam e as vagas.

import { MATERIAL_NAMES, habitatConfig, habitatKind, type HabitatCheck, type HabitatKind } from '@habitat'

/** "planta", "pedra/areia/terra", "água". */
export function materialText(kind: HabitatKind): string {
  return habitatKind(kind)
    .materials.map((material) => MATERIAL_NAMES[material])
    .join('/')
}

/** O que falta ou as vagas: "4/6 casas", "3/4 água", "2 vagas". */
export function habitatStatus(kind: HabitatKind, check: HabitatCheck): string {
  if (check.tooSmall) return `${check.size}/${habitatConfig.minTiles} casas`
  if (!check.ready) return `${check.points}/${check.need} ${materialText(kind)}`
  return `${check.capacity} vagas`
}

export function habitatLabel(kind: HabitatKind, check: HabitatCheck): string {
  return `${habitatKind(kind).name} · ${habitatStatus(kind, check)}`
}

/** O requisito por extenso: "Pede 4 pontos de água (metade da área)." */
export function needText(kind: HabitatKind, check: HabitatCheck): string {
  if (check.need === 0) return 'Não pede pontos: aceita qualquer tipo, sem bônus.'
  return `Pede ${check.need} pontos de ${materialText(kind)} (metade da área); cada chão vale 1 e cada móvel, mais 1.`
}

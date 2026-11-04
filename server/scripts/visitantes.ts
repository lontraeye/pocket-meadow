// Quem visitaria cada tipo de habitat em cada capítulo (PLANNING 5.22,
// visitantes), lendo as tabelas de encontro de verdade. Serve para balancear:
// mostra quem entra, com que chance e em que nível, e quem ficou de fora e
// por quê (raro nas rotas, difícil de capturar, lendário).
//   npm run visitantes

import { visitorPool } from '../src/game/habitat/visitors.js'
import { HABITAT_KINDS } from '../src/game/habitat/index.js'
import { milestoneConfigs } from '../src/config/milestones.js'
import { loadRegions } from '../src/config/regions.js'
import { readSpeciesSnapshot } from '../src/seed/apply.js'

const species = readSpeciesSnapshot().species
const names = new Map(species.map((row) => [row.id, row.displayName]))
const regions = loadRegions()

for (let chapter = 1; chapter <= milestoneConfigs.length; chapter += 1) {
  console.log(`\n== Capítulo ${chapter}`)
  for (const kind of HABITAT_KINDS) {
    if (kind.types === null) continue
    const pool = visitorPool(kind.key, chapter, regions, species)
    const total = pool.entries.reduce((sum, entry) => sum + entry.weight, 0)
    const list = pool.entries
      .map((entry) => `${names.get(entry.speciesId)} Nv ${entry.minLevel}${entry.maxLevel > entry.minLevel ? `–${entry.maxLevel}` : ''} (${Math.round((entry.weight / total) * 100)}%)`)
      .join(', ')
    console.log(`${kind.name} (teto Nv ${pool.levelCap}): ${list || '—'}`)
    if (pool.excluded.length > 0) {
      console.log(`   fora: ${pool.excluded.map((row) => `${names.get(row.speciesId)} (${row.reason})`).join(', ')}`)
    }
  }
}

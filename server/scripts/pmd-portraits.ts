// Retratos do PMD Sprite Collab (PLANNING.md, 5.21): o rosto "Normal" das
// espécies que cuidam do daycare, do mesmo commit dos sprites do jardim.
// Baixa em web/public/sprites/pmd-portrait/<dex>.png e escreve os autores no
// CREDITS-PMD.md (CC BY-NC 4.0 pede crédito). Rodar: npm run sprites:portraits
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CARETAKER_TIERS } from '../src/config/daycare.js'
import { pmd } from '../src/config/pmd.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.resolve(serverRoot, '../web/public/sprites/pmd-portrait')
const creditsPath = path.resolve(serverRoot, pmd.creditsPath)
const raw = (file: string) => `https://raw.githubusercontent.com/PMDCollab/SpriteCollab/${pmd.commit}/${file}`
const START = '<!-- retratos: gerado por npm run sprites:portraits -->'
const END = '<!-- /retratos -->'

async function text(url: string): Promise<string | null> {
  const response = await fetch(url)
  return response.ok ? response.text() : null
}

const names = new Map<string, { name: string; contact: string }>()
for (const line of ((await text(raw('credit_names.txt'))) ?? '').split('\n').slice(1)) {
  const [name, discord, contact] = line.split('\t')
  if (discord) names.set(discord.trim(), { name: (name ?? '').trim(), contact: (contact ?? '').trim() })
}

fs.mkdirSync(outputDir, { recursive: true })
const authors = new Map<string, { name: string; contact: string; dex: Set<number> }>()
const missing: number[] = []
for (const dex of CARETAKER_TIERS.flatMap((tier) => [...tier.species]).sort((a, b) => a - b)) {
  const id = String(dex).padStart(4, '0')
  const png = await fetch(raw(`portrait/${id}/Normal.png`))
  if (!png.ok) {
    missing.push(dex)
    continue
  }
  fs.writeFileSync(path.join(outputDir, `${dex}.png`), Buffer.from(await png.arrayBuffer()))
  // Autor atual (CUR) do retrato Normal.
  for (const line of ((await text(raw(`portrait/${id}/credits.txt`))) ?? '').split('\n')) {
    const [, author, status, , emotions] = line.split('\t')
    if (!author || status !== 'CUR' || !(emotions ?? '').split(',').includes('Normal')) continue
    const known = author === 'CHUNSOFT'
      ? { name: 'Spike Chunsoft (retratos originais de Pokémon Mystery Dungeon)', contact: 'https://www.spike-chunsoft.com/' }
      : (names.get(author) ?? { name: author, contact: '' })
    const row = authors.get(author) ?? { ...known, dex: new Set<number>() }
    row.dex.add(dex)
    authors.set(author, row)
  }
}

const table = [
  START,
  '',
  '## Retratos (cuidadores do daycare)',
  '',
  `Retrato "Normal" de \`portrait/<dex>/\`, mesmo commit. Arquivos em \`web/public/sprites/pmd-portrait/\`.`,
  '',
  '| Autor | Contato | Dex |',
  '|---|---|---|',
  ...[...authors.values()].map((row) => `| ${row.name} | ${row.contact} | ${[...row.dex].sort((a, b) => a - b).join(', ')} |`),
  '',
  END,
].join('\n')
const current = fs.readFileSync(creditsPath, 'utf8')
const next = current.includes(START)
  ? current.slice(0, current.indexOf(START)) + table + current.slice(current.indexOf(END) + END.length)
  : `${current.trimEnd()}\n\n${table}\n`
fs.writeFileSync(creditsPath, next)
console.log(`retratos: ${authors.size} autores; sem retrato: ${missing.join(', ') || 'nenhum'}`)

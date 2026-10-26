import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { pmd } from '../src/config/pmd.js'
import { speciesSeed } from '../src/config/seed.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.resolve(serverRoot, pmd.cacheDir)
const outputDir = path.resolve(serverRoot, pmd.outputDir)
const manifestPath = path.resolve(serverRoot, pmd.manifestPath)
const creditsPath = path.resolve(serverRoot, pmd.creditsPath)
const anims = pmd.anims
const sparse = [
  '/tracker.json',
  '/credit_names.txt',
  '/sprite/*/AnimData.xml',
  '/sprite/*/credits.txt',
  '/sprite/*/Walk-Anim.png',
  '/sprite/*/Idle-Anim.png',
  '/sprite/*/Sleep-Anim.png',
  '/sprite/*/Walk-Shadow.png',
  '/sprite/*/Idle-Shadow.png',
  '/sprite/*/Sleep-Shadow.png',
  '/sprite/*/0000/0001/AnimData.xml',
  '/sprite/*/0000/0001/credits.txt',
  '/sprite/*/0000/0001/Walk-Anim.png',
  '/sprite/*/0000/0001/Idle-Anim.png',
  '/sprite/*/0000/0001/Sleep-Anim.png',
  '/sprite/*/0000/0001/Walk-Shadow.png',
  '/sprite/*/0000/0001/Idle-Shadow.png',
  '/sprite/*/0000/0001/Sleep-Shadow.png',
]

// ground: ponto do chão em cada quadro, relativo ao canto do quadro. É o pixel
// branco da folha -Shadow, e anda dentro do quadro durante o Walk. Vem como
// [x, y] quando é igual em todos os quadros; senão, [x, y] por quadro, linha a
// linha (direção × quadros).
type AnimSheet = { w: number; h: number; dirs: number; durations: number[]; ground: number[] }
type Variant = Record<(typeof anims)[number], AnimSheet>
type ParsedAnim = { name: string; copyOf?: string; w?: number; h?: number; durations?: number[] }

type TrackerNode = {
  sprite_complete?: number
  subgroups?: Record<string, TrackerNode>
}

const kept = new Set<string>()
const warnings: string[] = []
const creditRows = new Map<string, { name: string; contact: string; dex: Set<number> }>()

function git(args: string[], cwd = cacheDir): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function ensureCache(): void {
  const head = fs.existsSync(path.join(cacheDir, '.git'))
    ? git(['rev-parse', 'HEAD'])
    : ''
  if (head === pmd.commit && fs.existsSync(path.join(cacheDir, 'tracker.json'))) {
    // Clone de uma versão anterior do script: traz os arquivos novos da lista
    // de uma vez, em vez de um por um no materialize.
    if (git(['sparse-checkout', 'list']) !== sparse.join('\n')) {
      execFileSync('git', ['sparse-checkout', 'set', '--no-cone', ...sparse], { cwd: cacheDir, stdio: 'inherit' })
    }
    return
  }

  fs.rmSync(cacheDir, { recursive: true, force: true })
  fs.mkdirSync(cacheDir, { recursive: true })
  git(['init'])
  git(['remote', 'add', 'origin', pmd.repoUrl])
  git(['sparse-checkout', 'set', '--no-cone', ...sparse])
  execFileSync('git', ['fetch', '--depth', '1', '--filter=blob:none', 'origin', pmd.commit], {
    cwd: cacheDir,
    stdio: 'inherit',
  })
  git(['checkout', pmd.commit])
}

function pad(id: number): string {
  return String(id).padStart(4, '0')
}

function tag(body: string, name: string): string | undefined {
  return body.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]
}

function parseAnimData(xml: string): { shadow: number; anims: ParsedAnim[] } {
  const shadow = Number(tag(xml, 'ShadowSize') ?? '1')
  const parsed: ParsedAnim[] = []
  for (const match of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
    const body = match[1] ?? ''
    const name = tag(body, 'Name')
    if (!name) continue
    const copyOf = tag(body, 'CopyOf')
    if (copyOf) {
      parsed.push({ name, copyOf })
      continue
    }
    parsed.push({
      name,
      w: Number(tag(body, 'FrameWidth')),
      h: Number(tag(body, 'FrameHeight')),
      durations: [...body.matchAll(/<Duration>(\d+)<\/Duration>/g)].map((item) => Number(item[1])),
    })
  }
  return { shadow: shadow === 0 || shadow === 2 ? shadow : 1, anims: parsed }
}

function resolveAnim(parsed: ParsedAnim[], name: string, seen = new Set<string>()): ParsedAnim | undefined {
  const anim = parsed.find((item) => item.name === name)
  if (!anim || seen.has(name)) return undefined
  if (!anim.copyOf) return anim
  seen.add(name)
  const target = resolveAnim(parsed, anim.copyOf, seen)
  if (!target || target.w === undefined || target.h === undefined || !target.durations) return undefined
  return { ...target, name: target.name }
}

function pngSize(file: string): { w: number; h: number } {
  const bytes = Buffer.alloc(24)
  const fd = fs.openSync(file, 'r')
  try {
    fs.readSync(fd, bytes, 0, 24, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`${file} is not a PNG`)
  }
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) }
}

function materialize(relative: string): string | null {
  const abs = path.join(cacheDir, ...relative.split('/'))
  if (fs.existsSync(abs)) return abs
  try {
    git(['sparse-checkout', 'add', '--no-cone', `/${relative}`])
    git(['checkout', pmd.commit, '--', relative])
  } catch {
    return null
  }
  return fs.existsSync(abs) ? abs : null
}

function loadNames(): Map<string, { name: string; contact: string }> {
  const names = new Map<string, { name: string; contact: string }>()
  const file = path.join(cacheDir, 'credit_names.txt')
  if (!fs.existsSync(file)) return names
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    const [name, discord, contact] = line.split('\t')
    if (!discord) continue
    names.set(discord, { name: name || discord, contact: contact || '' })
  }
  return names
}

function addCredits(id: number, creditsFile: string, names: Map<string, { name: string; contact: string }>): void {
  if (!fs.existsSync(creditsFile)) {
    warnings.push(`${pad(id)}: credits.txt ausente em ${path.relative(cacheDir, creditsFile)}`)
    return
  }
  for (const line of fs.readFileSync(creditsFile, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    const [, author, status, , actions] = line.split('\t')
    if (status !== 'CUR' || !author || !actions) continue
    const used = actions.split(',').map((item) => item.trim())
    if (!anims.some((anim) => used.includes(anim))) continue
    const known = names.get(author)
    const display =
      author === 'CHUNSOFT'
        ? 'Spike Chunsoft (sprites originais de Pokémon Mystery Dungeon)'
        : (known?.name ?? author)
    const contact = author === 'CHUNSOFT' ? (known?.contact ?? '') : (known?.contact ?? '')
    const row = creditRows.get(author) ?? { name: display, contact, dex: new Set<number>() }
    row.dex.add(id)
    creditRows.set(author, row)
  }
}

type Ready = { shadow: number; variant: Variant; sources: Record<string, string> }

function loadVariant(folder: string, label: string): Ready | undefined {
  const xmlPath = materialize(`${folder}/AnimData.xml`)
  if (!xmlPath) {
    warnings.push(`${label}: AnimData.xml ausente`)
    return undefined
  }
  const parsed = parseAnimData(fs.readFileSync(xmlPath, 'utf8'))
  const variant = {} as Variant
  const sources: Record<string, string> = {}
  for (const anim of anims) {
    const resolved = resolveAnim(parsed.anims, anim)
    if (!resolved?.w || !resolved.h || !resolved.durations?.length) {
      warnings.push(`${label}: ${anim} sem dados depois do CopyOf`)
      return undefined
    }
    const relative = `${folder}/${resolved.name}-Anim.png`
    const png = materialize(relative)
    if (!png) {
      warnings.push(`${label}: ${resolved.name}-Anim.png ausente`)
      return undefined
    }
    const size = pngSize(png)
    if (size.w !== resolved.w * resolved.durations.length || size.h % resolved.h !== 0) {
      warnings.push(`${label}: ${anim} mede ${size.w}×${size.h}, esperado largura ${resolved.w * resolved.durations.length}`)
      return undefined
    }
    const dirs = size.h / resolved.h
    const ground = readGround(folder, resolved.name, resolved.w, resolved.h, resolved.durations.length, dirs, size, label)
    variant[anim] = { w: resolved.w, h: resolved.h, dirs, durations: resolved.durations, ground }
    sources[anim] = png
  }
  return { shadow: parsed.shadow, variant, sources }
}

function readGround(
  folder: string,
  name: string,
  w: number,
  h: number,
  frames: number,
  dirs: number,
  size: { w: number; h: number },
  label: string,
): number[] {
  // Sem folha de sombra, o chão fica no centro do quadro, que é a convenção do PMD.
  const fallback = [Math.floor(w / 2), Math.floor(h / 2)]
  const file = materialize(`${folder}/${name}-Shadow.png`)
  if (!file) {
    warnings.push(`${label}: ${name}-Shadow.png ausente, chão no centro do quadro`)
    return fallback
  }
  const png = PNG.sync.read(fs.readFileSync(file))
  if (png.width !== size.w || png.height !== size.h) {
    warnings.push(`${label}: ${name}-Shadow.png mede ${png.width}×${png.height}, chão no centro do quadro`)
    return fallback
  }

  const points: number[] = []
  let last = fallback
  for (let dir = 0; dir < dirs; dir += 1) {
    for (let frame = 0; frame < frames; frame += 1) {
      last = whitePixel(png, frame * w, dir * h, w, h) ?? last
      points.push(last[0] ?? 0, last[1] ?? 0)
    }
  }
  const constant = points.every((value, index) => value === points[index % 2])
  return constant ? points.slice(0, 2) : points
}

function whitePixel(png: PNG, left: number, top: number, w: number, h: number): number[] | undefined {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const at = ((top + y) * png.width + left + x) * 4
      const [r, g, b, a] = [png.data[at], png.data[at + 1], png.data[at + 2], png.data[at + 3]]
      if (a !== 0 && r === 255 && g === 255 && b === 255) return [x, y]
    }
  }
  return undefined
}

function copyVariant(id: number, shiny: boolean, ready: Ready): void {
  const folder = path.join(outputDir, String(id), ...(shiny ? ['shiny'] : []))
  fs.mkdirSync(folder, { recursive: true })
  for (const anim of anims) {
    const dest = path.join(folder, `${anim}.png`)
    fs.copyFileSync(ready.sources[anim] ?? '', dest)
    kept.add(path.relative(outputDir, dest).split(path.sep).join('/'))
  }
}

function trackerAllows(node: TrackerNode | undefined): boolean {
  return (node?.sprite_complete ?? 0) >= 1
}

function writeManifest(species: Record<string, unknown>): void {
  // Uma espécie por linha: o diff mostra só quem mudou e o arquivo não incha.
  const rows = Object.entries(species).map(([id, entry]) => `  ${JSON.stringify(id)}: ${JSON.stringify(entry)}`)
  const body = `{\n "commit": ${JSON.stringify(pmd.commit)},\n "species": {\n${rows.join(',\n')}\n }\n}\n`
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, body)
}

function writeCredits(): void {
  const rows = [...creditRows.values()].sort((a, b) => {
    const aOfficial = a.name.startsWith('Spike Chunsoft')
    const bOfficial = b.name.startsWith('Spike Chunsoft')
    if (aOfficial !== bOfficial) return aOfficial ? -1 : 1
    return a.name.localeCompare(b.name, 'pt')
  })
  const lines = [
    '# Créditos dos sprites de jardim (PMD)',
    '',
    `Fonte: [PMD Sprite Collab](https://github.com/PMDCollab/SpriteCollab), commit \`${pmd.commit}\`.`,
    '',
    'Licença da arte da comunidade: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Os registros mais antigos usam `PMDCollab_1` e `PMDCollab_2`, também com crédito e uso não comercial. Os sprites marcados como Spike Chunsoft são extraídos dos jogos oficiais de Pokémon Mystery Dungeon.',
    '',
    'Entram autores com crédito atual (`CUR`) em Walk, Idle ou Sleep.',
    '',
    '| Autor | Contato | Dex |',
    '|---|---|---|',
    ...rows.map((row) => {
      const dex = [...row.dex].sort((a, b) => a - b).join(', ')
      return `| ${cell(row.name)} | ${cell(row.contact)} | ${dex} |`
    }),
    '',
  ]
  fs.writeFileSync(creditsPath, lines.join('\n'))
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function pruneOutput(): void {
  if (!fs.existsSync(outputDir)) return
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else files.push(abs)
    }
  }
  walk(outputDir)
  for (const file of files) {
    const relative = path.relative(outputDir, file).split(path.sep).join('/')
    if (!kept.has(relative)) fs.rmSync(file)
  }
  const dirs: string[] = []
  const walkDirs = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const abs = path.join(dir, entry.name)
      walkDirs(abs)
      dirs.push(abs)
    }
  }
  walkDirs(outputDir)
  for (const dir of dirs.reverse()) {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  }
}

function main(): void {
  ensureCache()
  const tracker = JSON.parse(fs.readFileSync(path.join(cacheDir, 'tracker.json'), 'utf8')) as Record<string, TrackerNode>
  const names = loadNames()
  const species: Record<string, { shadow: number; normal: Variant; shiny: Variant | null }> = {}
  const missing: number[] = []
  const missingShiny: number[] = []
  let normals = 0
  let shinies = 0

  fs.mkdirSync(outputDir, { recursive: true })

  for (let id = speciesSeed.firstId; id <= speciesSeed.lastId; id += 1) {
    const dex = pad(id)
    const node = tracker[dex]
    if (!trackerAllows(node)) {
      missing.push(id)
      warnings.push(`${dex}: sprite_complete ${node?.sprite_complete ?? 'ausente'}`)
      continue
    }
    const normal = loadVariant(`sprite/${dex}`, dex)
    if (!normal) {
      missing.push(id)
      continue
    }
    copyVariant(id, false, normal)
    addCredits(id, path.join(cacheDir, 'sprite', dex, 'credits.txt'), names)
    normals += 1

    const shinyNode = node?.subgroups?.['0000']?.subgroups?.['0001']
    let shiny: Variant | null = null
    if (trackerAllows(shinyNode)) {
      const loaded = loadVariant(`sprite/${dex}/0000/0001`, `${dex} shiny`)
      if (loaded) {
        copyVariant(id, true, loaded)
        addCredits(id, path.join(cacheDir, 'sprite', dex, '0000', '0001', 'credits.txt'), names)
        shiny = loaded.variant
        shinies += 1
      } else missingShiny.push(id)
    } else missingShiny.push(id)

    species[String(id)] = { shadow: normal.shadow, normal: normal.variant, shiny }
  }

  pruneOutput()
  writeManifest(species)
  writeCredits()

  console.log(`pmd sprites: ${normals} normal, ${shinies} shiny`)
  console.log(`sem PMD: ${missing.length ? missing.join(', ') : 'nenhum'}`)
  console.log(`sem shiny PMD: ${missingShiny.length ? missingShiny.join(', ') : 'nenhum'}`)
  if (warnings.length) {
    console.log(`avisos: ${warnings.length}`)
    for (const warning of warnings) console.log(`  ${warning}`)
  }
}

main()

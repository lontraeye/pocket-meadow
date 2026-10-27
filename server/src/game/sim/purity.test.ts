import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const simDir = path.dirname(fileURLToPath(import.meta.url))
const banned = /\b(node:|from ['"][^'"]*\/db\/|drizzle-orm|better-sqlite3)/
const importRe = /from\s+['"]([^'"]+)['"]/g

test('sim/ e o que ele importa não puxam Node, db/ nem drizzle', () => {
  const seen = new Set<string>()
  const queue = [simDir]

  while (queue.length > 0) {
    const dirOrFile = queue.pop()!
    if (fs.statSync(dirOrFile).isDirectory()) {
      for (const name of fs.readdirSync(dirOrFile)) {
        if (name.endsWith('.test.ts')) continue
        const full = path.join(dirOrFile, name)
        if (fs.statSync(full).isDirectory()) queue.push(full)
        else if (name.endsWith('.ts')) queue.push(full)
      }
      continue
    }

    const file = dirOrFile
    if (seen.has(file)) continue
    seen.add(file)

    const text = fs.readFileSync(file, 'utf8')
    assert.equal(banned.test(text), false, `import banido em ${file}`)

    for (const match of text.matchAll(importRe)) {
      const spec = match[1]!
      if (!spec.startsWith('.')) continue
      const resolved = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'))
      if (fs.existsSync(resolved)) queue.push(resolved)
    }
  }

  assert.ok(seen.size > 0)
})

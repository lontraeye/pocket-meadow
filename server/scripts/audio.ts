import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

// ffmpeg-static é só de desenvolvimento: os scripts geram os MP3 e eles vão
// commitados. A VM nunca precisa de ffmpeg.
const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null
const run = promisify(execFile)

/**
 * Converte para MP3 mono. MP3 porque toca em qualquer navegador, inclusive no
 * Safari de iPhones mais antigos, que não abrem Ogg (PLANNING.md, seção 6.3).
 */
export async function toMp3(input: string | Buffer, output: string): Promise<void> {
  if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform')
  let source = typeof input === 'string' ? input : ''
  if (typeof input !== 'string') {
    source = path.join(os.tmpdir(), `pocket-meadow-audio-${process.pid}-${Date.now()}`)
    fs.writeFileSync(source, input)
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  try {
    await run(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      source,
      '-map_metadata',
      '-1',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '5',
      output,
    ])
  } finally {
    if (typeof input !== 'string') fs.rmSync(source, { force: true })
  }
}

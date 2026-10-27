// Efeitos sonoros (PLANNING.md, seção 6.3): de que arquivo do Kenney (CC0) sai
// cada um. `npm run sounds:sfx -- <pastas dos pacotes>` converte para
// web/public/sounds/sfx/<uso>.mp3. Trocar um som = trocar o arquivo aqui.
export const sfxSources = {
  tap: 'select_001.ogg', // Interface Sounds
  harvest: 'pluck_001.ogg', // Interface Sounds
  release: 'maximize_002.ogg', // Interface Sounds: tom médio que sobe, despedida
  shake: 'drop_003.ogg', // Interface Sounds: batida grave e curta, a bola balançando
  catch: 'confirmation_002.ogg', // Interface Sounds
  escape: 'minimize_006.ogg', // Interface Sounds: espelho do levelup, descendo
  levelup: 'maximize_006.ogg', // Interface Sounds
} as const

export type SfxName = keyof typeof sfxSources

export const sfxOutputDir = '../web/public/sounds/sfx'

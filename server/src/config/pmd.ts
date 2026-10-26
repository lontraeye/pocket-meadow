export const pmd = {
  repoUrl: 'https://github.com/PMDCollab/SpriteCollab.git',
  commit: 'dc5203a9e558fdb725f8315b43c61f4b781b6981', // 2026-10-26
  cacheDir: '.cache/spritecollab',
  outputDir: '../web/public/sprites/pmd',
  manifestPath: '../web/src/lib/pmd-manifest.json',
  creditsPath: '../CREDITS-PMD.md',
  anims: ['Walk', 'Idle', 'Sleep'],
} as const

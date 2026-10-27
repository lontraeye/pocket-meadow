# Pocket Meadow — Planejamento do Projeto

> Projeto pessoal, sem fins comerciais. Fan project; Pokémon é marca da Nintendo / Game Freak / The Pokémon Company.
> Este documento descreve a visão, a arquitetura e as mecânicas. O modelo de dados está em `DATA_MODEL.md`.
> **Todas as fórmulas e números aqui são valores iniciais de balanceamento e devem morar em arquivos de config, não espalhados pelo código.**

---

## 1. Visão

Um jogo web idle/AFK com tema Pokémon. Não há batalhas manuais nem exploração. O jogador tem um **jardim** (um gramado simples) onde seus Pokémon ficam andando à toa. O progresso vem de:

1. **Encontros**: gastar energia para tentar a sorte em uma região e encontrar um Pokémon aleatório.
2. **Batalha automática**: se vencer, pode tentar capturar.
3. **Batalhar faz o Pokémon crescer**, como nos jogos: quem luta ganha XP, sobe de nível e evolui ao chegar no nível. **Duplicatas dão um extra**: soltar gera doces da linha evolutiva, que viram XP para quem você quiser.
4. **Daycare**: Pokémon colocados lá ganham XP com o tempo, sem gastar doces.
5. **Berries**: plantadas no jardim, levam tempo real para crescer e dão bônus.

Loop principal: **encontro → batalha (XP) → captura → time mais forte → regiões novas**, com as duplicatas virando doce para acelerar quem ficou para trás.

O jogo é online. Dá para ver o jardim de outra pessoa. Não há batalha direta entre jogadores. As interações sociais previstas são adicionar amigos, deixar um presente para um amigo e trocar Pokémon. O schema e a fase disso ficam para depois do loop single-player. Presente e troca seguem as regras que já existem: o servidor resolve, a operação roda em transação, e um jogador não pode ficar com zero Pokémon.

---

## 2. Princípios de arquitetura (importante)

- **Nada roda em loop no servidor.** Não existe tick global. Todo progresso baseado em tempo (energia, daycare, berries) é calculado **sob demanda** a partir de timestamps, quando o jogador faz uma requisição. Jogador offline custa zero de CPU.
- **Toda lógica de jogo e todo RNG ficam no servidor.** O cliente só exibe e envia intenções ("quero um encontro na região X"). O cliente nunca informa resultados, horários ou valores.
- **O relógio é sempre o do servidor** (`Date.now()` no backend). Isso impede trapaça adiantando o relógio local.
- **Encontros pendentes são persistidos.** Ao gerar um encontro, o resultado (espécie, nível, shiny) é salvo no banco antes de ser mostrado. Recarregar a página não rerola nada.
- **Operações que gastam recursos rodam em transação** (gastar energia, gastar doces, soltar Pokémon etc.).
- **Balanceamento em config.** Regiões, tabelas de spawn, berries, fórmulas e constantes ficam em arquivos de config versionados (ex.: `server/src/config/*.ts`). O banco guarda apenas o estado dos jogadores e os dados estáticos das espécies.
- **Várias contas não são bloqueadas, e o jogador não é avisado.** O servidor registra IP e user-agent de cada registro, login e logout, lidos da conexão (atrás do Caddy deste projeto, o proxy sobrescreve `X-Forwarded-For` e o servidor só confia nesse header com `TRUST_PROXY=1`). Esses registros alimentam um painel de alertas de admin, ainda sem tela, para moderar depois. A API não devolve aviso, badge ou erro especial por causa disso. Quando a troca existir, cada troca também fica registrada para o mesmo painel.

---

## 3. Stack sugerida

| Camada | Escolha | Observação |
|---|---|---|
| Hospedagem | VM Oracle Cloud Always Free (já existente) | Roda lado a lado com outro projeto. O catch-up sob demanda cabe nessa máquina: sem jogador online, o servidor não fica em loop |
| Containers | Docker Compose | Um compose por projeto, isolados |
| Reverse proxy | Caddy | Roteia por subdomínio, HTTPS automático |
| Backend | Node + Hono | API REST JSON |
| ORM | Drizzle ORM | Migrações versionadas, bom suporte a SQLite |
| Banco | SQLite com WAL | Um arquivo; backup = copiar o arquivo (usar `.backup` / `VACUUM INTO`) |
| Frontend | Vite + Svelte + TypeScript | Build estático servido pelo Caddy |
| Auth | Usuário + senha (argon2), sessão por cookie httpOnly | Simples; projeto pessoal |
| Dados | PokéAPI (seed único) | Não consultar em tempo real |
| Sprites | GIFs animados do Showdown via repositório `PokeAPI/sprites` | Baixados uma vez e servidos localmente |

### Estrutura de pastas sugerida

```
/
├─ docker-compose.yml
├─ Caddyfile                # (ou no Caddy compartilhado da VM)
├─ server/
│  ├─ src/
│  │  ├─ config/            # regiões, spawns, berries, fórmulas, constantes
│  │  ├─ db/                # schema Drizzle, migrações
│  │  ├─ game/              # lógica pura: catchUp, battle, capture, rng, xp
│  │  ├─ routes/            # handlers HTTP
│  │  └─ index.ts
│  └─ scripts/
│     ├─ seed-species.ts    # puxa dados da PokéAPI e popula `species`/`evolutions`
│     ├─ seed-regions.ts    # tabelas de encontro da PokéAPI → `snapshots/regions.json` (seção 5.3)
│     ├─ download-sprites.ts
│     └─ pmd-sprites.ts     # sprites do jardim (seção 4.5)
├─ web/
│  ├─ public/sprites/showdown/{id}.gif
│  ├─ public/sprites/showdown/shiny/{id}.gif
│  ├─ public/sprites/pmd/{id}/{Walk,Idle,Sleep}.png
│  ├─ public/sprites/pmd/{id}/shiny/{Walk,Idle,Sleep}.png
│  └─ src/
│     └─ lib/pmd-manifest.json   # gerado pelo pmd-sprites.ts
└─ data/                    # volume do SQLite (fora do git)
```

A pasta `server/src/game/` deve conter **funções puras** (recebem estado + `now` + RNG, devolvem novo estado), para serem fáceis de testar.

---

## 4. Dados externos

### 4.1 Seed das espécies (script único)
`scripts/seed-species.ts` percorre a faixa de IDs configurada (começar com Gen 1–2, IDs 1–251; faixa em config) e salva:

- De `/pokemon/{id}`: `name`, base stats (hp, attack, defense, special-attack, special-defense, speed), `types`, `base_experience`.
- De `/pokemon-species/{id}`: `capture_rate`, `is_legendary`, `is_mythical`, `evolution_chain.url` (extrair o ID), `evolves_from_species`.
- De `/evolution-chain/{id}`: pares de evolução (de → para) e `min_level` quando houver.

Evoluções por item, amizade etc. são **simplificadas**: viram "por nível". Isso inclui a **evolução por troca**: ela também evolui por nível. O seed marca essas evoluções com `via_trade` (`trigger` = `trade` em `evolution_details`), só para as missões de NPC (seção 5.15) saberem quais têm atalho. A marca não bloqueia nada. Se a PokéAPI não fornecer `min_level`, usar um valor padrão do config (ex.: estágio 1→2 no nível 16, 2→3 no nível 36).

Respeitar a PokéAPI: fazer as requisições em sequência com pequeno delay e cachear as respostas em disco durante o seed.

O script também grava `server/snapshots/species.json`, que fica versionado. O servidor aplica esse snapshot no boot, logo depois das migrações, de forma idempotente. Assim um banco novo, inclusive o da VM, já nasce com as espécies, sem acessar a PokéAPI. Só é preciso rodar o script de novo para mudar a faixa de IDs ou as regras de evolução.

### 4.2 Sprites
`scripts/download-sprites.ts` baixa, para cada ID da faixa:

```
https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/{id}.gif
https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/shiny/{id}.gif
```

e salva em `web/public/sprites/showdown/`. Não fazer hotlink em produção. No CSS, usar `image-rendering: pixelated` ao escalar.

### 4.3 Direção de arte
Não há arte original como padrão. O visual é um mix de pixel art pronta e interface web estilizada:

- Pokémon no jardim: sprites do PMD Sprite Collab (seção 4.5). Em detalhes, encontros e onde faltar PMD: os GIFs do Showdown, acima.
- Cenário, ícones e props (grama, canteiro, berry, presente): pixel art gratuita. O repositório é público, então a licença precisa permitir redistribuição (CC0, CC-BY, CC BY-NC, OFL). Licença "grátis, mas sem redistribuir" não serve. Todo asset entra no `CREDITS.md`. Escalar com `image-rendering: pixelated`.
- Painéis, botões e texto: HTML e CSS, no mesmo clima, sem imitar um jogo em canvas.

Pixel art feita à mão só entra quando não houver peça pronta que sirva. Não desenhar um set inteiro por conta própria.

### 4.4 Mobile é plataforma principal
Jogo idle é aberto várias vezes ao dia, quase sempre no celular. Toda tela nasce pensada para celular em retrato e depois se adapta ao desktop, nunca o contrário.

- Layout a partir de ~360px de largura, sem rolagem horizontal. Respeitar `env(safe-area-inset-*)` (notch, barra de gestos).
- Alvos de toque com no mínimo 44×44px. Ações principais (encontro, colher) ao alcance do polegar, na parte de baixo da tela.
- Nada depende de hover. Detalhes abrem por toque (sheet/modal), não por tooltip.
- O jardim isométrico precisa caber em retrato: a grade se ajusta à largura e os sprites escalam em múltiplos inteiros, com `image-rendering: pixelated`.
- Texto legível sem zoom (mínimo 16px em inputs, para o iOS não dar zoom ao focar).
- Testar sempre no viewport mobile do navegador, e de vez em quando num celular de verdade.
- PWA (instalar na tela inicial) entra na Fase 6.4. **Sem notificação push por enquanto**: push exigiria algo agendado rodando no servidor, contra a seção 2. No lugar, avisos de "pronto" ao abrir o app (Fase 6.1).

O primeiro jardim testa um chão isométrico com esses Pokémon 2D por cima. Ver seção 5.11.

### 4.5 Sprites do jardim (PMD Sprite Collab)

Os GIFs do Showdown são poses de batalha de frente e ficam estranhos andando no chão isométrico. No jardim usamos os sprites do [PMD Sprite Collab](https://github.com/PMDCollab/SpriteCollab), no estilo Pokémon Mystery Dungeon. Eles são vistos de cima e cada um tem animação nas 8 direções. O Showdown continua no card de detalhes, nos encontros e como fallback.

#### Fonte e versão
- O repositório tem ~2 GB e muda todo dia. **Não clonar inteiro** nem usar `master` direto.
- Clone raso e parcial em `server/.cache/spritecollab/` (já ignorado pelo `.gitignore`), só com os arquivos usados. Para todas as gerações, isso dá ~150 MB e leva ~30 s. O clone nunca vai para a VM.
- A versão fica fixada por commit em `server/src/config/pmd.ts`. Atualizar é **manual e de propósito**: trocar o commit no config, rodar o script, revisar o `git diff` de `web/public/sprites/pmd/` e commitar.

```ts
// server/src/config/pmd.ts
export const pmd = {
  repoUrl: 'https://github.com/PMDCollab/SpriteCollab.git',
  commit: 'dc5203a9e558fdb725f8315b43c61f4b781b6981', // 2026-10-26
  cacheDir: '.cache/spritecollab',
  outputDir: '../web/public/sprites/pmd',
  manifestPath: '../web/src/lib/pmd-manifest.json',
  creditsPath: '../CREDITS-PMD.md',
  anims: ['Walk', 'Idle', 'Sleep'],
} as const
// A faixa de IDs vem de speciesSeed (config/seed.ts), a mesma do seed.
```

Para preparar o clone (o script faz isso sozinho se a pasta não existir, ou se o commit fixado for outro):

```sh
git init .cache/spritecollab
git -C .cache/spritecollab remote add origin <repoUrl>
git -C .cache/spritecollab sparse-checkout set --no-cone \
  /tracker.json /credit_names.txt \
  '/sprite/*/AnimData.xml' '/sprite/*/credits.txt' \
  '/sprite/*/Walk-Anim.png' '/sprite/*/Idle-Anim.png' '/sprite/*/Sleep-Anim.png' \
  '/sprite/*/0000/0001/AnimData.xml' '/sprite/*/0000/0001/credits.txt' \
  '/sprite/*/0000/0001/Walk-Anim.png' '/sprite/*/0000/0001/Idle-Anim.png' '/sprite/*/0000/0001/Sleep-Anim.png'
git -C .cache/spritecollab fetch --depth 1 --filter=blob:none origin <commit>
git -C .cache/spritecollab checkout <commit>
```

Rodar o `git` com `execFileSync` (argumentos em lista, sem shell).

#### Como o repositório é organizado
- `sprite/{dex com 4 dígitos}/` é a forma normal. **`sprite/{dex}/0000/0001/` é o shiny.** Outras subpastas são formas (ex.: Unown B em `sprite/0201/0001/`) ou slots não oficiais (`canon: false`, ex.: "Altcolor"). Por enquanto só usamos a forma normal e o shiny.
- `tracker.json` é o índice. `tracker[dex].sprite_complete` vale 0 (só Idle, ou nada), 1 (inclui Idle, Walk e Sleep) ou 2 (completo). O shiny fica em `tracker[dex].subgroups['0000'].subgroups['0001']`. **Ignorar o campo `sprite_files`**, que não diz se o arquivo existe.
- `AnimData.xml` traz, por `<Anim>`: `Name`, `FrameWidth`, `FrameHeight` e `Durations` (um `<Duration>` por quadro, **em frames de jogo de 1/60 s**). Uma animação pode ser só `<CopyOf>Outra</CopyOf>`: nesse caso, usar os dados e o PNG da outra. Na raiz há `<ShadowSize>` (0, 1 ou 2).
- `{Anim}-Anim.png` é a folha: **colunas = quadros, linhas = direções**. Walk e Idle têm 8 linhas, e Sleep normalmente tem 1. Ordem das linhas: 0 ↓, 1 ↘, 2 →, 3 ↗, 4 ↑, 5 ↖, 6 ←, 7 ↙. O número de direções é `altura do PNG / FrameHeight`.
- `credits.txt` é TSV, uma linha por contribuição: `data  autor  status  licença  ações`. O autor é um ID do Discord (`<@!123>`) ou `CHUNSOFT`. O status `CUR` vale; `OLD` foi substituído. `credit_names.txt` (TSV `Name  Discord  Contact`) traduz o ID para nome e contato.

#### Script `server/scripts/pmd-sprites.ts` (`npm run sprites:pmd`)
Para cada dex da faixa, e para cada variante (normal e shiny):
1. A variante é válida se o nó do tracker tem `sprite_complete >= 1` e Walk, Idle e Sleep existem no clone, depois de resolver o `CopyOf`.
2. Conferir o PNG: `largura == FrameWidth × nº de quadros` e `altura % FrameHeight == 0`. Se não bater, pular a variante e avisar no relatório.
3. Copiar para `web/public/sprites/pmd/{dex}/{Anim}.png` (shiny em `{dex}/shiny/`). Apagar da saída as pastas e arquivos que não vieram nesta rodada, para não sobrar sprite velho.
4. Juntar os créditos: linhas `CUR` cujas ações incluem Walk, Idle ou Sleep.

Ao final, gravar:
- **`web/src/lib/pmd-manifest.json`**, que o front importa (fica no bundle e é tipado). Uma espécie fica de fora quando não tem PMD.

```json
{
  "commit": "dc5203a…",
  "species": {
    "1": {
      "shadow": 1,
      "normal": {
        "Walk":  { "w": 40, "h": 40, "dirs": 8, "durations": [4, 4, 4, 4, 4, 4] },
        "Idle":  { "w": 32, "h": 40, "dirs": 8, "durations": [40, 6, 6] },
        "Sleep": { "w": 24, "h": 24, "dirs": 1, "durations": [30, 35] }
      },
      "shiny": { "Walk": { … }, "Idle": { … }, "Sleep": { … } }
    }
  }
}
```

`shiny` é `null` quando não há shiny PMD. As medidas do shiny podem diferir das do normal, então ele tem o próprio bloco.

- **`CREDITS-PMD.md`** na raiz, gerado: commit usado, licença (CC BY-NC 4.0, com link) e lista de autores (nome + contato) com os dex que cada um fez. `CHUNSOFT` aparece como "Spike Chunsoft (sprites originais de Pokémon Mystery Dungeon)". O `CREDITS.md` aponta para esse arquivo.
- **Relatório no console:** quantos normais e shiny saíram, e a lista de dex sem PMD e sem shiny PMD. Na Gen 1–2, hoje, são 0 sem PMD e 12 sem shiny: Pidgey, Raichu, Growlithe, Ditto, Dratini, Sentret, Furret, Lanturn, Sunkern, Girafarig, Sneasel e Delibird.

Rodar o script duas vezes seguidas com o mesmo commit não pode gerar diff.

#### Front: componente `PmdSprite.svelte`
- Props: `speciesId`, `shiny`, `anim` (`'Walk' | 'Idle' | 'Sleep'`), `dir` (0–7) e `scale` (inteiro).
- Desenha um `div` do tamanho `w×scale` por `h×scale`, com a folha como `background-image`, `background-size` escalado e `background-position` em `(-quadro×w, -linhaDaDireção×h)` × scale. Usar `image-rendering: pixelated`. Se a animação tem 1 direção, usar sempre a linha 0.
- Quadro atual: as durações variam por quadro, então `steps()` em CSS não serve. Usar **um único `requestAnimationFrame` no Garden** para todos os sprites. Cada sprite calcula o quadro a partir do tempo decorrido e da soma das `durations` (× 1000/60 ms). Nada de `setInterval` por sprite.
- **Ponto de apoio:** no PMD, o centro do quadro é o ponto da criatura no chão. Alinhar o centro do quadro com o centro do bloco. Sombra em CSS (elipse) com tamanho por `shadow`: 0 pequena, 1 média, 2 grande.
- **Escala:** sprites PMD em `2 × scale` do jardim. Assim ficam proporcionais ao bloco e entre si: um Onix fica maior que um Pidgey.

#### Direção no isométrico
Cada passo na grade é uma diagonal na tela:

| Movimento na grade | Na tela | Linha da folha |
|---|---|---|
| coluna +1 | ↘ | 1 |
| linha −1 | ↗ | 3 |
| coluna −1 | ↖ | 5 |
| linha +1 | ↙ | 7 |

Hoje o Garden anda em linha reta até um bloco aleatório, o que gera diagonais "tortas" na tela. Para casar com a folha, **andar bloco a bloco**: primeiro as colunas, depois as linhas (ou intercalado), cada passo com a sua direção. Parado, o sprite mantém a última direção.

#### Comportamento no jardim
- Andando: `Walk` na direção do passo.
- Ao chegar: `Idle` na última direção, pelo tempo de espera que já existe.
- Às vezes, em vez de andar, dorme: `Sleep` por um tempo maior (ex.: 15% de chance, 20–40 s). Os valores ficam numa constante no topo do Garden, não espalhados.
- Tocar em quem está dormindo abre os detalhes normalmente.

#### Fallbacks
| Caso | Jardim | Card de detalhes / encontro |
|---|---|---|
| Tem PMD normal e shiny | PMD | Showdown |
| Shiny sem PMD shiny | PMD **normal** + marca de shiny (brilho em pixel piscando de vez em quando, em CSS) | Showdown **shiny** |
| Sem PMD (Gen 5+ no futuro) | GIF do Showdown, como hoje (espelhando) | Showdown |

A regra fica numa função só (ex.: `gardenSprite(speciesId, isShiny)` em `web/src/lib/sprites.ts`), que lê o manifesto. Nada de lista fixa de nomes no código.

#### Licença
CC BY-NC 4.0 (os mais antigos usam `PMDCollab_1`/`PMDCollab_2`, também com crédito). Combina com o projeto: público, sem fins lucrativos e com crédito. Os sprites normais das Gen 1–2 são todos extraídos dos jogos oficiais do PMD (`CHUNSOFT`), com o mesmo status dos GIFs do Showdown. Os shiny são, em geral, recolors da comunidade e precisam do crédito por autor que o `CREDITS-PMD.md` gera.

#### Pronto quando
- `npm run sprites:pmd` roda do zero (sem clone) e de novo sem gerar diff.
- `web/public/sprites/pmd/` tem os 251 normais e os shiny disponíveis. O manifesto e o `CREDITS-PMD.md` estão commitados.
- No jardim, cada Pokémon anda bloco a bloco com a direção certa, para, e às vezes dorme. Sem espelhar.
- O shiny sem PMD aparece com a marca no jardim e com o GIF shiny no card.
- Funciona em 360px (seção 4.4), e 15 Pokémon andando não travam no celular.

---

## 5. Mecânicas

### 5.1 Treinador
- Tem **nível de treinador** e **XP de treinador**.
- XP de treinador vem de: vencer batalhas, capturar, evoluir.
- O nível de treinador **desbloqueia regiões, slots de daycare e canteiros de berry**.
- Vitória e captura ficam em `server/src/config/trainer.ts`:
  - vitória: `8 + 2 × nível do selvagem`
  - captura: `10 + nível do selvagem`, somada à da vitória no mesmo encontro
  - evoluir fica para a Fase 3
- Próximo nível: `trainerXpToNext(level) = floor(30 × level ^ 1.7)`. No `LEVEL_CAP`, o XP que sobra zera, como no Pokémon.
- Com essa curva, vencer e capturar um selvagem por volta do nível 4 rende 30 XP e completa o nível 2. Cerca de cinco encontros assim na Rota 1 abrem a Floresta Verde (nível 3). A Rota 30 (nível 6) pede mais algumas dezenas.

### 5.2 Energia
- Cada encontro custa 1 de energia.
- Regenera 1 a cada `ENERGY_REGEN_MS` (inicial: 15 min), até `ENERGY_MAX` (inicial: 10).
- Calculada por timestamp (ver seção 6).

### 5.3 Regiões e spawn
Cada região é uma área real dos jogos. A raridade e os níveis vêm das tabelas de encontro oficiais, pela PokéAPI, em vez de pesos inventados. Quem escolhe as áreas, a versão e o `minTrainerLevel` somos nós, no config. O script só traduz a área em pesos e níveis.

Nos nomes: **região**, no código e na API (`regions`, `region_slug`), é uma área jogável (rota, floresta, caverna). Kanto e Johto são a **região do jogo**, no campo `gameRegion`.

#### Config (escrito à mão)
```ts
// server/src/config/regions.ts
{
  slug: 'viridian-forest',
  name: 'Floresta Verde',
  gameRegion: 'kanto',        // 'kanto' | 'johto'
  minTrainerLevel: 3,
  source: { area: 'viridian-forest-area', version: 'red' },
  levelOverride: undefined,   // opcional: [min, max], quando a PokéAPI trouxer faixa estranha
  exclude: [],                // opcional: speciesIds para tirar da tabela
}
```

- **A versão é escolhida por região, não por geração.** Exemplo: a Floresta Verde do Yellow não tem Pikachu, e a do Red tem 5%. Padrão: Yellow para Kanto e Crystal para Johto. Trocar só quando houver motivo, com um comentário no config dizendo qual.
- Só o método `walk` (mato e caverna). Vara, surf e headbutt ficam para regiões próprias depois (ex.: um lago).
- Espécies fora da faixa de `speciesSeed` são descartadas.
- `gameRegion` sai no `GET /regions`, e a tela de exploração agrupa as regiões por ele. Por enquanto todas as regiões aparecem para todo jogador. A escolha de região inicial, que vai filtrar por `gameRegion` e definir o inicial, entra depois, com regras ainda a decidir.

#### Script `server/scripts/seed-regions.ts` (`npm run seed:regions`)
Usa o mesmo cache em disco e o mesmo delay do `seed-species.ts`. Para cada região:
1. Lê `/location-area/{area}` e filtra `version_details` pela versão e `encounter_details` pelo método `walk`.
2. **Slots:** cada `encounter_detail` é um slot `{ speciesId, minLevel, maxLevel, chance }`. Slots da mesma espécie com a mesma faixa somam a chance. Não juntar faixas diferentes: no Yellow, o Pidgey Nv 3 da Rota 1 sai 40% das vezes, e o Nv 7 sai 1%.
3. **Período do dia** (Crystal): as condições `time-morning`, `time-day` e `time-night` formam três tabelas. Um slot sem condição de período entra nas três. O peso final é a média das três. (Usar o relógio do servidor para trocar a tabela fica para depois e exige um fuso fixo no config.)
4. Normaliza os pesos para somar 100, com 1 casa decimal. Algumas tabelas da PokéAPI não somam 100.
5. Aplica `exclude` e `levelOverride`. O override vale para todos os slots da região.
6. Se a área não tiver nenhum slot `walk` na versão, o script falha com o nome da região. Nada de região vazia.

Grava **`server/snapshots/regions.json`**, versionado, ordenado por slug e por slot. Rodar duas vezes não pode gerar diff. O servidor importa o JSON (sem banco) e junta com o config. Uma região do config sem entrada no snapshot é erro no boot.

```json
{
  "viridian-forest": {
    "area": "viridian-forest-area",
    "version": "red",
    "slots": [
      { "speciesId": 13, "minLevel": 3, "maxLevel": 5, "weight": 45 },
      { "speciesId": 25, "minLevel": 3, "maxLevel": 5, "weight": 5 }
    ]
  }
}
```

#### Sorteio
Continua com 3 chamadas ao `rng()`, na ordem da seção 7: (1) slot por peso, (2) nível dentro da faixa do slot, (3) shiny. O nível passa a vir do slot sorteado, não de uma faixa única da região. `GET /regions` mostra `wildLevelRange` = menor e maior nível entre os slots, sem revelar a tabela.

#### Raridade
- **Raro** = espécie cuja soma dos slots na região fica ≤ `RARE_WEIGHT_MAX` (inicial: 10, na escala normalizada para 100). O Razz (seção 5.10) multiplica todos os slots dessas espécies. A conta é por espécie, não por slot, porque os slots são por faixa de nível: o Pidgey Nv 7 da Rota 1 tem peso 1, mas o Pidgey soma 70. Substitui a regra antiga "abaixo do maior peso", que na Rota 1 dobrava Caterpie e Weedle.
- Espécies que não aparecem no mato (iniciais, fósseis, lendários, presentes) ficam fora das regiões por enquanto. Ver questões em aberto.

#### Regiões iniciais
Três por região do jogo, com a mesma escada de nível. Substituem as três atuais. A Rota 30 do config atual não bate com o jogo: Sentret e Mareep não aparecem lá no Crystal.

| Região | `gameRegion` | Área / versão | `minTrainerLevel` | O que sai (aprox.) |
|---|---|---|---|---|
| Rota 1 | kanto | `kanto-route-1-area` / yellow | 1 | Pidgey 70, Rattata 30 · Nv 2–7 |
| Floresta Verde | kanto | `viridian-forest-area` / red | 3 | Weedle 45, Kakuna 40, Caterpie 5, Metapod 5, Pikachu 5 · Nv 3–6 |
| Mt. Moon | kanto | `mt-moon-1f` / yellow | 6 | Zubat 75, Geodude 20, Sandshrew 4, Clefairy 1 · Nv 6–12 |
| Rota 29 | johto | `johto-route-29-area` / crystal | 1 | Pidgey 33, Sentret 27, Rattata 18, Hoothoot 18, Hoppip 3 · Nv 2–3 |
| Rota 30 | johto | `johto-route-30-area` / crystal | 3 | Caterpie 33, Pidgey 17, Hoothoot 15, Ledyba 10, Spinarak 10, Poliwag 7, Weedle 3, Hoppip 3, Zubat 2 · Nv 3–4 |
| Union Cave | johto | `union-cave-1f` / crystal | 6 | Geodude 30, Rattata 20, Sandshrew 20, Zubat 18, Wooper 7, Onix 5 · Nv 4–7 |

Os pesos do Crystal já são a média dos três períodos. Próximas candidatas, já conferidas na PokéAPI: Rota 22 (Nidoran ♀/♂, Mankey), Rota 24/25 (Oddish, Bellsprout), Rota 31 e Rota 32 (Crystal).

#### Pronto quando
- `npm run seed:regions` gera o snapshot do zero e de novo sem diff.
- Os testes cobrem: soma 100 por região, slots dentro da faixa de espécies, Razz mexendo só em espécies raras, média dos períodos e o sorteio em 3 chamadas.
- O replay pela seed (seção 7) continua batendo com o encontro salvo.

- **Shiny**: chance `SHINY_RATE` (inicial: 1/512), possivelmente aumentada por berry.

### 5.4 Encontro
1. Jogador escolhe uma região desbloqueada.
2. Servidor aplica catch-up, verifica energia, gasta 1 energia.
3. Sorteia espécie, nível e shiny. **Salva como encontro pendente.**
4. Jogador vê o Pokémon selvagem e pode:
   - **Batalhar** (mandando um time de 1 a 3 Pokémon seus, seção 5.5), ou
   - **Fugir** (encontro encerrado, energia não volta).
5. Só pode existir **um encontro pendente por jogador** por vez.
6. Encontros pendentes expiram após `ENCOUNTER_TTL_MS` (inicial: 30 min) e viram `fled`.

### 5.5 Batalha (automática e probabilística)
- O jogador manda um **time de 1 a 3 Pokémon** contra o selvagem. O time serve para tentar capturar Pokémon muito fortes ou lendários, que um Pokémon sozinho quase nunca vence.
- Os Pokémon do time precisam ser distintos, do jogador e estar no jardim (não no daycare).
- Poder de um Pokémon:
  ```
  power = baseStatTotal * (1 + level / 10)
  ```
- Poder do time, com retorno decrescente, para que mandar 3 não seja sempre a escolha óbvia:
  ```
  powers    = poderes do time, do maior para o menor
  teamPower = Σ powers[i] * BATTLE_TEAM_WEIGHTS[i]       // inicial: [1, 0.6, 0.4]
  ```
  Exemplo com os valores iniciais: Mewtwo nível 70 contra três Pokémon nível 40 de BST 500 dá ~42% de vitória; com um só, cai para o mínimo de 5%.
- Chance de vitória (logística sobre a razão de poder):
  ```
  ratio     = teamPower / wildPower
  winChance = 1 / (1 + exp(-BATTLE_K * ln(ratio)))      // BATTLE_K inicial: 4
  winChance = clamp(winChance, BATTLE_MIN, BATTLE_MAX)  // 0.05 .. 0.95
  ```
  Com poderes iguais a chance é 50%. Sempre existe uma chance pequena de vencer um muito mais forte e de perder para um muito mais fraco.
- **Derrota**: encontro encerrado. Os Pokémon do jogador não sofrem penalidade (não há HP persistente).
- **Vitória**: cada Pokémon que lutou ganha XP pela fórmula abaixo, **dividido pelo tamanho do time**. O treinador ganha XP normalmente, e o encontro segue para a captura. Dividir o XP é o custo de mandar mais gente: para upar um Pokémon específico, compensa lutar sozinho.
- **XP de batalha**, igual aos jogos a partir da Geração 5. O BST decide a luta (poder, acima), e o `base_experience` decide a recompensa:
  ```
  b  = base_experience do selvagem (PokéAPI)
  L  = nível do selvagem
  Lp = nível de quem lutou (calculado para cada Pokémon do time)
  xp = floor( (b * L / BATTLE_XP_DIV) * ((2L + 10) / (L + Lp + 10)) ^ BATTLE_XP_LEVEL_EXP ) + 1
  ganho = floor(xp / tamanho do time)                 // BATTLE_XP_DIV inicial: 5; BATTLE_XP_LEVEL_EXP: 2.5
  ```
  O fator de nível dá mais XP por vencer alguém mais forte e quase nada por vencer alguém bem mais fraco. No time, o Pokémon de nível mais baixo ganha mais, o que ajuda a puxar quem ficou para trás. Exemplos com os valores iniciais:

  | Selvagem | Quem venceu | XP | O nível pede |
  |---|---|---|---|
  | Pidgey Nv 3 (b 50) | Nv 5 | 23 | 111 |
  | Pidgey Nv 3 | Nv 30 | 3 | 1.643 |
  | Pikachu Nv 4 (b 112) | Nv 5 | 79 | 111 |
  | Zubat Nv 8 (b 49) | Nv 6 | 96 | 146 |
  | Chansey Nv 10 (b 395) | Nv 10 | 791 | 316 |

  Os raros viram prêmio também em XP, e ficar batendo em selvagem fraco não compensa.

### 5.6 Captura
- Após a vitória, uma tentativa de captura:
  ```
  catchChance = clamp((captureRate / 255) * CATCH_MULT * berryBonus, CATCH_MIN, 1)
  ```
  `captureRate` vem da PokéAPI (3 para lendários, 255 para comuns). Inicial: `CATCH_MULT = 1.2`, `CATCH_MIN = 0.03`.
- Sucesso: o Pokémon entra na coleção (no jardim). Falha: ele foge.
- Uma tentativa por encontro (pode ser revisto no futuro).

#### Pokébolas (ideia, ainda sem fase)
Anotado para depois. Precisa de especificação própria.
- Tipos de bola com multiplicador na captura (ex.: Poké Ball ×1, Great Ball ×1,5, Ultra Ball ×2), todos em config. O multiplicador entra na fórmula acima, ao lado do `berryBonus`.
- As bolas são itens do `inventory` (`ball:poke`, `ball:great`…), sem tabela nova.
- Responde a questão em aberto "mais de uma tentativa de captura por encontro": cada tentativa gasta uma bola, e o jogador escolhe qual usar. Cada tentativa é uma rolagem a mais no PRNG (seção 7), na ordem em que foram feitas.
- A decidir:
  - de onde vêm as bolas (inicial, recompensa de nível de treinador, álbum da seção 5.12, colheita);
  - se encontro sem bola permite capturar;
  - um limite de tentativas por encontro;
  - a relação com a animação da pokébola da seção 5.13.

### 5.7 Doces (pontos ao soltar)
O doce é um **extra**: XP para acelerar um Pokémon sem precisar batalhar com ele. Ele não é requisito para evoluir (seção 5.8).

- Doces pertencem a uma **linha evolutiva** (`evolution_chain_id`), não a uma espécie. Soltar um Charmander dá doces que servem para Charmander, Charmeleon e Charizard.
- Ao soltar:
  ```
  candies = RELEASE_BASE + floor(level / RELEASE_LEVEL_DIV)   // inicial: 3 + floor(level / 5)
  ```
  Shiny dá multiplicador (inicial ×3).
- Também concede **doce genérico** (`RELEASE_GENERIC`, inicial: 1, sem multiplicador de shiny), usável em qualquer Pokémon a uma taxa pior: `GENERIC_PER_CANDY` genéricos (inicial: 3) valem 1 doce específico.
- Não é possível soltar um Pokémon que está no daycare, nem o último Pokémon do jogador. Soltar sempre pede confirmação no frontend, e a confirmação avisa quando é shiny ou favorito.
- **Soltar vários de uma vez.** Duplicata é o recurso principal, e soltar 20 Pidgeys um por um no celular é inviável. `POST /pokemon/release` recebe `{ pokemonIds }` (1 a `RELEASE_MAX_PER_REQUEST`, inicial: 50, distintos). É tudo ou nada, numa transação: se um id não puder ser solto, nada é solto, e a resposta diz qual id e por quê. A regra "não ficar com zero" vale para o lote inteiro.
- Soltar incrementa `trainers.total_releases`. Os encontros que citam o Pokémon (`caught_pokemon_id`, `encounter_fighters.pokemon_id`) ficam com NULL pelo `ON DELETE SET NULL` que já existe.
- A resposta traz, por linha evolutiva, os doces creditados e o saldo novo, e também o genérico creditado e o saldo novo.

### 5.8 Nível, XP e evolução
- Nível máximo: `LEVEL_CAP` (inicial: 100).
- XP necessária para o próximo nível:
  ```
  xpToNext(level) = floor(10 * level ^ 1.5)
  ```
- Fontes de XP do Pokémon: vencer batalha (fórmula da seção 5.5), daycare, e **usar doces** (cada doce = `CANDY_XP` XP, inicial: 25).
- **Evolução**: requer só `level >= minLevel` da evolução, como nos jogos. Não custa doce. Não é automática: ao chegar no nível, aparece o botão **Evoluir**, porque o jogador escolhe o destino nas ramificações (Eevee, Gloom) e pode preferir esperar. Mantém nível, XP, shiny e apelido. A coluna `evolutions.candy_cost` fica sem uso, e não vale uma migração só para tirá-la.

#### Alimentar (`POST /pokemon/:id/feed`)
- Corpo: `{ candies, useGeneric? }`. `candies` é a quantidade de **doses**, de 1 a `FEED_MAX_PER_REQUEST` (inicial: 999). Cada dose dá `CANDY_XP`.
- `useGeneric: false` (padrão): cada dose debita 1 doce da linha. `useGeneric: true`: cada dose debita `GENERIC_PER_CANDY` genéricos. Não mistura as duas moedas na mesma chamada.
- **Sem desperdício:** o servidor consome no máximo as doses necessárias para chegar ao `LEVEL_CAP` e devolve quantas consumiu de fato. Pokémon no nível máximo responde erro `level_cap`.
- Saldo insuficiente para o pedido responde `not_enough_candies`, sem consumir nada. O front limita o seletor ao saldo, mas quem valida é o servidor.
- Pokémon no daycare não pode ser alimentado (o daycare já dá XP; evita conta dupla no catch-up).
- A resposta traz as doses consumidas, os doces debitados, o XP ganho, os níveis subidos, o nível e XP novos e o saldo novo.

#### Evoluir (`POST /pokemon/:id/evolve`)
- Corpo: `{ toSpeciesId }`. Precisa existir a linha em `evolutions` saindo da espécie atual para `toSpeciesId`, o que cobre as ramificações, como Eevee e Gloom.
- Valida que o Pokémon é do jogador, está no jardim e tem `level >= minLevel`. Não debita doce.
- Troca `species_id` e mantém nível, XP, shiny, apelido e favorito. `original_species_id` não muda.
- Pokédex: a nova espécie conta como vista e capturada (cria a entrada, se não existir, com `seen_count` e `caught_count` +1, `first_seen_at` e `first_caught_at` se ainda forem nulos, e `shiny_caught` se for shiny).
- XP de treinador: `EVOLVE_XP_BY_STAGE` (inicial: 30 para chegar ao estágio 2, 60 para o 3), pelo estágio da espécie nova. Pode subir o nível de treinador e abrir regiões.
- Erros: `evolution_not_found`, `level_too_low` (com o nível pedido) e `in_daycare`.
- No `GET /state`, cada item de `evolutions` traz também `viaTrade`. No sheet, a opção aparece como "Evolui por troca (missão)", sem botão, até as missões existirem.
- **O estado precisa mostrar as opções.** `GET /state` passa a trazer, em cada Pokémon, `evolutions: [{ toSpeciesId, displayName, minLevel }]`. O front mostra quantos níveis faltam, mas só o servidor decide.

#### Ritmo (para revisar depois de jogar)
A fonte principal de XP é a batalha. O doce é atalho. Referência com `xpToNext` atual:

| Trecho | XP | Doces (25 XP cada) |
|---|---|---|
| Nv 5 → 16 (1ª evolução) | ~3.600 | ~145 |
| Nv 16 → 36 (2ª evolução) | ~26.000 | ~1.050 |

Com o XP de batalha da seção 5.5, um nível leva de 5 a 8 batalhas na rota certa no começo, e a primeira evolução sai em cerca de um dia de jogo. Rever os números com a Fase 3 rodando.

#### Apelido e favorito (`PATCH /pokemon/:id`)
- `{ nickname?, isFavorite? }`. Apelido: texto aparado, de 1 a 12 caracteres, sem caracteres de controle. `null` ou vazio volta ao nome da espécie. Vale também para Pokémon no daycare.

#### Coleção e detalhes (front)
O jardim mostra no máximo 15 Pokémon, então a coleção é onde o jogador vê e mexe em todos.

- **Entrada:** botão **Coleção** no dock de baixo, ao lado de **Explorar**.
- **Lista:** grade de cartões, com 3 colunas em 360px. Cada cartão tem sprite, nome ou apelido, nível e marcas de shiny e favorito. Os sprites usam `loading="lazy"`, porque a coleção pode ter centenas de GIFs.
- **Busca e filtros:** busca por nome ou apelido. Filtros em chips: Todos, Favoritos, Shiny, Repetidos (espécies com mais de um) e No daycare. Ordenação: recentes (`caughtAt`), nível, número da Pokédex e nome. O filtro e a ordenação ficam no `localStorage`, com try/catch.
- **Detalhes:** tocar no cartão abre o mesmo sheet do jardim. Ele vira um componente único (ex.: `PokemonSheet.svelte`), usado pelo jardim e pela coleção. O sheet mostra:
  - sprite, apelido editável, favorito, nível, barra de XP, poder, doces da linha e genéricos;
  - **Alimentar:** seletor de doses com − e +, alvos de 44px, limitado pelo saldo e pelo nível máximo. Mostra antes "+X XP → Nv Y" e permite escolher entre doce da linha e genérico;
  - **Evoluir:** uma opção por destino. Aparece habilitada a partir do nível mínimo e, antes disso, mostra "Evolui no Nv X". Ao evoluir, troca o sprite e mostra uma pequena animação, respeitando `prefers-reduced-motion`;
  - **Soltar:** mostra quantos doces vai render. Sempre pede confirmação (o botão fica no dock, onde o polegar passa) e avisa se é shiny ou favorito. Fica desativado, com o motivo, para o último Pokémon e para quem está no daycare.
- **Soltar vários:** um modo "Selecionar" na coleção. Tocar marca os cartões. Uma barra fixa embaixo mostra "Soltar N · +X doces". Se o lote tiver shiny ou favorito, a confirmação lista quais são. O filtro Repetidos combinado com "selecionar todos menos o de maior nível" é o atalho principal.
- Nada depende de hover. Ações principais embaixo, ao alcance do polegar (seção 4.4).

### 5.9 Daycare
- Slots limitados: começa com 1, +1 nos níveis de treinador definidos em config (ex.: 5, 15, 30).
- Pokémon no daycare ganha XP passivo por hora (taxa abaixo), calculado por timestamp ao retirar ou ao consultar o estado.
- Limite de tempo acumulado: `DAYCARE_MAX_HOURS` (inicial: 24) para incentivar o jogador a voltar.
- Pokémon no daycare **não pode** batalhar, ser solto nem evoluir enquanto estiver lá.
- Qualquer Pokémon pode entrar (inclusive de nível baixo; o caso de uso principal é upar raros sem precisar de duplicatas).

#### Taxa de XP
Com a batalha como fonte principal de XP (seção 5.5), uma taxa fixa só vale no começo. Com 30 XP/h, um dia rende 6,5 níveis num Nv 5 e menos de meio nível num Nv 30. A taxa cresce com o nível, mas **mais devagar que a curva**. Um Pokémon alto continua ganhando, só que cada nível demora mais:
```
xpPorHora(level) = DAYCARE_XP_PER_LEVEL_HOUR * level        // inicial: 3
```

| Nível | Níveis por dia cheio (24 h) |
|---|---|
| 5 | ~2,9 |
| 10 | ~2,2 |
| 20 | ~1,6 |
| 30 | ~1,3 |
| 50 | ~1,0 |
| 80 | ~0,8 |

- Na liquidação (seção 6), aplicar hora a hora, porque o nível pode subir no meio. São no máximo `DAYCARE_MAX_HOURS` iterações.
- O bônus do efeito `daycare_boost` (Nanab, seção 5.10) multiplica a taxa da hora.
- `DAYCARE_XP_PER_HOUR` sai do config. Para mudar o ritmo, mexer só em `DAYCARE_XP_PER_LEVEL_HOUR`.

#### Regras
- **Slots:** `DAYCARE_SLOT_LEVELS` no config (inicial: `[1, 5, 15, 30]`, um slot por nível de treinador atingido). O número de slots é derivado do nível, sem flag no banco (`DATA_MODEL.md`, seção 3).
- **O jardim nunca fica vazio:** colocar no daycare exige que sobre pelo menos 1 Pokémon no jardim. Sem isso, o jogador fica sem time para batalhar. Erro `last_in_garden`.
- **Tempo cheio:** o limite de 24 h conta de `entered_at`. Passado isso, o Pokémon para de ganhar XP até sair e entrar de novo. A tela mostra "Cheio", e uma ação **Renovar** faz retirar e colocar numa transação só (o tempo recomeça).
- **XP ganho na estadia** em `daycare_slots.xp_gained`, somado a cada liquidação (precisa de migração). Assim, ao retirar, a resposta mostra "+X XP · +N níveis".
- Pokémon no daycare continua aparecendo na coleção (filtro "No daycare"), mas **não anda no jardim**, porque está fora.

#### Rotas
- `POST /daycare/:slot` com `{ pokemonId }`. Valida: slot desbloqueado e vazio, Pokémon do jogador e no jardim, e que sobra alguém no jardim. Erros: `slot_locked`, `slot_taken`, `in_daycare`, `last_in_garden`, `pokemon_not_found`.
- `DELETE /daycare/:slot`: liquida, apaga a linha, devolve o Pokémon ao jardim. Responde com o XP ganho, os níveis subidos, o nível e o XP novos e as horas na estadia.
- `POST /daycare/:slot/renew`: retira e coloca de novo o mesmo Pokémon, na mesma transação.
- `GET /state`, em `daycare`: além das linhas, traz `slotsUnlocked`, o próximo nível que abre um slot e, por slot, `fullAt` (`entered_at + DAYCARE_MAX_HOURS`) e `xpGained`.

#### Tela (front)
- **Entrada:** botão **Daycare** no dock, ao lado de Coleção e Explorar.
- **Slots:** cada slot é um cartão com sprite, nível, barra de XP, "+X XP até agora" e uma barra do tempo até cheio, com contador. Slot vazio mostra **Colocar** e abre a lista do jardim para escolher. Slot bloqueado mostra "Abre no nível N".
- **No sheet do Pokémon:** **Colocar no daycare**, que vai para o primeiro slot livre ou pede para escolher. Para quem já está lá, **Retirar**.
- O contador é só visual, a partir de `fullAt` e do `now` do `/state`. O servidor decide tudo na próxima requisição.
- Mobile primeiro (seção 4.4): cartões empilhados em retrato, ações embaixo, alvos de 44px ou mais.

#### Cuidador do daycare (ideia, ainda sem fase)
Um Pokémon do jogador fica no daycare **cuidando dos outros**, num lugar próprio que não é slot de treino, e dá um bônus. Só uma lista pequena de espécies pode cuidar, escolhida pelo jeito delas nos jogos:

| Espécie | Por que combina | Bônus (exemplo) |
|---|---|---|
| Chansey / Blissey | Enfermeiras dos Centros Pokémon | +XP por hora (Blissey mais que Chansey) |
| Kangaskhan | Mãe que carrega o filhote na bolsa | Mais forte com Pokémon de nível baixo |
| Miltank | Leite que cura, famosa em Johto | Limite de tempo maior que 24 h |
| Clefairy / Clefable | Fada, cuidadosa | Chance de shiny maior no próximo encontro de quem sair do daycare |
| Jigglypuff / Wigglytuff | Canção de ninar | Bônus enquanto o jogador está fora por muitas horas |

Os bônus da tabela são só exemplos para discutir. Cada um precisa caber no modelo atual.

- **Config:** `DAYCARE_CARETAKERS` com `speciesId` → bônus. Espécie nova entra só no config.
- **Evolução conta:** Blissey cuida melhor que Chansey, e Wigglytuff melhor que Jigglypuff. Isso dá motivo para evoluir esses Pokémon.
- **Liquidação:** o bônus entra hora a hora, como o da Nanab (seção 5.10), só nas horas em que o cuidador estava lá. Se a Nanab estiver ativa também, os dois multiplicam.
- **O cuidador sai do jardim e não batalha**, igual a quem está treinando. A regra de nunca esvaziar o jardim vale para ele também.
- **Por que guardar:** dá uso para espécies que hoje virariam doce, e combina com o álbum (seção 5.12).

Pontos a decidir:
- O cuidador também ganha XP, ou só trabalha.
- Quantos cuidadores ao mesmo tempo (sugestão: 1) e a partir de que nível de treinador.
- Se o bônus cresce com o nível do cuidador.
- Precisa de dado novo no banco (ex.: uma linha em `daycare_slots` com um papel `caretaker`, ou uma tabela própria). Pede migração.

### 5.10 Berries
- O jardim tem canteiros (começa com 2, mais desbloqueados por nível de treinador).
- Plantar consome 1 semente do inventário; a berry fica pronta em `growMs` (definido por tipo).
- Colher dá `yield` unidades da berry e chance de semente extra.
- Usar uma berry aplica um **efeito** ao jogador. Exemplos iniciais (todos em config):

| Berry | Tempo | Efeito |
|---|---|---|
| Oran | 30 min | +2 energia imediata |
| Pinap | 2 h | Próxima captura com chance ×1.5 |
| Razz | 4 h | Próximo encontro com pesos das espécies raras dobrados (seção 5.3) |
| Nanab | 6 h | Daycare ×2 de XP por 2 h |
| Lum | 12 h | Próximo encontro com chance de shiny ×4 |

- Efeitos são **por cargas** (ex.: "próximo encontro") ou **por tempo** (ex.: "por 2 h"). Ver tabela `active_effects`.
- Sementes vêm de: colheita, recompensas de nível de treinador e, ocasionalmente, de vencer batalhas.

#### Config (`server/src/config/berries.ts`)
Cada berry: `key`, `name`, `growMs`, `yield: [min, max]` e `effect`. O efeito tem um destes formatos:
- `{ kind: 'energy', amount }`: imediato, não cria linha em `active_effects`;
- `{ kind: 'charges', effectKey, multiplier, charges }`;
- `{ kind: 'timed', effectKey, multiplier, durationMs }`.

| Berry | `growMs` | `yield` | Efeito |
|---|---|---|---|
| Oran | 30 min | 2–3 | `energy`, +2 |
| Pinap | 2 h | 1–2 | `charges`, `catch_boost` ×1,5, 1 carga |
| Razz | 4 h | 1–2 | `charges`, `rare_boost` ×2, 1 carga |
| Nanab | 6 h | 1–2 | `timed`, `daycare_boost` ×2, 2 h |
| Lum | 12 h | 1 | `charges`, `shiny_boost` ×4, 1 carga |

O código lê os efeitos pela `effectKey`, nunca pelo nome da berry. Berry nova entra só no config.

#### Canteiros
- **Slots:** `PLOT_SLOT_LEVELS` no config (inicial: `[1, 1, 8, 20]`, ou seja, 2 no começo, o 3º no Nv 8 e o 4º no Nv 20). O número de canteiros é derivado do nível, como os slots do daycare. Substitui o `basePlotSlots` fixo.
- **Plantar** (`POST /plots/:index/plant`, `{ berryKey }`): canteiro desbloqueado e vazio, e pelo menos 1 `seed:<berry>` no inventário. Debita a semente e grava `ready_at = now + growMs`, fixado no plantio. Erros: `plot_locked`, `plot_taken`, `no_seed` e `unknown_berry`.
- **Colher** (`POST /plots/:index/harvest`): só com `now >= ready_at` (erro `not_ready`, com o `readyAt`). Apaga o canteiro e credita `berry:<key>` (sorteio dentro de `yield`) e as sementes.
- **Sementes na colheita (a confirmar):** **1 semente garantida** da mesma berry, mais `SEED_EXTRA_CHANCE` (inicial: 0,25) de ganhar uma 2ª. Sem a garantida, uma chance menor que 100% faz as sementes acabarem com o tempo, e o jardim para.
- **Arrancar** (`POST /plots/:index/uproot`): para desfazer um plantio errado. Só antes de ficar pronta (pronta responde `already_ready`, e o caminho é colher). Apaga o canteiro, e a semente volta com `UPROOT_SEED_RETURN_CHANCE` (inicial: 0,5). Se não voltar, ela se perde. O front pede confirmação e mostra a chance.
- O sorteio da colheita usa `crypto` no servidor. Não precisa de replay, porque a colheita é uma ação única numa transação e não há como sortear de novo.

#### Usar berry (`POST /items/:key/use`)
- `key` é `berry:<berry>`. Debita 1 do inventário e aplica o efeito. Erros: `no_item`, `unknown_item` e `energy_full`.
- **Energia (Oran):** soma até `ENERGY_MAX`, sem passar. Com a energia cheia, responde `energy_full` e não gasta a berry. Ao chegar no máximo, `energy_updated_at = now`, como no catch-up (seção 6). Abaixo do máximo, a âncora fica como está, para não perder a fração de regeneração.
- **Mesmo efeito ativo: renova, não empilha.** A linha antiga é substituída pela nova (cargas cheias, ou `expires_at = now + durationMs`). O front avisa antes de usar: "Já tem esse efeito; vai renovar."
- **Consumo das cargas**, como já está no código (`takeBonus`): `shiny_boost` e `rare_boost` ao criar o encontro; `catch_boost` só quando há tentativa de captura (vitória). A Pinap espera até a próxima vitória.

#### Daycare com Nanab: bônus só dentro da janela
Hoje o catch-up aplica o `daycare_boost` à liquidação inteira se o efeito estiver ativo na hora da leitura. Também ignora o bônus quando ele venceu enquanto o jogador estava fora. **Corrigir:** na liquidação hora a hora (seção 5.9), cada hora ganha o bônus **na fração que coincide com a janela** do efeito (`created_at` até `expires_at`). As horas do daycare contam da entrada do Pokémon, não do uso da berry. Por isso a regra "só hora inteira" faria uma Nanab de 2 h usada no meio de uma hora valer só 1 h. Proporcional, as 2 h valem 2 h. Liquidar antes de apagar os efeitos vencidos.

#### Sementes por batalha e por nível
- **Batalha:** numa vitória, `SEED_DROP_CHANCE` (inicial: 0,1) de ganhar 1 semente, sorteada por `SEED_DROP_WEIGHTS` no config (inicial: Oran 50, Pinap 25, Razz 15, Nanab 7, Lum 3). Usa o PRNG do encontro, depois da captura (seção 7).
- **Nível de treinador:** `TRAINER_LEVEL_REWARDS` no config. Ao subir de nível, em batalha ou ao evoluir, os itens daquele nível entram no inventário, na mesma transação, e a resposta lista o que veio. Inicial: 1 `seed:oran` em todo nível, mais `seed:razz` no Nv 3, `seed:nanab` no Nv 5, `seed:lum` no Nv 8, e a partir daí 1 semente sorteada por `SEED_DROP_WEIGHTS` a cada 5 níveis. Subir vários níveis de uma vez dá a recompensa de todos.

#### Tela (front)
- **Canteiros no jardim:** cada canteiro é um bloco da grade (já existe o `tile.plot`), com o estágio visível: vazio, plantado, crescendo e pronto (com o ícone da berry). Tocar no canteiro abre um sheet:
  - vazio: escolher a semente;
  - crescendo: barra e contador até `readyAt`;
  - pronto: **Colher**, mostrando o que veio.
- O contador usa o `now` do servidor mais o tempo desde o `/state`, como no daycare. Não usar o relógio do celular.
- **Mochila:** botão no HUD (44px ou mais) que abre um sheet com sementes, berries (com **Usar** e a descrição do efeito) e os efeitos ativos (cargas ou tempo restante).
- **Explorar:** mostra os efeitos ativos em chips no topo da lista de regiões, porque é lá que Razz, Lum e Pinap importam.
- **Arte:**
  - ícones das berries: os PNG de `items/<berry>-berry.png` do repositório `PokeAPI/sprites`, baixados uma vez como os GIFs do Showdown (seção 4.2), com o mesmo status, e creditados no `CREDITS.md`;
  - estágios do canteiro: em CSS (monte de terra, broto, arbusto) ou pixel art com licença redistribuível (CC0, CC-BY, CC BY-NC, OFL). Nada sem licença clara.
  - **Depois:** procurar um tileset gratuito com licença redistribuível para os canteiros e o jardim. Hoje os estágios são 3 em CSS (broto até 20%, arbusto, pronta), e quase todo o tempo fica no arbusto. Com a arte nova, considerar mais fases (ex.: broto → arbusto → flor → pronta). Só muda o visual e a função `plotStage` no `Garden.svelte`. O servidor continua guardando só `planted_at` e `ready_at`.
- Mobile primeiro (seção 4.4).

### 5.11 Jardim (visual)
Teste reversível. O chão e os objetos (grama, canteiro, itens) ficam numa grade isométrica, em blocos, porque colocar coisa num gramado frontal fica achatado. Os Pokémon usam os sprites do PMD (seção 4.5), que têm animação de andar nas 8 direções. O passo segue a grade, e cada passo usa a linha diagonal correspondente da folha, sem espelhar. Só o fallback com GIF do Showdown espelha (`transform: scaleX(-1)`) conforme o lado horizontal do movimento. A ordem de desenho segue a profundidade do bloco, para quem está na frente cobrir quem está atrás.

Se o mix ficar estranho, o jardim volta a um gramado frontal. O teste é só visual, no cliente. Não muda regra, timestamp nem API.

- Mostra no máximo `GARDEN_MAX_VISIBLE` (inicial: 15) Pokémon andando. Prioridade: favoritos, depois aleatórios.
- Movimento puramente visual no cliente: alvo aleatório na grade, andar até ele, esperar alguns segundos, repetir.
- Clicar em um Pokémon abre os detalhes (nível, XP, doces da linha, ações).
- Canteiros de berry ocupam um bloco da grade.

### 5.12 Pokédex e guia do jogo (ideia, ainda sem fase)
Anotado para depois. Precisa de especificação própria antes de virar tarefa.

A Pokédex não é só a lista de espécies vistas e capturadas. Ela também é a wiki do próprio jogo, e a informação de cada espécie vai sendo liberada conforme o jogador avança com ela.

- **Informação por progresso.** Cada espécie tem camadas que abrem por marcos do jogador. Exemplo de escada:
  - visto: sprite e nome;
  - capturado: tipos e linha evolutiva;
  - nível X: regiões onde aparece e faixa de nível;
  - nível Y: ataques e poder especial.

  Os marcos e o que cada um abre ficam em config.
- **Onde encontrar** usa os dados de `snapshots/regions.json` (seção 5.3). Mostrar a raridade em faixas (comum, incomum, raro), não o peso exato, para não entregar a tabela.
- **Guia do jogo** na mesma tela: tutoriais e explicação das mecânicas (energia, batalha em time, doces, daycare, berries). É conteúdo estático do front, sem API.
- **Álbum por blocos.** A Pokédex também se organiza em blocos, como um álbum de figurinhas. Completar um bloco dá uma recompensa.
  - O bloco principal é a **região**: todas as espécies que podem sair nela, tiradas de `snapshots/regions.json`. Os raros de 1% (Clefairy no Mt. Moon, Pidgeotto na Floresta Verde) é que fazem o bloco valer a pena.
  - Outros blocos possíveis, também derivados de dados que já existem: linha evolutiva completa, tipo, região do jogo inteira (Kanto, Johto) e shiny.
  - "Completo" = cada espécie do bloco com `caught_count > 0` em `pokedex_entries`. Isso sobrevive a soltar o Pokémon e a evoluir, porque evoluir já conta a nova espécie como capturada.
  - As recompensas ficam em config, por bloco: sementes, doces genéricos, energia e, depois, cosméticos para o jardim.
  - O jogador resgata a recompensa com uma ação, que roda em transação no servidor. O servidor confere se o bloco está completo e se a recompensa ainda não foi resgatada. O cliente nunca informa que completou.
- Mobile primeiro (seção 4.4): lista com busca e filtro, detalhes num sheet por toque.

Pontos a decidir antes de especificar:
- **Resgate do álbum:** precisa de uma tabela de resgates (`user_id`, `block_key`, `claimed_at`), com migração. Se um bloco ganhar espécies novas, porque a tabela da região mudou num re-seed, decidir se ele reabre com uma recompensa nova ou se o resgate antigo vale para sempre. Sugestão: o resgate antigo vale, e a mudança de tabela vira um bloco novo com outra chave.
- **Marco de "upar":** precisa sobreviver a soltar o Pokémon. A sugestão é guardar `max_level_reached` em `pokedex_entries`, em vez de olhar a coleção atual. Isso pede migração. Ver `DATA_MODEL.md`, seção 5.
- **Ataques e poder especial** ainda não existem no jogo. A batalha é só poder × probabilidade. Falta decidir se viram mecânica (afetam a batalha) ou só informação. Se for informação, dá para tirar da PokéAPI no seed (moves por nível, abilities).
- Se os outros jogadores veem a Pokédex de alguém na visita ao jardim (seção 1).

### 5.13 Batalha com mais vida (ideia, ainda sem fase)
Anotado depois do teste da Fase 2. Hoje o encontro é seco: abre a rota, aparece o Pokémon, escolhe o time, sai o resultado. A escolha pesa pouco e a derrota não é sentida. O objetivo é um combate simplificado, na linha do Pokémon GO, e mais "juice" no caminho todo.

**Combate:**
- Turnos curtos com ataque rápido e ataque carregado. HP visível dos dois lados e troca de Pokémon do time quando um cai.
- Tipos contam. `type1` e `type2` já estão em `species`, e a tabela de efetividade pode ir para o config.
- Ataques: liga com a Pokédex (seção 5.12). Dá para tirar da PokéAPI no seed (moves por nível), limitando a 2 por Pokémon (1 rápido e 1 carregado).

**Restrição que não muda:** o resultado continua decidido no servidor, com a seed do encontro (seções 2 e 7). Ritmo de toque ou reflexo no cliente não pode decidir nada, porque o cliente pode mentir. Dois formatos compatíveis:
1. **Simulação com replay.** O servidor simula a luta inteira, turno a turno, e devolve o log. O cliente anima o log. Não há entrada durante a luta, e a escolha está antes: time, ordem e tipos.
2. **Decisões por turno.** O cliente manda só intenções ("usar o carregado", "trocar para o 2"). O servidor resolve cada turno e guarda o estado da batalha. É mais interativo, mas pede estado persistido de batalha em andamento, com expiração.

Sugestão: começar pelo formato 1. Ele já dá o "juice" e cabe no modelo atual (uma requisição por batalha). O formato 2 pode vir depois, se fizer falta.

**Sprites da batalha: PMD em vez do Showdown.** O pack do PMD Sprite Collab (seção 4.5), que já usamos no jardim, tem animações de golpe por Pokémon, nas 8 direções. Conferido no commit fixado em `config/pmd.ts`:
- Comuns a todos os conferidos: `Attack`, `Strike`, `Shoot`, `Charge`, `Hurt`, `Swing`, `Hop` e `Rotate`.
- Golpes próprios em alguns: `Shock` (Pikachu), `Lick` (Gengar), `Stomp` (Snorlax), `Rumble` (Gyarados).
- `Faint` só em parte (tem em Charizard, Pikachu e Gengar, falta em Gyarados, Snorlax, Unown e Lugia).

**Fallbacks genéricos em CSS (decidido).** Quando faltar uma animação, a batalha usa uma versão genérica em cima do sprite que existir (o `Idle` do PMD ou o GIF):
- **Ataque:** investida estilo Tackle. O sprite avança na direção do alvo e volta.
- **Dano:** o sprite treme e pisca.
- **Desmaio:** o sprite treme, desce e some.

A escolha fica numa função só (como `gardenSprite` em `web/src/lib/sprites.ts`), que lê o manifesto e devolve a animação do pack ou o fallback. Nada de lista fixa de espécies. Com isso, a cobertura de golpes deixa de bloquear a batalha: espécie sem golpe só fica menos animada. Respeitar `prefers-reduced-motion`.

A batalha pode acontecer num pedaço do chão isométrico, com o seu Pokémon olhando ↗ e o selvagem ↙ (linhas 3 e 7 da folha). Fica com a mesma arte do jardim, e o "juice" dos golpes vem do próprio pack. Isso pode aposentar os GIFs do Showdown.

Antes de decidir:
- **Cobertura:** os golpes vêm com `sprite_complete = 2` no `tracker.json`. Medir quantas espécies da faixa, e quantos shiny, têm cada animação. Hoje o script só exige `>= 1` (Walk, Idle e Sleep).
- **Onde o Showdown ainda é usado:** card de detalhes, encontro, os 12 shiny sem PMD da Gen 1–2 (seção 4.5) e, no futuro, as espécies sem PMD (Gen 5+). Tirar o Showdown pede um fallback para esses casos, ou manter os GIFs só como reserva.
- **Script e créditos:** `pmd-sprites.ts` passa a copiar as animações de batalha, e o `CREDITS-PMD.md` passa a incluir os autores delas (hoje só entram as linhas com Walk, Idle ou Sleep). A licença é a mesma (CC BY-NC 4.0).
- **Tamanho:** as folhas de golpe são maiores. Medir o peso de `web/public/sprites/pmd/` e o carregamento no celular. Carregar as animações de batalha só ao abrir a batalha, não no jardim.

**Juice no fluxo todo:** o Pokémon surgindo no mato, barras de HP, número de dano, piscada de acerto, animação da pokébola com chacoalhadas antes do resultado e comemoração ao capturar. Sons só com licença redistribuível (seção 4.3), creditados no `CREDITS.md`. Respeitar `prefers-reduced-motion`.

**Pontos a decidir:**
- Isso muda a visão da seção 1 ("não há batalhas manuais"). Atualizar o texto quando for adotado.
- Como fica `winChance` (seção 5.5): vira resultado da simulação ou continua como base para equilibrar.
- A ordem do PRNG (seção 7) passa a ter um número variável de rolagens na batalha. A captura teria que vir de um ponto fixo, por exemplo um segundo PRNG derivado da seed, para o replay continuar simples.

### 5.14 Campo de encontro com escolha (ideia, ainda sem fase)
Hoje, gastar 1 de energia dá exatamente um Pokémon. A ideia é gastar a energia e abrir um **mini gramado gerado na hora**, com 3 ou 4 Pokémon da região andando nele. O jogador toca no que interessa e esse vira o encontro. Exemplo: aparecem Pidgey e Rattata. Mesmo que o Pidgey seja mais raro ali, quem não gosta dele pode escolher o Rattata.

- Os candidatos saem do mesmo sorteio da seção 5.3, um após o outro, com a seed do encontro. A raridade continua valendo: ela decide o que aparece no campo, não o que o jogador escolhe.
- **Os candidatos são persistidos antes de aparecer**, como o encontro hoje. Recarregar a página mostra o mesmo campo, e não dá para rerolar.
- O visual pode reaproveitar o chão isométrico e os sprites PMD do jardim (seção 4.5), em versão pequena.
- Mobile: o campo cabe em retrato, cada Pokémon é um alvo de toque de 44px ou mais, e os detalhes abrem por toque.

**Pontos a decidir:**
- **Modelo de dados:** uma tabela de candidatos ligada ao encontro (`encounter_candidates`: espécie, nível, shiny, slot). `encounters.species_id` e `level` passam a ser preenchidos na escolha. Pede migração, e a regra de "um encontro pendente por vez" passa a valer para o campo.
- **Ordem do PRNG (seção 7):** N × (slot, nível, shiny) para os candidatos, depois batalha e captura. Fixar N no config para o replay funcionar.
- Os que não foram escolhidos somem ao escolher ou ficam disponíveis enquanto o campo não expira, com uma batalha por campo ou várias pagando mais energia.
- Pokédex: todos os candidatos contam como vistos, ou só o escolhido.
- Shiny no campo: aparece de cara, o que vira o grande momento do campo.

### 5.15 Missões de NPC: Pokédex completa jogando sozinho (ideia, ainda sem fase)
Nos jogos, nenhuma Pokédex fecha sem outra pessoa: há evoluções por troca e espécies exclusivas de versão. Aqui, **a experiência solo tem que ser completa**. A troca entre jogadores (seção 1) continua prevista, mas nunca é obrigatória. Quem cobre essa lacuna são NPCs com missões.

- **Decidido: evolução por troca não é bloqueada.** Ela continua saindo por nível, como qualquer evolução (seção 5.8). A missão é um **caminho alternativo**, que deixa evoluir antes do nível. Para isso, a missão precisa aparecer num nível **abaixo** do nível da evolução. Se aparecesse no mesmo nível, não adiantaria nada. Se o jogador tiver mais de um Pokémon elegível, ele escolhe qual entregar.
- Para espécies fora do mato, a missão pode ser o jeito de obter, ao lado de regiões novas e eventos (ver o mapa abaixo).
- O nível de cada evolução por troca vem do padrão do config (Nv 16 para chegar ao estágio 2, como Onix → Steelix; Nv 36 para o estágio 3, como Haunter → Gengar). Se algum ficar estranho, criar um override por evolução no config.
- **Como funciona:** um NPC passa um objetivo. Ao cumprir, ele faz a troca. Exemplo: "capture 5 Pokémon do tipo fantasma". Você entrega seu Haunter, ele volta como Gengar. Como na troca dos jogos, o Pokémon é o mesmo e mantém nível, XP, shiny, apelido e favorito.
- **Evoluções por troca na Gen 1–2:** Kadabra → Alakazam, Machoke → Machamp, Graveler → Golem, Haunter → Gengar, Onix → Steelix, Scyther → Scizor, Poliwhirl → Politoed, Slowpoke → Slowking, Seadra → Kingdra e Porygon → Porygon2. **Hoje o seed transforma todas em evolução por nível**, com o nível padrão do config: Haunter → Gengar no Nv 36, Onix → Steelix e Scyther → Scizor já no Nv 16.
- **Espécies que não aparecem no mato** (iniciais da outra região, fósseis, presentes como Eevee e Lapras, exclusivas de versão) também podem vir de missões. Isso responde parte da questão em aberto sobre essas espécies.
- **Objetivos derivados do que o jogo já guarda,** para não precisar de rastreio novo: capturar N de um tipo ou espécie (`pokedex_entries`), ter um Pokémon em tal nível, completar um bloco do álbum (seção 5.12), vencer N batalhas numa região (`encounters`). As missões e os NPCs ficam em config.
- **Servidor decide:** cumprir e resgatar é uma ação em transação. O servidor confere o objetivo e se a missão já foi feita, e quem escolhe o Pokémon entregue é o jogador. Resgates numa tabela (`user_id`, `quest_key`, `claimed_at`), que pode ser a mesma do álbum.
- **Visual:** o NPC pode morar no jardim ou numa tela de região, com um diálogo curto. Arte só com licença redistribuível (seção 4.3).

**Mapa das espécies sem rota (tarefa futura).** Antes de especificar as missões, gerar a lista das espécies da faixa do seed que não dá para obter **em nenhuma região do config**, nem por evolução por nível a partir de uma espécie obtenível. Decidir uma a uma: entra numa região nova, vira missão ou fica para evento. A lista sai das regiões (`snapshots/regions.json`) e da tabela `evolutions`, com as evoluções por troca contando como obteníveis, porque saem por nível. Pode ser um script de relatório, no mesmo estilo do relatório do `pmd-sprites`. Rodar de novo sempre que entrar uma região, porque a lista diminui.

Pontos a decidir:
- **Em que nível a missão de troca aparece.** Sugestão: um nível próprio por missão no config, abaixo do nível da evolução (ex.: Haunter evolui sozinho no Nv 36, e a missão do Gengar aparece no Nv 25). Uma regra fixa também serve, como "10 níveis antes".
- Missões únicas ou repetíveis. Uma troca de Haunter por missão, ou o NPC aceita outros Haunters depois.
- Se o NPC também troca espécie por espécie (dar um Pokémon e receber outro), como as trocas com NPC dos jogos.

### 5.16 Construção do jardim: biomas, máquinas e itens de evolução (ideia, ainda sem fase)
O jogador constrói o próprio jardim: transforma terrenos em biomas, coloca máquinas operadas por Pokémon e, com isso, libera itens, espécies e evoluções. Liga várias peças que já existem (daycare, berries, missões, espécies sem rota) numa progressão só. A referência de gênero é construir o próprio espaço com Pokémon trabalhando, como no Pokopia. As regras, os biomas e as máquinas são nossos.

**Decidido até agora:**
- **Evolução por item existe e precisa do item.** As evoluções por pedra (Gloom → Vileplume, Pikachu → Raichu, Eevee etc.) deixam de sair por nível e passam a exigir o item no inventário. O seed marca essas evoluções e o item a partir do `evolution_details` da PokéAPI (`trigger` = `use-item`), como já marca a troca. Quando entrar, a seção 4.1 muda. Regra final por tipo de evolução:
  - nível: sai por nível;
  - troca: sai por nível, e a missão é atalho (seção 5.15);
  - item: só com o item.
- **Vários jeitos de conseguir os itens de evolução:** máquinas, missões de NPC (5.15), recompensas de nível de treinador, álbum (5.12) e, talvez, drop raro em batalha. Nenhum item fica com um único caminho.
- **Máquinas com operador.** O jogador coloca um Pokémon para operar a máquina, que produz um item depois de um tempo. Não é qualquer Pokémon: cada máquina tem requisito de tipo e, mais adiante, de habilidade. Exemplo: um Pokémon elétrico opera o gerador que produz Thunder Stone, e um Rattata gira uma roda. Funciona como daycare e canteiro juntos: o operador sai do jardim e não batalha, e o servidor guarda quando a máquina fica pronta e entrega o item ao coletar. Nada roda em loop (seção 2). A regra de nunca esvaziar o jardim vale para operadores.
- **Habilidades:** mapear só as que interessam ao jogo, não todas. Elas entram no seed (PokéAPI) quando forem necessárias e servem de requisito de máquina e de ação de campo. Também alimentam o "poder especial" da Pokédex (5.12). Até lá, os requisitos usam tipo e, quando precisar, uma lista de espécies no config.
- **Pokémon transformam o terreno (ações de campo).** Um Pokémon com o tipo ou a habilidade certa muda um bloco do jardim. Exemplo: um Pokémon de água rega terra seca e ela vira grama, o que desbloqueia o bioma de grama. Um Pokémon que sabe construir produz um item especial, que libera outro item de bioma. Isso forma uma árvore: nível de treinador → ação de campo → bioma → máquina ou item → evolução ou espécie nova.
- **Biomas dão bônus e atraem Pokémon.** Cada bioma (grama, água, pedra, areia, caverna…) dá bônus a certos tipos e **atrai visitantes**: espécies que aparecem no jardim e podem ser encontradas ali. É o segundo jeito de obter espécies, ao lado das rotas, e resolve parte do mapa das espécies sem rota (5.15).
- **Modo de edição** para construir. Escolher um bloco e o que colocar, por toque, sem arrastar com precisão. Mobile primeiro (seção 4.4).
- **Arte:** o usuário faz a pixel art (tiles de bioma, máquinas, itens que faltarem), mesmo que simples. Antes, mapear a lista de peças necessárias. Arte própria entra no `CREDITS.md` com a licença escolhida para ela. Peças de terceiros seguem a seção 4.3.

**Pontos a decidir quando for especificar:**
- **Modelo de dados:** blocos do jardim (`garden_tiles`: posição, bioma, objeto), máquinas (`machines`: tipo, posição, operador, `ready_at`) e quais biomas e máquinas estão liberados. Tudo pede migração. Desbloqueios derivados do nível ficam fora do banco (`DATA_MODEL.md`, seção 3). Desbloqueios conquistados ficam no banco.
- **Visitantes:** custo (energia ou nada), quantos ao mesmo tempo, quanto tempo ficam, e se viram encontro com batalha normal. O sorteio fica no servidor e é persistido antes de aparecer, como o encontro (seções 2 e 7). Tem paralelo com o campo de encontro (5.14).
- **Custo de construir:** nível libera e um recurso paga (itens produzidos, berries, doces genéricos), ou só desbloqueio por ação de campo.
- **Ritmo de produção** das máquinas, e se o nível do operador acelera.
- **Ordem sugerida:**
  1. itens de evolução (seed marca, item no inventário, Evoluir exige; o item vem de missão ou recompensa no começo);
  2. uma ou duas máquinas;
  3. ações de campo e biomas, com o modo de edição;
  4. visitantes.
- **Canteiros de berry no modo de construção.** Hoje os canteiros ficam fixos na última fileira do jardim, e o número cresce com o nível (seção 5.10). Com o modo de edição, o jogador escolhe onde ficam, e o canteiro vira um objeto como os outros. O número máximo continua derivado do nível. Dá para casar com os biomas: certas berries só crescem, ou crescem mais rápido, num bioma específico. O `plot_index` do banco passaria a ter uma posição no jardim.
- **Lista de arte** para o usuário: tiles por bioma, estados da terra (seca, regada, grama), máquinas com e sem operador, ícones dos itens de evolução que não vierem do `PokeAPI/sprites`.

### 5.17 Personagem e perfil de treinador (ideia, ainda sem fase)
O jogador monta o visual do próprio treinador, e isso é o começo de um **perfil de treinador**: o cartão que os outros veem ao visitar o jardim (seção 1).

- **Avatar em camadas:** corpo, cabelo, roupa de cima, de baixo, calçado e acessório. Cada camada é uma folha de sprite, e o avatar é a sobreposição delas. O jogador escolhe por toque, com prévia, em mobile primeiro.
- **Base pronta + peças próprias:** começar com um pacote pronto e, depois, o usuário desenha peças exclusivas. As peças próprias entram no `CREDITS.md` com a licença escolhida.
- **Candidatos a base** (conferir a licença de cada peça antes de usar, seção 4.3):
  - **LPC (Liberated Pixel Cup) e o gerador de personagens:** o mais completo, com centenas de peças. Mas a licença é misturada, com muitas peças CC-BY-SA ou GPL. CC-BY-SA não está na lista aceita hoje: ou se usa só as peças CC0 e CC-BY, ou se decide aceitar CC-BY-SA no projeto;
  - **Kenney, "Roguelike Characters":** CC0, pixel pequeno com partes trocáveis. É mais simples, sem problema de licença;
  - **sprites de treinador do Showdown:** personagens fixos, sem personalização, que serviriam como "escolha um avatar da lista", com o mesmo status dos outros sprites Pokémon.
- **Estilo:** o avatar precisa combinar com os sprites do PMD do jardim. Se o treinador andar no jardim, as direções da folha importam: LPC tem 4 direções, e o PMD tem 8.
- **Peças como recompensa:** roupas liberadas por progresso (nível de treinador, álbum da seção 5.12, missões da 5.15), além das peças básicas de início. Dá outro motivo para completar coisas.
- **Cartão de treinador:** nome, avatar, nível, espécies capturadas, Pokémon favorito em destaque, data de início e, depois, conquistas do álbum.

Pontos a decidir:
- **Modelo de dados:** o avatar como chaves por camada (`avatar` JSON ou colunas em `trainers`) e as peças liberadas, só as conquistadas, porque as do nível são derivadas (`DATA_MODEL.md`, seção 3). Pede migração.
- Se o treinador aparece andando no jardim ou só no cartão e no HUD.
- Validação no servidor: só aceitar peças que o jogador liberou.

---

## 6. Cálculo de progresso por tempo ("catch-up")

Função pura `applyCatchUp(state, now)`, chamada no início de **toda** requisição que lê ou altera o estado do jogador, dentro da mesma transação:

```ts
// Energia
const elapsed = now - trainer.energyUpdatedAt;
const gained  = Math.floor(elapsed / ENERGY_REGEN_MS);
if (trainer.energy >= ENERGY_MAX) {
  trainer.energyUpdatedAt = now;
} else if (gained > 0) {
  trainer.energy = Math.min(ENERGY_MAX, trainer.energy + gained);
  trainer.energyUpdatedAt = trainer.energy >= ENERGY_MAX
    ? now
    : trainer.energyUpdatedAt + gained * ENERGY_REGEN_MS; // preserva a fração restante
}

// Daycare: XP calculada por (min(now, enteredAt + MAX) - lastSettledAt)
// Berries: não precisam de catch-up; "pronta" = now >= readyAt
// Efeitos: remover os com expiresAt <= now
// Encontros: marcar como 'fled' os pendentes com expiresAt <= now
```

Retornar também `energyNextAt` para o frontend mostrar o contador regressivo.

---

## 7. RNG
- Usar um PRNG com seed no servidor (ex.: `mulberry32` ou `seedrandom`), com seed gerada por `crypto.getRandomValues` a cada encontro e **salva no registro do encontro**. Permite reproduzir e depurar resultados.
- Todas as rolagens de um encontro (espécie, nível, shiny, batalha, captura) usam a sequência desse PRNG, nessa ordem. Numa vitória, depois da captura vêm a chance de semente e, se ganhou, qual semente (seção 5.10).

---

## 8. API (rascunho)

Todas as rotas exigem sessão, exceto auth. Todas aplicam catch-up antes.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/register` | Cria usuário + treinador + itens iniciais + Pokémon inicial |
| POST | `/auth/login` / `/auth/logout` | Sessão por cookie |
| GET | `/state` | Estado completo: treinador, energia, Pokémon, doces, daycare, canteiros, inventário, efeitos, encontro pendente |
| GET | `/regions` | Regiões com status de bloqueio (sem revelar a tabela exata de spawn) |
| POST | `/encounters` | `{ regionSlug }` → cria encontro pendente |
| POST | `/encounters/:id/battle` | `{ pokemonIds }` (1 a 3, distintos) → resolve batalha e, se vencer, captura |
| POST | `/encounters/:id/flee` | Encerra encontro |
| POST | `/pokemon/:id/release` | Solta e credita doces |
| POST | `/pokemon/release` | `{ pokemonIds }` (1 a 50) → solta vários, tudo ou nada |
| POST | `/pokemon/:id/feed` | `{ candies, useGeneric? }` → aplica XP (seção 5.8) |
| POST | `/pokemon/:id/evolve` | `{ toSpeciesId }` (seção 5.8) |
| PATCH | `/pokemon/:id` | `{ nickname?, isFavorite? }` |
| POST | `/daycare/:slot` | `{ pokemonId }` → coloca |
| DELETE | `/daycare/:slot` | Retira e aplica XP |
| POST | `/daycare/:slot/renew` | Retira e coloca de novo (o tempo recomeça) |
| POST | `/plots/:index/plant` | `{ berryKey }` |
| POST | `/plots/:index/harvest` | Colhe |
| POST | `/plots/:index/uproot` | Arranca antes de ficar pronta; a semente volta com chance |
| POST | `/items/:key/use` | Usa berry → aplica efeito |

Respostas de ação devem retornar o resultado detalhado (rolagens relevantes, XP ganho, level ups, doces) para o frontend animar.

### Início do jogo
Ao registrar: escolher 1 inicial entre Bulbasaur, Charmander e Squirtle, nível 5. Inventário inicial: 3 sementes de Oran, 1 de Pinap. Energia cheia.

---

## 9. Roadmap

**Fase 0 — Infra**
- Repositório, Docker Compose, Caddy com subdomínio na VM Oracle, deploy de um "hello world".
- Backup diário do SQLite (cron na VM copiando para outro lugar).

**Fase 1 — Base**
- Scripts de seed de espécies e download de sprites.
- Schema + migrações.
- Auth.
- `GET /state` e o jardim com Pokémon andando. A primeira versão do jardim é o teste isométrico da seção 5.11. Se não encaixar, volta ao gramado frontal antes de seguir.

**Fase 2 — Encontros**
- Config de regiões (2–3 regiões iniciais), energia com catch-up.
- Encontro, batalha, captura, XP de treinador e desbloqueio de regiões.

**Fase 3 — Progressão**
- XP de batalha pela fórmula da seção 5.5: coluna `base_experience` em `species` (migração e seed de novo).
- Soltar (um ou vários), doces, alimentar, evoluir, apelido e favorito (seções 5.7 e 5.8).
- Tela de coleção (lista, busca, filtros e seleção múltipla) e sheet de detalhes compartilhado com o jardim.
- Pronto quando:
  - o ciclo "capturar repetido → soltar → alimentar → evoluir" funciona inteiro em 360px;
  - as transações da seção 7 do `DATA_MODEL.md` estão cobertas;
  - as funções puras de doces, alimentação e evolução em `game/` têm teste;
  - nenhuma ação deixa o jogador com zero Pokémon nem com saldo negativo.

**Fase 4 — Daycare**
- Slots por nível de treinador, colocar, retirar e renovar, taxa de XP e tela (seção 5.9).
- Migração: `daycare_slots.xp_gained`.
- Pronto quando:
  - colocar, esperar (ou adiantar o relógio num teste) e retirar mostra o XP certo, inclusive subindo de nível no meio;
  - o tempo para no limite e "Renovar" recomeça;
  - o jardim nunca fica vazio;
  - quem está no daycare não batalha, não é solto e não evolui;
  - a tela funciona em 360px.

**Fase 5 — Berries e efeitos**
- Config das berries, canteiros por nível, plantar, colher, usar, renovar efeito, bônus da Nanab só dentro da janela, sementes por batalha e por nível, e tela (seção 5.10).
- Sem mudança de schema: `berry_plots`, `inventory` e `active_effects` já existem.
- Pronto quando:
  - o ciclo "plantar → esperar → colher → usar" funciona com os 5 efeitos;
  - as sementes não acabam no uso normal;
  - Oran com energia cheia não gasta a berry;
  - Nanab só multiplica as horas dentro da janela;
  - o replay do encontro continua batendo com a semente da batalha;
  - a tela funciona em 360px.

**Fase 6 — Sensação e acabamento** (em partes, uma por vez, cada uma testada antes da próxima)

*6.1 — Contador de energia e avisos de "pronto"*
- **HUD:** abaixo das pips, "+1 em 12:34" enquanto não está cheia e "Cheia" quando está. Ao tocar na energia, mostra também quando enche (ex.: "cheia às 18:40" ou "cheia em 1h 45m"). O servidor manda `energyFullAt` junto com `energyNextAt`, calculado com a mesma regra do catch-up (seção 6), sem conta de energia no cliente.
- **Avisos de "pronto"** no lugar do push: um selo (badge) com número no botão do dock correspondente, e um aviso curto no topo do jardim ao abrir o app ("2 berries prontas · daycare cheio"). Tocar no aviso leva ao lugar.
  - berries prontas: canteiros com `readyAt <= agora`;
  - daycare cheio: slots com `fullAt <= agora`;
  - energia cheia: no próprio HUD.
- Tudo calculado com o `serverClock` (mesmo relógio das outras telas). Quando um contador chega a zero na tela, o aviso aparece sem recarregar. O servidor continua decidindo na próxima ação.
- Sem rota nova e sem mudança de schema.

*6.2 — Captura com suspense e destaques de progresso*
- A pokébola chacoalha de 1 a 3 vezes antes do resultado, e há uma comemoração ao capturar. O resultado já veio do servidor, e a animação só encena. O número de chacoalhadas é derivado da chance de captura, só para a cena, sem rolagem nova.
- Destaques (não só texto) para: subir de nível (Pokémon e treinador), "pode evoluir", evolução, região nova liberada, semente ganha e recompensas de nível.
- `prefers-reduced-motion`: sem animação, resultado direto.

*6.3 — Sons*
- Sons curtos nos momentos da 6.2 e em ações (colher, soltar, botão principal). Botão de mudo lembrado no `localStorage`. No celular, o som só toca depois do primeiro toque, por regra do navegador.
- Só com licença redistribuível (ex.: pacotes CC0 do Kenney), creditados no `CREDITS.md`.

*6.4 — Instalar na tela inicial (PWA)*
- `manifest.webmanifest` (nome, ícones, cores, `display: standalone`), ícones nos tamanhos pedidos e service worker simples que cacheia os arquivos estáticos. A API nunca é cacheada, porque o estado vem sempre do servidor.

*6.5 — Revisão mobile e estados*
- Passar todas as telas em 360px e num celular de verdade (seção 4.4).
- Estados de carregando, erro e sem conexão em todas as ações. Nenhum botão fica "morto" sem explicação.

**Fase 7 — Pokédex: guia e álbum** (seção 5.12)
- Vistos e capturados, informação liberada por progresso, onde encontrar, guia do jogo e álbum por blocos com recompensas.

**Depois (ideias anotadas, ainda sem fase):** construção do jardim com biomas, máquinas e itens de evolução (5.16); batalha com mais vida (5.13); campo de encontro (5.14); missões de NPC (5.15); pokébolas (5.6); cuidador do daycare (5.9); personagem e perfil de treinador (5.17).

---

## 10. Questões em aberto
- Mais de uma tentativa de captura por encontro (gastando algo)?
- Pokémon com IVs/natures ou só nível?
- Lendários e espécies que não aparecem no mato (iniciais, fósseis, presentes): regiões especiais, eventos ou peso derivado do `capture_rate`?
- Ranking entre jogadores? A visita ao jardim de outra pessoa já está decidida; o ranking, não.

---

## 11. Balanceamento pendente
Ajustes anotados durante os testes, para a rodada de equilíbrio. Todos os números ficam em config.

- **Daycare rende pouco em nível baixo** (teste da Fase 4). Um Pokémon Nv 12 passa 12 h no daycare e sobe só para o Nv 13. A taxa atual é `DAYCARE_XP_PER_LEVEL_HOUR = 3` (seção 5.9). Referência de outros valores:

  | Multiplicador | Nv 12, 12 h | Nv 12, 24 h | Nv 50, 24 h |
  |---|---|---|---|
  | 3 (atual) | +1,0 nível | +2,0 | +1,0 |
  | 5 | +1,7 | +3,3 | +1,7 |
  | 6 | +2,0 | +3,9 | +2,0 |
  | 8 | +2,7 | +5,1 | +2,7 |

  Também dá para mexer no formato, não só no número: um piso de XP por hora para níveis baixos, ou uma curva com expoente entre 1 e 1,5. Comparar com o ritmo da batalha (seção 5.5) para o daycare não virar a melhor forma de upar.
- **Ritmo dos doces** nos níveis altos (seção 5.8, "Ritmo").

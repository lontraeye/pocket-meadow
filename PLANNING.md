# Pocket Meadow — Planejamento do Projeto

> Projeto pessoal, sem fins comerciais. Fan project; Pokémon é marca da Nintendo / Game Freak / The Pokémon Company.
> Este documento descreve a visão, a arquitetura e as mecânicas. O modelo de dados está em `DATA_MODEL.md`.
> **Todas as fórmulas e números aqui são valores iniciais de balanceamento e devem morar em arquivos de config, não espalhados pelo código.**

---

## 1. Visão

Um jogo web idle/AFK com tema Pokémon. Não há exploração livre; as batalhas são curtas e em tempo real, no estilo do Pokémon GO (seção 5.18). O jogador tem um **jardim** (um gramado simples) onde seus Pokémon ficam andando à toa. O progresso vem de:

1. **Encontros**: gastar energia para tentar a sorte em uma região e encontrar um Pokémon aleatório.
2. **Batalha**: você toca nos golpes do seu time; se vencer, pode tentar capturar (não é garantido).
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
| Execução | Serviço do systemd (`deploy/`) | A VM tem 1 GB: Docker e um segundo Caddy não cabem bem. Mesmo padrão do outro projeto da VM. O `docker-compose.yml` fica para rodar local |
| Reverse proxy | Caddy da VM | Roteia por subdomínio, HTTPS automático, serve o front e repassa `/api` |
| Backend | Node + Hono | API REST JSON |
| ORM | Drizzle ORM | Migrações versionadas, bom suporte a SQLite |
| Banco | SQLite com WAL | Um arquivo; backup por `VACUUM INTO` (seção 4.6) |
| Frontend | Vite + Svelte + TypeScript | Build estático servido pelo Caddy |
| Auth | Só Google (OAuth com PKCE, via `arctic`), sessão por cookie httpOnly | Sem senha guardada. Seção 4.7 |
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
- Cenário, ícones e props (grama, canteiro, berry, presente): pixel art gratuita. O repositório é público, então a licença precisa permitir redistribuição (CC0, CC-BY, CC BY-NC, OFL). **CC-BY-SA** é aceita só no módulo do avatar (seção 5.17), com as regras de lá. Licença "grátis, mas sem redistribuir" não serve. Todo asset entra no `CREDITS.md`. Escalar com `image-rendering: pixelated`.
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

### 4.6 Dados dos jogadores

Desde 2026-10-27 o jogo tem save de verdade em produção. Até ali, as contas eram de teste e podiam ser apagadas. Daqui em diante, nenhuma mudança pode perder dados de jogador.

**Regras**
1. **Migrações só avançam.** Nunca editar uma migração que já rodou. Mudança que apaga ou transforma coluna leva junto o passo que converte os dados existentes (ex.: trocar senha por Google liga a conta que já existe ao `google_sub`, em vez de apagá-la). Zerar o banco para simplificar não é opção.
2. **Testar a migração numa cópia.** Antes do deploy, rodar a migração numa cópia do banco de produção (um backup diário serve) e conferir os dados. Migração nova ganha teste em `db/migrate.test.ts`, no estilo dos que já existem.
   - **Nunca refazer uma tabela que outra referencia com `ON DELETE CASCADE`** (hoje: `encounters`, por `encounter_fighters`; `users` e `pokemon`, por várias). O Drizzle roda cada migração dentro de uma transação, e lá dentro o `PRAGMA foreign_keys=OFF` é ignorado: o `DROP TABLE` da reconstrução apaga em cascata as linhas que apontam para ela. Testado em 2026-10-27 numa cópia de produção: refazer `encounters` apagou todos os `encounter_fighters`. O `drizzle-kit` gera esse tipo de reconstrução sozinho quando muda um `CHECK` ou tira uma coluna com restrição: prefira coluna nova a mudar `CHECK`, e confira o SQL gerado antes de aceitar.
3. **Regra que muda o sentido de dados salvos é anotada aqui**, junto com o que acontece com os saves. Exemplo: mudar `xpToNext` muda o que o `xp` guardado significa. Ajuste de chance, taxa ou peso, que só vale dali para frente, não precisa.
4. **Desenvolvimento nunca toca o banco de produção.** As rotas `/dev` só existem com `DEV_TOOLS=1` e fora de `NODE_ENV=production`.

**Backups** (`server/src/db/backup.ts`, sempre por `VACUUM INTO` e conferidos com `integrity_check`; copiar o arquivo com o servidor rodando pode pegar o WAL pela metade)
- **Antes de migrar:** no boot, se houver migração pendente e o banco já tiver dados, o servidor grava `data/backups/pre-migrate-<data>.sqlite` antes de aplicar. Guarda as 5 últimas.
- **Diário:** o timer `pocket-meadow-backup.timer` (04:30 UTC) roda `node dist/db/backup.js` e grava `daily-<data>.sqlite`. Guarda 14.
- **Fora da VM:** a pasta `/var/lib/pocket-meadow/backups/` também vai para fora da VM (destino a definir; o Object Storage da Oracle é o candidato). Backup que só existe na própria máquina não protege contra perder a máquina.
- **Restore:** `sudo systemctl stop pocket-meadow`, depois `cd /opt/pocket-meadow/current/server && sudo -u pocket-meadow env $(xargs < /etc/pocket-meadow.env) node dist/db/backup.js restore /var/lib/pocket-meadow/backups/<arquivo>` e `sudo systemctl start pocket-meadow`. O banco atual vira `pre-restore-<data>.sqlite` antes da troca. Testar o restore de vez em quando, porque backup que nunca foi restaurado não é garantia.

### 4.7 Login

Só pelo Google, sem senha (desde 2026-10-27; o cadastro por senha nunca teve conta em produção).

**Fluxo** (`server/src/routes/auth.ts`)
1. `GET /auth/google`: gera `state` e o verificador PKCE, guarda os dois em cookies httpOnly de 10 min e manda para o Google com o escopo **só `openid`**.
2. `GET /auth/google/callback`: confere o `state` com o cookie, troca o código pelo token (com o verificador) e lê o `sub` do ID token, conferindo emissor, público e validade. A assinatura não precisa ser conferida, porque o token vem direto do endpoint do Google por TLS (OpenID Connect Core, 3.1.3.7).
3. Conta existente (`users.google_sub`): abre a sessão e volta para `/`.
4. Conta nova: grava `google_signups` (30 min), põe o cookie `signup` e volta para `/?auth=signup`. O front pede nome e inicial, e `POST /auth/signup` cria a conta e consome o cadastro.
5. Erros voltam para `/?auth=cancelled|failed|unavailable`, e o front mostra a mensagem.

**Dados:** o jogo guarda só o `sub`, um ID estável da conta Google. Sem e-mail, nome ou foto.

**Configuração:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `PUBLIC_URL` no ambiente (`/etc/pocket-meadow.env` na VM, `server/.env` local). Sem os três, o botão volta com "não configurado". O client OAuth fica num projeto do Google Cloud em modo "Testing": só os e-mails da lista de test users entram, e não é preciso verificação do app nem política de privacidade. Redirect URIs: `https://pocket.lontraeye.com/api/auth/google/callback` e `http://localhost:5173/api/auth/google/callback`.

**Teste local:** `POST /dev/login { username, starter? }` entra sem Google (só com `DEV_TOOLS=1`) e cria a conta se ela não existir, sem `google_sub`. A tela de login mostra esse formulário no `npm run dev`.

**Por que não Firebase Auth:** a sessão continuaria sendo o nosso cookie, então o Firebase seria só um intermediário. Validar o token dele pede o `firebase-admin`, pesado para a VM de 1 GB; o login por redirect quebra no Safari do iPhone sem proxy extra; e o SDK pesa no front.

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
> **Será substituída pela seção 5.18 (Fase 8).** Vale até a Fase 8 entrar; depois, `power`, `teamPower` e `winChance` saem.
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
- **Vitória**: só quem **entrou em campo e não desmaiou** ganha XP (e EVs). Quem ficou na pokébola não conta. O XP é **dividido entre esses**. O treinador ganha XP normalmente, e o encontro segue para a captura. Mandar gente a mais só custa XP se ela entrar de fato; lutar só com um deixa o XP inteiro nele. **Exp Share** (item) fica para depois e deve ampliar quem recebe sem exigir entrada.
- **XP de batalha**, igual aos jogos a partir da Geração 5. O BST decide a luta (poder, acima), e o `base_experience` decide a recompensa:
  ```
  b  = base_experience do selvagem (PokéAPI)
  L  = nível do selvagem
  Lp = nível de quem recebe (cada um que entrou e não desmaiou)
  xp = floor( (b * L / BATTLE_XP_DIV) * ((2L + 10) / (L + Lp + 10)) ^ BATTLE_XP_LEVEL_EXP ) + 1
  ganho = floor(xp / N)   // N = quantos recebem; BATTLE_XP_DIV inicial: 5; BATTLE_XP_LEVEL_EXP: 2.5
  ```
  O fator de nível dá mais XP por vencer alguém mais forte e quase nada por vencer alguém bem mais fraco. No time, o Pokémon de nível mais baixo ganha mais, o que ajuda a puxar quem ficou para trás. Exemplos com os valores iniciais (N = 1):

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
- Sucesso: o Pokémon entra na coleção (no jardim). Falha: ele pode fugir; dá para lançar de novo (seção 5.18, parte 8.4).
- Com a Fase 9, cada lançamento gasta uma bola, a bola entra na fórmula e a fuga cresce com os erros (ver "Pokébolas" abaixo).

#### Pokébolas (Fase 9, especificado em 2026-10-28)
Hoje a Poké Ball é infinita e cada erro tem 25% fixos de fuga (`throwFleeChance`). A Fase 9 transforma as bolas em itens, deixa escolher qual lançar, guarda no Pokémon a bola que o capturou e troca a fuga fixa por uma que cresce com os erros, com berries para acalmar.

**Decidido (2026-10-28):**
- **Sem bola não há captura.** Sem nenhuma bola, o botão de lançar fica desativado com o motivo ("Sem pokébolas"), e sobra só "Deixar ir".
- **Cada lançamento gasta uma bola**, acerte ou erre. Não há como recuperar a bola.
- **Origem definitiva:** compra e craft (seção 5.16), que ainda não existem. **Até lá:** estoque inicial, recompensas de nível de treinador e do álbum, e o painel de teste.
- **O Pokémon guarda a bola que o capturou** (`pokemon.caught_ball`). Vai servir para efeitos futuros (bônus por bola, visual na ficha, conquistas), então é gravado desde já, mesmo para bolas sem efeito.
- **Trocar de bola antes de lançar** faz parte do jogo: a tela mostra cada bola que o jogador tem, com a quantidade e a chance de captura com ela.
- **Fuga cresce com os erros:** base + degrau por erro, com teto. Berries acalmam (ver abaixo).
- **Berries na captura, inspiradas no Pokémon GO:** umas melhores, outras piores para cada coisa.

**Bolas da primeira versão** (tudo em `server/src/config/balls.ts`; bola nova entra só no config):

| Chave | Bola | Efeito na captura |
|---|---|---|
| `poke` | Poké Ball | ×1 |
| `great` | Great Ball | ×1,5 |
| `ultra` | Ultra Ball | ×2 |
| `master` | Master Ball | captura garantida |
| `quick` | Quick Ball | ×4 no 1º lançamento do encontro, ×1 depois |
| `timer` | Timer Ball | cresce a cada lançamento: ×(1 + 0,3 × lançamentos anteriores), teto ×4 |
| `net` | Net Ball | ×3 contra Inseto ou Água, ×1 contra o resto |
| `nest` | Nest Ball | forte em nível baixo: ×max(1, (41 − nível) / 10), teto ×4 |
| `premier` | Premier Ball | ×1, só enfeite |
| `luxury` | Luxury Ball | ×1, só enfeite por enquanto (efeito depois do capturado, a definir) |

- **Fórmula:** `catchChance = clamp((captureRate / 255) × CATCH_MULT × ballMult × berryMult, CATCH_MIN, 1)`. A Master Ball pula a fórmula (chance 1).
- **Itens no `inventory`** (`ball:poke`, `ball:great`…), sem tabela nova.
- **Sprites:** o ícone de cada bola vem do `PokeAPI/sprites` (`items/<nome>-ball.png`), pelo mesmo script e com o mesmo crédito da Poké Ball da parte 6.2. A cena de captura recebe a bola como parâmetro e troca só o sprite.
- **Efeitos depois da captura** (ex.: Luxury Ball dando mais doces ou XP) ficam para quando houver o que ligar. O `caught_ball` já guarda o necessário.

**Fuga crescente:**
- O encontro guarda a **agitação** (`encounters.agitation`, começa em 0). Cada lançamento que erra soma 1.
- Depois de um erro, a chance de fuga é `min(FLEE_MAX, FLEE_BASE + FLEE_STEP × (agitação − 1))`. Inicial: `FLEE_BASE = 0,10`, `FLEE_STEP = 0,15`, `FLEE_MAX = 0,90` (10%, 25%, 40%, 55%, 70%, 85%, 90%…).
- A tela mostra a agitação de um jeito simples (ex.: o selvagem fica mais inquieto, com um medidor ou ícone), sem número cru.

**Berries na captura (mapeadas pelo Pokémon GO):**
- Dá para dar **uma berry antes de cada lançamento**. Ela vale só para o próximo lançamento e é gasta mesmo se a bola errar, como a bola.
- O efeito na captura é separado do efeito de usar pela Mochila (seção 5.10). No config de cada berry, um campo `capture` opcional; berry sem esse campo não aparece na captura.

| Berry | No Pokémon GO | Na captura (proposta) |
|---|---|---|
| Razz | chance ×1,5 | chance ×1,5 |
| Pinap | doces em dobro | se capturar, ganha doces da linha (ex.: 3; hoje a captura não dá doces) |
| Nanab | acalma | agitação −2 (até 0) |
| Oran | (não existe no GO) | agitação −1 |
| Lum | (não existe no GO) | acalma tudo: agitação 0 |
| Golden Razz (nova) | chance ×2,5 e acalma | chance ×2,5 e agitação −1 |
| Silver Pinap (nova) | chance ×1,8 e doces | chance ×1,8 e, se capturar, doces da linha (ex.: 5) |

- As duas berries novas (Golden Razz e Silver Pinap) são plantadas como as outras, mais raras e mais demoradas, e entram na queda de sementes e nas recompensas com peso baixo.
- **A Pinap pela Mochila** (`catch_boost` ×1,5 no próximo lançamento) fica redundante com a Razz na captura. Decidido: a Pinap sai da Mochila e passa a valer só na captura. Quem tiver carga de `catch_boost` ativa continua usando até gastar.

**Dados e servidor:**
- **Migração** (só avança, testada numa cópia do banco de produção, seção 4.6):
  - `pokemon.caught_ball TEXT NOT NULL DEFAULT 'poke'`: os Pokémon que já existem ficam como Poké Ball, inclusive o inicial;
  - `encounters.agitation INTEGER NOT NULL DEFAULT 0`;
  - a bola e a berry de cada lançamento não precisam de tabela: o resultado sai da seed. Se for útil guardar o histórico, ele vai num JSON do próprio encontro (decidir na implementação);
  - estoque inicial para quem já joga: `ball:poke` (quantidade em config) somado ao inventário de cada treinador.
- **Rota:** `POST /encounters/:id/throw` passa a receber `{ ball, berry? }`. Em uma transação: confere se tem a bola (e a berry), debita, rola, grava. Erros novos: `no_ball`, `unknown_ball`, `berry_not_usable`.
- **PRNG (seção 7):** continua uma rolagem de captura + uma de fuga por lançamento falho, na ordem. A bola e a berry mudam só as chances, não o número de rolagens, então o replay de `throwRngAt` não muda. A Master Ball também consome a rolagem, para a sequência não mudar.
- **Estado:** o `/state` manda as bolas do inventário (já vêm no `inventory`) e o config das bolas e dos efeitos de captura das berries, para o front calcular a chance de cada bola só para mostrar. O servidor decide.

**Front:**
- **Escolha da bola:** uma fileira de bolas que o jogador tem (ícone, quantidade, chance), com a última usada já marcada (lembrada no aparelho). Toque troca. Alvos de 44px, cabe em 360px.
- **Berry:** um botão "Dar berry" que abre as berries com efeito de captura, com o efeito escrito. A berry escolhida aparece marcada até o lançamento.
- **Cena:** a cena de lançamento usa o sprite da bola escolhida.
- **Ficha do Pokémon:** o ícone da bola ao lado do nome ou na aba Perfil ("Capturado com Great Ball · Rota 1").
- **Painel de teste:** "Ganhar bolas (teste)" dá algumas de cada tipo, só com `DEV_TOOLS=1`, como os outros botões de teste.

**De onde vêm as bolas até a compra e o craft** (números iniciais em config, para revisar jogando):
- **Estoque inicial:** 30 Poké Balls para treinador novo e para quem já joga (pela migração).
- **Nível de treinador:** +5 Poké Balls em todo nível; +3 Great Balls a cada 5 níveis; +2 Ultra Balls a cada 10.
- **Álbum (seção 5.12):** bloco de região +5 Poké Balls; linha evolutiva +2 Great Balls; jogo completo +5 Ultra Balls e 1 Master Ball.
- **Vitória (opcional):** chance pequena de cair uma Poké Ball, como a semente da seção 5.10. Decidir depois de jogar se o estoque está curto.

**Decidido em 2026-10-28, depois da proposta:**
- O mapeamento das berries na captura vale como está na tabela, e a Pinap sai da Mochila.
- Golden Razz e Silver Pinap entram já (parte 9.3). Os ícones existem no `PokeAPI/sprites` (`items/golden-razz-berry.png`, `items/silver-pinap-berry.png`), com o mesmo status das outras berries; chaves `golden-razz` e `silver-pinap`, para o script baixar `<chave>-berry.png` sem mudança. São só de captura: sem efeito pela Mochila.
- Os números do estoque e das recompensas acima servem para começar.
- **Sem limite de lançamentos** por encontro: a fuga crescente já limita.
- **Botão de teste para ganhar bolas** (e as berries novas), além do estoque: só com `DEV_TOOLS=1`.

**Tela de captura (refeita em 2026-10-28, na revisão da 9.1–9.3):** o card do selvagem com o palco na altura do sprite; embaixo, Mochila · bola equipada (o botão de lançar, com brilho fraco) · Bolas (equipar); dar berry faz ela voar até o selvagem e o efeito sobe em texto verde (ajudou) ou vermelho (não fez nada), como o número de dano da luta; sair da captura é só "Deixar ir".

#### Arremesso com física (parte 9.4, especificado em 2026-10-28)
O jogador arremessa a bola com o dedo, no estilo do Pokémon GO: segura a bola, pode girá-la, e solta com um movimento para cima. **A habilidade conta**: dá para errar, e um arremesso bom aumenta a chance. Berry também é arremessada, sem giro.

**Decidido:**
- **A habilidade conta.** Errar o alvo gasta a bola. Um anel que encolhe sobre o alvo dá **Nice / Great / Excellent**, e o arremesso com curva dá bônus. Isso entra na chance de captura.
- **O selvagem se mexe mais quando está agitado.** Agitação 0: parado e tonto, como hoje. Cada degrau de agitação aumenta o quanto ele pula e anda de lado, e fica mais difícil de acertar. As berries de acalmar deixam ele mais parado: a agitação passa a ter efeito visível na mira.
- Implementação pelo Cursor, com prompt próprio.

**Gesto e física (front, em `web/src/lib/throwPhysics.ts`, funções puras; números em config no mesmo arquivo):**
- **Segurar:** o toque começa na bola equipada (a de baixo). Ela acompanha o dedo. Durante o gesto a área não rola a página (`touch-action: none` só ali).
- **Girar:** enquanto segura, o ângulo do dedo em volta do centro da bola é somado. Passou de uma volta (360°) no mesmo sentido, a bola fica "girando" (visual de rotação e brilho), e o sentido decide para que lado a curva vai.
- **Soltar:** a velocidade do fim do gesto (px/s, média dos últimos ~80 ms) vira o arremesso. Gesto para baixo ou fraco demais não lança: a bola volta para a mão, sem gastar.
- **Voo em 2,5D:** profundidade de 0 (mão) a 1 (selvagem), que só avança; a velocidade vertical do gesto decide o alcance, a horizontal o desvio, a gravidade puxa para baixo e a curva acelera para o lado. Na tela, a bola encolhe com a profundidade. Duração alvo de 0,6 a 0,9 s. Tudo em `requestAnimationFrame`.
- **Acerto:** quando a profundidade chega a 1, o ponto da bola é comparado com o alvo (o corpo do selvagem; o tamanho pode vir do `pmdBody`, em `sprites.ts`). Fora do alvo é erro: a bola passa, cai e some, com um "Errou!" em vermelho.
- **Anel:** um círculo colorido sobre o alvo encolhe e volta em loop (≈1,2 s). No acerto, o tamanho do anel naquele instante e a distância do ponto ao centro decidem: dentro do anel = **Nice** (anel grande), **Great** (médio) ou **Excellent** (pequeno); fora do anel mas no corpo = acerto comum.
- **Selvagem se mexendo:** posição do alvo em função do tempo e da agitação (pulos e passos de lado com amplitude e frequência crescentes), só visual no front. Agitação 0 = parado.
- **Berry:** escolhida na Mochila, ela vai para o lugar da bola e é arremessada do mesmo jeito, sem giro e sem anel. Acertou: a berry é "dada" (o efeito sobe em texto, como hoje) e a bola volta para a mão. Errou: a berry cai e **volta para a mochila** (não é gasta; quem gasta é o lançamento da bola, como hoje).
- **Sem animação ou sem gesto:** com `prefers-reduced-motion`, pelo teclado (Enter/Espaço na bola) ou com um toque simples sem arrastar, a bola vai reto, **sempre acerta, sem anel nem curva** (qualidade comum). Ninguém fica sem conseguir capturar.

**Qualidade do arremesso no servidor:**
- `POST /encounters/:id/throw` passa a aceitar `{ ball, berry?, quality?: 'normal' | 'nice' | 'great' | 'excellent', curve?: boolean }`. Sem `quality`, vale `'normal'` (compatível com o lançamento de hoje).
- **Multiplicadores em config** (`server/src/config/balls.ts` ou `battle.ts`), entrando na fórmula ao lado da bola e da berry: proposta inicial `normal ×1`, `nice ×1,15`, `great ×1,4`, `excellent ×1,8`, `curve ×1,3`. Revisar jogando.
- **Erro:** `POST /encounters/:id/miss` com `{ ball }`: só debita a bola, numa transação. **Não rola nada, não conta como lançamento e não muda a agitação nem a fuga** (como no GO, errar não faz ele fugir). Assim o `throwRngAt` e o `throw_count` continuam iguais: só os lançamentos que acertaram consomem rolagens.
- O servidor aceita a qualidade que o front manda (só valida os valores). É um jogo para uma pessoa e não há como conferir o gesto; fica registrado aqui como exceção consciente à seção 2. Se um dia houver ranking entre jogadores, rever.

**Refeito em 2026-10-29 (vale este bloco; o de 2026-10-28 abaixo fica como histórico).** O modelo de 10-28 media tudo em px fixos e desenhava uma Bézier até um ponto calculado: no PC parecia ok, no celular a força ideal e os desvios não batiam com a tela nem com o dedo, e a curva parecia artificial. Agora:
- **Física 3D simples, projetada na tela:** profundidade (0 na mão, 1 no Pokémon), lado e altura, com gravidade e perspectiva (o alvo parece `depthRatio` vezes menor). Sombra no chão sob a bola. Fraco quica antes ("Curto!"), forte passa por cima e some atrás ("Passou!"), torto erra de lado.
- **Tudo proporcional à tela:** a força é medida em **U** = distância vertical do ponto de soltar ao centro do alvo. O mesmo peteleco proporcional dá o mesmo resultado no celular e no PC (teste em `throwPhysics.test.ts`).
- **Velocidade do dedo:** reta de mínimos quadrados nos últimos 80 ms, com os eventos agrupados do navegador (`getCoalescedEvents`). Ignora o dedo parado ao levantar.
- **Sem ímã:** acerta quem cruza o plano do Pokémon dentro do círculo do alvo (raio = metade da altura do corpo), testado no alvo vivo (agitação incluída). Decidido em 2026-10-29.
- **Toque simples não lança** (a bola fica na mão). Teclado e movimento reduzido continuam com o lançamento garantido. Decidido em 2026-10-29.
- **Curva:** o giro empurra a bola para o lado durante o voo (aceleração constante): sai na direção do dedo e vai abrindo. Compensa jogando para o lado oposto.
- **Laboratório (dev):** na tela de captura, com `DEV_TOOLS`, o painel `ThrowLab` liga o treino (não gasta bola nem chama o servidor), mostra força/ângulo/resultado de cada arremesso e deixa ajustar os números ao vivo. Celular sem deploy: `npm run phone` em `web/` (túnel do cloudflared para o Vite de dev; entra pelo login de teste).
- Números (balanceados com 30 arremessos reais no celular, Android, U = 332 px): força ideal 3,2 U/s (a velocidade inteira do peteleco), resposta da força amaciada (expoente 0,65 em volta da ideal: peteleco rápido de polegar não dispara, o lento não morre, e o voo fica menos brusco), folga do lado fraco 18% (reto acerta de ~0,77× a ~1,68× da força do dedo), voo de 0,62 s, peso do ângulo 0,32 (sem giro acerta até ~±19°), alvo com raio de 0,6 × altura do corpo. Curva de 1,4 raio por volta (+15% por volta a mais), com o empurrão crescendo no voo (sai reta e quebra perto do Pokémon) e com a velocidade ao quadrado (Magnus): o lado em que a bola chega depende só da mira e do giro, a força decide só a altura. Com 2 voltas, acerta jogando de ~13° a ~42° para o lado oposto. Os 30 arremessos reais, que acertaram 8 na versão anterior, acertam 22 nesta.

**Feito em 2026-10-28.** A primeira versão seguiu os itens de gesto e voo acima (parábola com gravidade, giro em volta do centro da bola, velocidade média dos últimos 80 ms). Jogando, ficou quase impossível acertar e não dava para girar, então o modelo mudou na revisão do mesmo dia. **Vale o que está aqui** (números em `THROW_PHYSICS`, `web/src/lib/throwPhysics.ts`, comentados):
- **Força do gesto:** o trecho mais rápido para cima nos últimos 160 ms antes de soltar (o dedo desacelera antes de sair da tela). Mínimo de 420 px/s para lançar; abaixo disso a bola volta para a mão.
- **Ponto de chegada direto do gesto** (não de uma parábola): a força decide a altura (força ideal 1300 px/s, folga de ±45%; fora dela, 110 px por unidade de força a mais ou a menos), o lado vem da velocidade horizontal (×0,22 s) e, com giro, da curva (40 px por volta, até 3 voltas).
- **Auxílio de mira:** chegando a até 200 px do centro do alvo, a bola é puxada 80% do caminho até ele. Fica bem difícil errar (decidido: o jogador gosta assim); só muito forte (≈4×) ou muito torto erra. Bola fraca demais nem é lançada.
- **Voo:** um arco só (Bézier quadrática): sai na direção do gesto, sobe 60 px acima da chegada e desce nela; com giro, abre para o lado oposto e volta. Dura de 0,3 a 0,62 s, para a bola sair da mão na velocidade do dedo. A bola encolhe com a profundidade.
- **Giro:** soma de quanto a direção do dedo vira (um círculo em qualquer lugar da tela = uma volta). Tem inércia: parado, a bola segue girando e perde metade da velocidade a cada 0,9 s; desistiu do arremesso, ela termina de girar no botão. A curva (e as estrelinhas de "pronta") só vale com pelo menos 4 rad/s.
- **Estrelinhas:** com a bola pronta para a curva, cinco estrelinhas piscam em volta dela (não giram junto) e acompanham o voo.
- **Alvo:** o meio do corpo do selvagem (pela altura do palco), raio proporcional ao sprite. O selvagem agitado anda pelo mesmo `agitationOffset` que o acerto usa: o alvo que se vê é o alvo testado.
- **Anel:** ciclo de 1,2 s; faixas 0,28 / 0,55 / 1 do raio (Excellent / Great / Nice). Só aparece enquanto segura e no voo.
- **Toque simples, teclado e movimento reduzido:** sempre acertam, qualidade `normal`, sem curva (decidido em 2026-10-28: fica assim). Com movimento reduzido, nem há voo.
- **Cena da captura** (`BattleScene`, `skipThrow`): começa na batida da bola no selvagem, sem o próprio arco (seriam dois arremessos seguidos).
- **Textos:** "Nice!", "Great!", "Excellent!", "Curva!" (juntos num texto só) e "Errou!", em cima do alvo, no estilo do número de dano da luta.
- **Multiplicadores** no `battleConfig`: `normal ×1`, `nice ×1,15`, `great ×1,4`, `excellent ×1,8`, `curve ×1,3`. Com o auxílio a curva ficou fácil; decidido manter assim por enquanto.

**Anel colorido pela chance** — feito em 2026-10-28: como no GO, a cor do anel diz quão difícil está a captura com a bola e a berry (chance da UI, qualidade `normal`, sem curva). Faixas em `THROW_PHYSICS` / `ringColorFor`: **verde** `#3ecf5a` (≥60%), **amarelo** `#e8c547` (≥35%), **laranja** `#ef7a2e` (≥15%), **vermelho** `#e05a4a` (abaixo). Só visual.

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
  - **Evoluir:** uma opção por destino. Aparece habilitada a partir do nível mínimo e, antes disso, mostra "Evolui no Nv X". Ao evoluir, troca o sprite. **Pendente (anotado em 2026-10-28): animação de evolução** — hoje só há um "pop"/troca seca; falta uma cena própria (estilo clássico ou GO), respeitando `prefers-reduced-motion`;
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

#### Clima no jardim (futuro, anotado em 2026-10-29)
Vão existir **diferentes climas** no jardim (sol, chuva, nuvem, etc. — lista a fechar). Cada clima:
- muda o visual do gramado / céu;
- dá **bônus diferentes para Pokémon** (ex.: XP no jardim/daycare, humor, tipos favorecidos);
- dá **bônus diferentes para plantas** (ex.: crescimento mais rápido, yield, chance de semente).

Ainda sem fase nem schema. Quando entrar: estado de clima no servidor (timestamp / rotação), efeito em config por clima, e o jardim só espelha. Não confundir com o **clima no combate** (5.18), que é outra ideia.

### 5.12 Pokédex e guia do jogo (Fase 7)
A Pokédex não é só a lista de espécies vistas e capturadas. Ela também é a wiki do próprio jogo, e a informação de cada espécie vai sendo liberada conforme o jogador avança com ela. Feito em 2026-10-28 (Fase 7).

- **Informação por progresso.** O servidor corta as camadas; o cliente nunca recebe o que está bloqueado. Marcos em `config/pokedex.ts`:
  - nunca vista: só o número;
  - vista: nome e sprite;
  - capturada: tipos, linha evolutiva, habilidades da espécie;
  - `max_level_reached` ≥ 15: onde encontrar (região, faixa de nível, raridade em faixas);
  - `max_level_reached` ≥ 30: golpes que aprende (rápidos e carregados, com o nível) e atributos base.
- **`max_level_reached`** em `pokedex_entries`: o maior nível que o jogador já teve da espécie. Sobrevive a soltar. Atualizado ao capturar, subir de nível (luta, daycare, doces), evoluir; backfill na migração 0014. Troca entre jogadores ainda não existe (seção 1).
- **Onde encontrar** usa `snapshots/regions.json`. Raridade em faixas (comum / incomum / raro) pela fração do peso do slot no total da região — nunca o peso. Limites no config.
- **Guia do jogo** na mesma tela (sub-aba): texto estático do front (energia, encontros, luta, captura, doces, evolução, daycare, berries). Sem API.
- **Álbum por blocos.** Blocos derivados dos dados que já existem, com chave versionada (`…:v2`):
  - **Obtível:** aparece em `regions.json`, ou evolui (por nível/doce, sem troca) de uma espécie obtível — calculado dos dados, sem lista fixa.
  - cada região: espécies que podem sair nela (já obtíveis);
  - cada linha evolutiva em que **todas** as espécies são obtíveis;
  - Kanto e Johto: só as obtíveis da faixa (sem Mew, iniciais, lendários, fósseis, evoluções por troca…).
  - Completo = toda espécie do bloco com `caught_count > 0`.
  - Recompensas só com o que já existe: sementes (`inventory`), doces genéricos (`trainers.generic_candies`), energia (até o máximo, como a recompensa de nível). Valores no config.
  - Resgate em `pokedex_claims` (`user_id`, `block_key`, `claimed_at`), com `immediate()`. O cliente nunca informa que completou.
- **Resgate vale para sempre.** Se um bloco mudar de espécies, sobe `albumVersion` e a chave muda; resgates antigos (ex.: `…:v1`) ficam no banco e não se repetem.
- **Linha evolutiva na ficha:** membro nunca visto vai só com o número (sem nome); a tela mostra "???".
- **UI:** aba dentro da Coleção (`Meus Pokémon | Pokédex`), com sub-abas Lista · Álbum · Guia. Moldura estilo Pokédex só com cores/CSS (vermelho `#dc0a2d`, lente azul, luzinhas, tela verde-clara). Sem retratos nem arte nova. Mobile primeiro (seção 4.4); sprites da grade sob demanda.
- Ainda em aberto: se os outros jogadores veem a Pokédex de alguém na visita ao jardim (seção 1).

### 5.13 Batalha com mais vida (ideia, ainda sem fase)
> **As decisões desta seção viraram a 5.18 (Fase 8).** Continua valendo aqui o levantamento das animações do PMD e os fallbacks em CSS, usados na parte 8.3.
Anotado depois do teste da Fase 2. Hoje o encontro é seco: abre a rota, aparece o Pokémon, escolhe o time, sai o resultado. A escolha pesa pouco e a derrota não é sentida. O objetivo é um combate simplificado, na linha do Pokémon GO, e mais "juice" no caminho todo.

**Combate:**
- Turnos curtos com ataque rápido e ataque carregado. HP visível dos dois lados e troca de Pokémon do time quando um cai.
- Tipos contam. `type1` e `type2` já estão em `species`, e a tabela de efetividade pode ir para o config.
- Ataques: liga com a Pokédex (seção 5.12). Dá para tirar da PokéAPI no seed (moves por nível), limitando a 2 por Pokémon (1 rápido e 1 carregado).

**Restrição que não muda:** o resultado continua decidido no servidor, com a seed do encontro (seções 2 e 7). Ritmo de toque ou reflexo no cliente não pode decidir nada, porque o cliente pode mentir. Dois formatos compatíveis:
1. **Simulação com replay.** O servidor simula a luta inteira, turno a turno, e devolve o log. O cliente anima o log. Não há entrada durante a luta, e a escolha está antes: time, ordem e tipos.
2. **Decisões por turno.** O cliente manda só intenções ("usar o carregado", "trocar para o 2"). O servidor resolve cada turno e guarda o estado da batalha. É mais interativo, mas pede estado persistido de batalha em andamento, com expiração.

Sugestão: começar pelo formato 1. Ele já dá o "juice" e cabe no modelo atual (uma requisição por batalha). O formato 2 pode vir depois, se fizer falta.

**Decidido: lutar e capturar viram dois passos** (pedido do usuário, 2026-10-27). Nem toda luta precisa terminar em captura. Com as pokébolas craftadas (seções 5.6 e 5.16), gastar bola tem custo, e às vezes o jogador só quer o XP.
1. **Luta em turnos:** "eu bato, ele bate", até um lado cair. O servidor decide a luta inteira com a seed do encontro e devolve o log de turnos. O front anima o log (formato 1 acima). A vitória dá o XP como hoje.
2. **Depois de vencer, o jogador decide:** vê a **chance de captura** com cada bola que tem e escolhe **lançar** (qual bola) ou **deixar ir**. Só ao lançar a bola é gasta e a captura é rolada.

O que isso muda no modelo atual:
- **Encontro com estado intermediário:** depois da vitória, o encontro fica esperando a decisão (ex.: status `won`) até o jogador lançar, deixar ir ou o encontro expirar. Hoje a batalha já resolve a captura na mesma requisição. Mudar o `CHECK` de `status` no SQLite pede reconstruir a tabela (migração, testada num banco com dados).
- **Rotas:** `POST /encounters/:id/battle` só luta. Rotas novas: `POST /encounters/:id/throw` (`{ ball }`) e `POST /encounters/:id/release`, este último para deixar ir.
- **PRNG (seção 7):** a ordem continua fixa, mas a captura passa a ser rolada só quando o jogador lança. Com várias tentativas (uma por bola), cada uma é a próxima rolagem da sequência. A semente da batalha (seção 5.10) continua logo depois da vitória.
- **`winChance` e o log:** a luta em turnos pode continuar com a chance da seção 5.5 como base, decidindo quem vence e gerando um log coerente com isso, ou virar uma simulação de verdade com HP e dano. Decidir junto com os tipos e os ataques.
- **A cena da parte 6.2** passa a ser só a parte da captura. A luta ganha a sua própria animação, com os golpes do PMD e os fallbacks genéricos.
- **Até existirem pokébolas como item,** a Poké Ball é infinita, mas a escolha de lançar ou deixar ir já existe.

**Decidido: golpes e atributos individuais** (2026-10-27). O combate fica bem mais simples que o dos jogos principais, mas com algum nível de complexidade:
- **Dois golpes por Pokémon:** um **golpe rápido** (dano pequeno, carrega energia) e um **golpe carregado**, a "ult" (dano alto, gasta a energia acumulada). É a mesma ideia de ritmo dos jogos mobile: bater, carregar, soltar a ult.
- **IVs e EVs** por Pokémon, para dois do mesmo nível não serem iguais:
  - **IVs** sorteados na captura, com o PRNG do encontro (entram na ordem da seção 7, depois da captura). O inicial também ganha IVs;
  - **EVs** ganhos ao vencer batalhas, pelo `effort` que a PokéAPI informa por espécie (o "EV yield"), com teto por atributo e no total;
  - **atributos finais** (HP, Ataque, Defesa…) calculados de base + IV + EV + nível por uma fórmula no config, e usados no dano. Substituem o `power` atual (`BST × (1 + nível/10)`) na luta.
- **Tipos contam:** tabela de efetividade e bônus de mesmo tipo (STAB) no config.

Pontos a decidir antes de especificar:
- **De onde vêm os golpes.** A PokéAPI tem os golpes que cada espécie aprende e o poder e o tipo de cada um, mas não tem os números de golpe rápido e carregado (energia, duração). Caminhos: uma tabela própria de golpes no config, com um golpe padrão por tipo para cobrir as 251 espécies rápido, mais ajustes por espécie onde fizer diferença; ou montar a partir da PokéAPI com regras (ex.: golpe físico fraco vira rápido, especial forte vira carregado). Os números são nossos, não copiados de outro jogo.
- **Os golpes são fixos por espécie ou variam por Pokémon** (sorteados na captura, trocáveis com algum item ou doce).
- ~~**Faixa dos IVs** e natures~~: decidido na seção 5.18 (IVs de 0 a 31, com nature).
- **Pokémon que já existem** quando os IVs entrarem: sortear IVs na migração ou usar um valor médio fixo.
- **A luta:** simulação de verdade turno a turno (HP, dano, energia, quando soltar a ult) no lugar da `winChance`, ou a `winChance` decide e a simulação só gera um log coerente. Com IVs, EVs e tipos, a simulação de verdade faz mais sentido. O balanceamento vai precisar de testes.
- **Mostrar ao jogador:** uma avaliação dos IVs no sheet (ex.: estrelas), os dois golpes e a efetividade contra o selvagem antes de lutar.
- **Escopo:** é um bloco grande (dados de golpes, migração de IVs e EVs, simulação, animação). Vale dividir em partes como a Fase 6.

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

**Crafting com Pokémon trabalhando (ideia, junto desta seção):** um sistema de receitas com **árvore de ingredientes**, em que Pokémon trabalham nas estações para produzir. A referência de gênero é Pokémon trabalhando numa base (Palworld, Pokopia), com regras próprias.
- **Receitas em config:** entradas (itens e quantidades), saída, tempo, estação e requisito de trabalhador (tipo, espécie e, depois, habilidade). Receita nova entra só no config.
- **Árvore:** os ingredientes básicos vêm do que já existe (berries, sementes, doces genéricos, drops de batalha). Os intermediários são feitos em estações e viram entrada de outras receitas, até chegar nos itens finais: itens de evolução (pedras), itens de bioma, peças de máquina, pokébolas (seção 5.6), TMs (5.18) e roupas do avatar (5.17). Cada item final tem pelo menos um caminho de craft além dos outros jeitos de conseguir.
- **Trabalhadores:** o mesmo modelo dos operadores de máquina. O Pokémon fica alocado, sai do jardim e não batalha, e o jardim nunca fica vazio. O nível ou a espécie certa podem acelerar ou render mais.
- **Produção por horário, sem loop no servidor** (seção 2): cada trabalho guarda início e fim (`ready_at`), e o servidor entrega ao coletar. Uma fila por estação é possível, sempre calculada sob demanda.
- **Debitar as entradas ao iniciar**, numa transação. Cancelar devolve todas as entradas, ou só parte delas (decidir).
- Pede tabelas novas (ex.: `craft_jobs`: estação, receita, trabalhador, `started_at`, `ready_at`) e migração. Os itens continuam no `inventory`.
- Liga com o aviso de "pronto" da Fase 6.1 (trabalho pronto entra na mesma lista).

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
- **Decidido: CC-BY-SA aceita só no avatar** (para poder usar a base LPC). Regras:
  - arte CC-BY-SA numa pasta própria (ex.: `web/public/sprites/avatar/lpc/`) com arquivo de créditos próprio, como o `CREDITS-PMD.md`, listando autor, licença e link de cada peça e dizendo quando foi modificada;
  - de peças com licença dupla CC-BY-SA ou GPL, usar sempre a CC-BY-SA;
  - **peça derivada de uma peça LPC** (editada, recolorida, com pixels copiados) sai como CC-BY-SA;
  - **peça própria desenhada do zero** (ex.: um boné exclusivo) fica com a licença do usuário, mesmo encaixando na base LPC. **Decidido: as peças próprias são CC0** (uso livre, sem precisar de crédito). Mesmo assim, o `CREDITS.md` lista quais são, para ficar claro que não vieram do LPC. Para isso: desenhar numa camada própria, usar a base só como referência de tamanho e posição, sem copiar pixels dela, e exportar só a própria camada. Guardar numa pasta separada (ex.: `web/public/sprites/avatar/custom/`) com a licença indicada. O histórico do git serve de registro;
  - no jogo, as camadas ficam em arquivos separados e são sobrepostas na hora. Nunca publicar uma imagem única que funda peças CC-BY-SA com arte CC BY-NC (PMD) ou com peças próprias de outra licença;
  - o código do jogo não é afetado: carregar e desenhar a imagem não torna o código derivado.
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

### 5.18 Combate em tempo real (rework, Fase 8)
Decidido em 2026-10-27. Substitui a batalha automática da seção 5.5 (`power`, `teamPower`, `winChance`) e fecha a maior parte das ideias da 5.13. A captura da 5.6 continua, mas vira um passo separado depois da luta.

**Atributos (como nos jogos principais)**
- **6 atributos:** HP, Ataque, Defesa, Ataque Especial, Defesa Especial e Velocidade. Base por espécie da PokéAPI (já em `species`).
- **IVs:** 0 a 31 por atributo, sorteados na captura. Na ficha aparecem como avaliação (estrelas ou %), não como número cru.
- **EVs:** começam em 0. Cada vitória dá a cada lutador o EV yield do selvagem derrotado (`effort` na PokéAPI). Teto de 252 por atributo e 510 no total.
- **Nature:** uma das 25, sorteada na captura, sem restrição por espécie. Cada uma dá ×1,1 em um atributo e ×0,9 em outro (nunca no HP); 5 são neutras.
- **Fórmulas** (nível L, base B):
  - HP = ⌊(2B + IV + ⌊EV/4⌋) · L/100⌋ + L + 10
  - demais = ⌊(⌊(2B + IV + ⌊EV/4⌋) · L/100⌋ + 5) · nature⌋
- **Velocidade** encurta o cooldown dos golpes (abaixo). É a função que ela ganha aqui, e que o Pokémon GO não tem.

**Habilidade**
- Sorteada na captura entre as habilidades normais da espécie, com chance pequena (config, inicial 5%) de sair a oculta. São 132 habilidades nas 251 espécies.
- Guardada pela **posição** (1ª, 2ª ou oculta), não pelo nome, como nos jogos principais: ao evoluir, o Pokémon fica com a habilidade da mesma posição na espécie nova. Se a espécie nova não tem 2ª habilidade, vale a 1ª.

**Evolução:** IVs, EVs, nature e a posição da habilidade não mudam (como nos jogos principais e no GO). Os atributos finais mudam porque a base da espécie muda. **Os golpes são sorteados de novo** pelo conjunto da espécie nova até o nível atual, pelas mesmas regras da captura, como no Pokémon GO (decidido em 2026-10-28). A ficha avisa antes de confirmar a evolução.
- No combate entra só um **conjunto escolhido**, que cabe na simulação: entrada (Intimidate), reforço com pouca vida (Blaze, Torrent, Overgrow, Swarm), imunidade (Levitate, Flash Fire, Water Absorb, Volt Absorb), sobrevivência (Sturdy) e multiplicadores (Thick Fat, Hustle, Huge Power, Sniper e afins). A lista fica no config.
- As demais aparecem na ficha como "sem efeito em combate por enquanto". As ligadas a status ganham efeito na 8.6, e as de clima quando ele entrar.

**Golpes (modelo do Pokémon GO: um golpe rápido e um golpe carregado)**
- Nomes: **golpe rápido** e **golpe carregado** são os slots. "Físico" e "especial" ficam só para a classe do golpe (qual atributo ele usa).
- **Vale para todas as gerações.** O jogo vai ter todos os Pokémon, não só a Gen 1–2: nenhuma regra pode depender de uma lista fixa de jogos ou de espécies.
- **Pool da espécie:** os golpes **de dano** que ela aprende **por nível** nos jogos da **geração em que ela estreou e da seguinte** (lista de jogos por geração no config). Para a Gen 1 isso dá Red/Blue/Yellow + Gold/Silver/Crystal: 121 golpes de dano distintos na faixa atual. Fica de fora todo golpe sem `power` nos dados da PokéAPI, ou seja, os de status (Growl, Leer) e os de dano fixo (Dragon Rage, Seismic Toss).
- **Pool da linha evolutiva** (decidido em 2026-10-28): o sorteio usa os golpes da espécie **e das pré-evoluções**. Cada golpe vale a partir do menor nível em que alguém da linha o aprende, e o nível do Pokémon continua limitando o sorteio (um Pokémon de nível baixo não recebe golpe de nível alto). Sem isso, 37 das 122 evoluções da Gen 1–2 tinham uma faixa de nível em que evoluir tirava o carregado, e 4 espécies (Ninetales, Wigglytuff, Clefairy, Politoed) nunca teriam carregado. Com o pool da linha, nenhuma evolução tira o carregado (teste em `seed/traitsData.test.ts`).
  - Diferença do Pokémon GO: lá o golpe não depende do nível, e cada espécie tem uma lista fixa montada à mão, sempre com pelo menos um rápido e um carregado. Aqui o pool sai dos dados dos jogos principais (vale para todas as gerações sem lista fixa), e o nível dá o limite que o GO não tem.
- **Golpe rápido:** poder até 55 (50 golpes na faixa). Cooldown curto e **gera energia**.
- **Golpe carregado:** poder acima de 55 (71 golpes). **Gasta energia**: o custo sobe com o poder, em 3 faixas (1, 2 ou 3 barras, como no GO).
- Também fica de fora todo golpe cujo efeito desmaia quem usa (Self-Destruct, Explosion), pelo efeito nos dados da PokéAPI, não por lista de nomes.
- Os poderes são os **atuais** da PokéAPI (uma regra só para todas as gerações). Isso gera casos como o Leech Life com poder 80, que era 20 na Gen 1.
- **Sorteio na captura:** 1 golpe rápido e, **se houver**, 1 carregado entre os que a espécie aprende **até o nível dela**.
  - Sem rápido até o nível: usa o primeiro rápido que a espécie aprende, ou Tackle. Todo Pokémon tem um golpe rápido.
  - **Sem carregado até o nível: o slot fica vazio** e o Pokémon luta só com o rápido até aprender um (decidido em 2026-10-27, no lugar de um "especial padrão do tipo"). Medido nos dados: primeiro carregado no Nv 13 para o Rattata, 18 para o Squirtle, 20 para o Pikachu, 28 para o Pidgey, 30 para o Charmander e 46 para o Bulbasaur (Solar Beam). A mediana nas 251 é o Nv 25, e 25 espécies (Magikarp, Abra, Ditto…) nunca aprendem. O limite de poder do golpe rápido (55) é o ajuste, se alguma linha ficar fraca demais.
- **Os golpes não se escolhem nem se trocam** (decidido em 2026-10-28, no lugar das ofertas de troca). O sorteio dá valor ao indivíduo: o mesmo Pokémon com o golpe bom vale mais, como no Pokémon GO.
  - **Ao subir de nível** o golpe rápido não muda. Se o slot de carregado estiver vazio, entra **um carregado sorteado** entre os que a espécie conhece até o nível novo. Sem ofertas.
  - **Ao evoluir**, os dois golpes são sorteados de novo (acima).
  - A troca livre na ficha existe só em teste (`DEV_TOOLS`).
  - **Futuro: TMs** (anotado em 2026-10-28). Item que sorteia de novo o golpe rápido ou o carregado, sem escolher qual vem, como no Pokémon GO. Entra quando os itens do jogo forem mapeados, provavelmente pelo crafting (seção 5.16). Um TM raro que deixa escolher (como o Elite TM) fica em aberto.
- **Cooldown:** cada golpe tem uma duração base (config, pela faixa de poder), multiplicada por um fator da Velocidade do Pokémon (config, entre ~0,8× para os muito rápidos e ~1,2× para os muito lentos). Nenhum golpe é usado sem limite, nem o rápido.
  - O fator compara a Velocidade do Pokémon com a de um Pokémon **médio do mesmo nível** (base 80, IV 15, sem EV, nature neutra), e não com o número cru: a Velocidade absoluta cresce com o nível, e sem normalizar todo Pokémon de nível alto viraria "rápido". Assim um Rattata é rápido em qualquer nível, um Snorlax é lento em qualquer nível, e IV, nature e EV mexem dentro disso.
  - Faixas no nível 50, só com o que é sorteado na captura (EV 0): Snorlax (base 30) de 31 a 55; Rattata (base 72) de 69 a 101; Pikachu (base 90) de 85 a 118.
- **Os números** (duração, energia gerada e gasta, poder efetivo) são nossos, em config, e não copiados do GO.

**Dano (fórmula dos jogos principais)**
- dano = (⌊2L/5 + 2⌋ · Poder · A/D) / 50 + 2, × STAB (×1,5 se o golpe é do tipo do Pokémon), × efetividade de tipo (×0, ×0,5, ×2, ×4), × fator aleatório de 0,85 a 1.
- Golpe **físico** usa Ataque contra Defesa; **especial** (a classe do golpe, não o slot de carregado) usa Ataque Especial contra Defesa Especial. A classe vem da PokéAPI (`damage_class`).
- Tabela de tipos atual, com os **18 tipos** (inclui Fairy), no config. A PokéAPI já dá os tipos atuais até para a Gen 1 (Clefairy e Jigglypuff são Fairy).

**O loop (tempo real, estilo Pokémon GO)**
- O jogador toca no golpe rápido e, com energia, no carregado. O selvagem ataca sozinho: rápido sempre que o cooldown libera, carregado quando tiver energia, com pequenas variações sorteadas pela seed.
- Time de 1 a 3: um luta por vez; quando cai, entra o próximo. Troca manual com cooldown (config).
- **Tempo limite** (config, inicial 60 s): passou, é derrota.
- Derrota: o encontro acaba, sem penalidade (como hoje). Vitória: XP como hoje (seção 5.8) e EVs.

**Quem decide (regra das seções 2 e 7 mantida)**
- **Simulação compartilhada:** um módulo TypeScript puro, determinístico pela seed do encontro, usado igual no front e no servidor.
- O front roda a luta ao vivo, com resposta imediata ao toque. No fim, manda **só a lista de toques** (`{ instante, ação }`). O servidor **refaz a luta inteira** aplicando cooldowns, energia e regras, e **o resultado dele é o que vale**.
- O servidor registra o início da luta e recusa uma lista de toques que termine antes do tempo real possível. O máximo que alguém consegue trapaceando é "jogar perfeito", nunca tocar mais rápido que o cooldown ou causar dano que não existe.

**Modo automático (para jogar idle)**
- **Batalha automática:** a luta **acontece na tela do mesmo jeito**; a única diferença é que o jogador não toca: o jogador automático do módulo de simulação toca por ele, ao vivo (rápido sempre que libera, carregado quando a energia enche, troca quando o ativo cai). Manual e automática usam as mesmas rotas (`battle/start` e `battle/finish`) e a mesma validação do servidor (decidido em 2026-10-27). É um interruptor "Auto" na própria tela de luta.
  - **Tempo de reação:** depois que o cooldown libera, o automático espera um atraso pequeno e aleatório antes de tocar (config, inicial 150–450 ms), de uma sequência com seed derivada da seed da luta, para dar o mesmo resultado no celular e no servidor. Junto com a falta de esperteza, isso faz lutar na mão render mais nas lutas importantes.
- **Depois de vencer, o jogador sempre decide** (lançar ou deixar ir), mesmo no Auto. A ideia de "capturar sempre" ou "deixar ir sempre" foi descartada em 2026-10-27: a decisão da captura é parte boa do jogo.
- O interruptor "Auto" fica no servidor, como preferência do treinador (vale em qualquer aparelho), e é marcado na tela de exploração.
- O automático joga direito, mas sem esperteza (não segura o carregado, não escolhe a hora de trocar). Lutar na mão continua podendo render mais.

**Captura depois da vitória**
- O encontro vencido **continua `pending`** e ganha `won_at` (coluna nova): "venceu, esperando a decisão". Sem status novo e sem refazer a tabela (ver o aviso na seção 4.6). A regra de um encontro aberto por jogador continua valendo, porque o índice já é sobre `pending`. Ao vencer, o prazo do encontro vira pelo menos o prazo da decisão (config).
- Desfechos com os status que já existem: capturou → `caught`; errou e ele fugiu, deixou ir, ou o prazo da decisão acabou → `escaped` ("venceu, mas não ficou com ele").
- O jogador lança a bola: a chance é a `catchChance` da seção 5.6. Errou: o selvagem pode fugir (config, chance por erro). Dá para lançar de novo até capturar, ele fugir, o jogador deixar ir ou o encontro expirar. A Poké Ball é infinita até as pokébolas virarem item.

**Status e efeitos dos golpes (parte 8.6, decidido em 2026-10-27)**
- **Condições de status**, uma por vez por Pokémon, como nos jogos principais. Durações e intensidades em milissegundos e frações inteiras, no config:
  - **Queimadura:** perde vida a cada segundo e o Ataque físico cai.
  - **Veneno:** perde vida a cada segundo.
  - **Paralisia:** o tempo de espera entre os golpes aumenta.
  - **Sono:** fica alguns segundos sem agir.
  - **Congelamento:** fica sem agir até descongelar (por tempo, ou na hora se levar um golpe de fogo).
  - **Confusão:** chance de bater em si mesmo ao agir. Some depois de alguns segundos e pode somar com as outras, como nos jogos.
- **Imunidade por tipo**, como nos jogos: Fogo não queima, Elétrico não paralisa, Venenoso e Aço não envenenam, Gelo não congela.
- **Efeitos secundários** dos golpes de dano, com os dados da PokéAPI (`meta`): status e a chance dele, mudanças de atributo (como os buffs do GO, com tetos), dreno (Absorb, Giga Drain) e recuo (Take Down, Double-Edge). O snapshot `moves.json` passa a guardar esses campos.
- **Rápido x carregado:** no golpe carregado o efeito usa a chance cheia do jogo. No rápido, a chance é dividida (config, inicial ÷3), porque ele acerta a cada segundo. **Sono, congelamento e confusão só saem do golpe carregado:** no rápido, mesmo com chance baixa, eles travariam a luta. A lista de status permitidos no rápido fica no config.
- **Golpes só de status** (Thunder Wave, Sleep Powder, Toxic) continuam fora do pool por enquanto. Pedem um balanceamento à parte como golpe carregado.
- **Habilidades ligadas a status** entram no conjunto escolhido: Static, Poison Point, Flame Body, Effect Spore, Synchronize, Guts, Immunity, Limber, Insomnia, Vital Spirit, Water Veil, Magma Armor, Own Tempo, Natural Cure, Shed Skin, Early Bird, Marvel Scale, Shield Dust, Serene Grace e Rock Head. As de contato (Static, Poison Point, Flame Body, Effect Spore) usam a classe física do golpe como contato, porque a PokéAPI não traz esse dado.
- **Só durante a luta:** todos saem curados no fim. Pokémon que ficam machucados depois da luta (com cura no jardim, itens ou centro) é ideia para o futuro.
- Tudo dentro da simulação compartilhada, com as regras de sempre (seed da luta, só `+ − × ÷` e `floor`/`min`/`max`, tempo em ms inteiros). O servidor continua refazendo a luta igual.
- **Na tela:** selo do status ao lado da barra de vida (QMD, ENV, PAR, DRM, CGL, CNF) e o dano por tempo como número. O visual de cada status (chama, bolhas, faíscas) vem na parte 2 do juice.
- **Golpe crítico** (entra junto): rolagem em todo golpe de dano, rápido ou carregado, sem dividir a chance (só aumenta o dano, não trava a luta). Chance inicial 1/24, e 1/8 nos golpes de crítico alto (`meta.crit_rate` da PokéAPI, como Slash e Razor Leaf). Dano ×1,5, ignorando os estágios que atrapalham o atacante, como nos jogos principais. Super Luck aumenta a chance, Sniper leva o crítico a ×2,25, Battle Armor e Shell Armor são imunes. Na tela, "Crítico!" junto ao número.
- Clima e as habilidades que dependem dele (Swift Swim, Chlorophyll, Drizzle) ficam para depois.

**PRNG (seção 7)**
- A luta tem um número variável de rolagens, então cada parte usa a sua sequência, derivada da seed do encontro: **luta**, **lançamentos** e **traços do capturado** (6 IVs, nature, habilidade e 2 golpes). Assim o replay de cada parte continua simples.
- **Seed secreta** (2026-10-28): o front recebe a seed da luta, e as derivações são XOR, então dá para chegar na `rng_seed` a partir dela. Por isso **lançamentos e semente da vitória** usam uma segunda seed, `encounters.secret_seed`, sorteada na criação do encontro e nunca enviada ao front. Sem ela, quem trapaceasse saberia antes qual lançamento captura (e, com pokébolas finitas, qual a bola mais barata que basta). Traços do selvagem continuam na `rng_seed`, porque a luta precisa deles e eles já aparecem na tela. Encontros anteriores à coluna seguem com a `rng_seed`.

**Pokémon que já existem (inclusive o save em produção, seção 4.6)**
- A migração sorteia IVs, nature, habilidade e golpes para cada Pokémon, com um PRNG derivado do `id` dele (determinístico e testável), pelas mesmas regras da captura e pelo nível atual. EVs começam em 0. Nada se perde: nível, XP, shiny, apelido e favorito ficam como estão.

**Breed (futuro):** o filhote herda 3 dos 6 IVs dos pais (5 com Destiny Knot), a nature passa com Everstone, e os EVs não passam (são treino). Por isso os IVs ficam guardados por atributo desde já.

**Dados:** snapshots commitados, como o de espécies: golpes (`moves.json`: nome, tipo, poder, classe), pool por espécie (golpe e nível em que aprende) e habilidades por espécie (normais e oculta). A fonte é a PokéAPI ou o espelho `PokeAPI/api-data` no GitHub, com o commit fixado.

**Na tela:** a ficha mostra IVs (avaliação), nature, habilidade, os dois golpes e os EVs. Antes de lutar, a efetividade dos seus golpes contra o selvagem.

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
// Encontros: os pendentes com expiresAt <= now viram 'fled' (antes da luta)
// ou 'escaped' (já vencidos, com won_at)
```

Retornar também `energyNextAt` para o frontend mostrar o contador regressivo.

---

## 7. RNG
- Usar um PRNG com seed no servidor (ex.: `mulberry32` ou `seedrandom`), com seed gerada por `crypto.getRandomValues` a cada encontro e **salva no registro do encontro**. Permite reproduzir e depurar resultados.
- Espécie, nível e shiny saem da sequência desse PRNG, nessa ordem. Desde a Fase 8, o resto usa sequências próprias, derivadas da seed do encontro (`server/src/game/sim/seeds.ts`): a luta, o tempo de reação do automático, os traços do selvagem (os mesmos na luta e na captura), os lançamentos (o 1º lançamento usa a 1ª rolagem, e assim por diante) e a semente que cai na vitória (seção 5.10).

---

## 8. API (rascunho)

Todas as rotas exigem sessão, exceto auth. Todas aplicam catch-up antes.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/auth/google` → `/auth/google/callback` | Login pelo Google (seção 4.7) |
| GET / POST | `/auth/signup` | Conta nova depois do Google: `{ username, starter }` cria usuário + treinador + itens iniciais + Pokémon inicial |
| POST | `/auth/logout` | Encerra a sessão |
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
Na primeira entrada pelo Google: escolher o nome de treinador e 1 inicial entre Bulbasaur, Charmander e Squirtle, nível 5. Inventário inicial: 3 sementes de Oran, 1 de Pinap. Energia cheia.

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
- **A resposta da batalha chega inteira antes da cena.** A animação só encena um resultado já decidido. Nada de nova requisição nem rolagem no meio.
- **Sequência da cena** (curta, no máximo ~3 s, e um toque pula para o fim):
  1. **choque:** o selvagem e o time se aproximam, e o lado que perdeu treme (fallback de dano da seção 5.13);
  2. **derrota:** o selvagem fica, o time recua, e mostra "Derrota". Sem pokébola;
  3. **vitória:** a pokébola é lançada e o selvagem some nela;
  4. **chacoalhadas**, só para a cena: capturou → 3 e um "clique" com comemoração (brilho e confete em CSS); escapou → 1 ou 2, mais quando a `catchChance` era alta (`1 + (catchChance >= 0,5 ? 1 : 0)`), e o selvagem sai da bola.
- **Sprite da pokébola:** `items/poke-ball.png` do `PokeAPI/sprites`, baixado pelo mesmo script dos ícones das berries, com o mesmo status, creditado no `CREDITS.md`. Escala inteira com `image-rendering: pixelated`.
- **Destaques depois da cena**, como cartões curtos em sequência, e não texto solto no meio:
  - XP de cada lutador e "subiu para Nv X";
  - **"pode evoluir"** quando um lutador passou do `minLevel` de alguma evolução (o front já tem `evolutions` no estado);
  - nível de treinador;
  - **região nova liberada**: as regiões com `minTrainerLevel` entre o nível antigo e o novo;
  - semente ganha e recompensas de nível.
- **Os mesmos destaques em outras ações:** evoluir (hoje só "pop"; **precisa de animação de evolução** — ver 5.8), alimentar com level up e retirar do daycare com níveis ganhos. Um componente só para os destaques, usado por todas essas telas.
- `prefers-reduced-motion`: sem a cena, direto aos destaques, que também aparecem sem animação.
- Sem mudança no servidor. Se faltar algum dado na resposta para os destaques, acrescentar na resposta, sem mudar regra.

*6.3 — Sons*
- **Gritos dos Pokémon:** versão `latest` do repositório `PokeAPI/cries`, o mesmo que a PokéAPI aponta (`cries/pokemon/latest/<id>.ogg`).
  - Por que `latest` e não `legacy`: o `legacy` só existe do #1 ao #649 (Gen 1–5, conferido em 2026-10-27). Misturar os dois estilos quando entrarem gerações novas soaria desigual; o `latest` cobre do #1 ao #1025.
  - `npm run sounds:cries` baixa do commit fixado em `server/src/config/cries.ts` e converte para `web/public/sounds/cries/<id>.mp3` (2,9 MB para os 251).
  - Tocados sob demanda: cada grito só é buscado na primeira vez que toca. Não entram na tela de abertura.
  - Onde: o selvagem aparece no encontro; o capturado sai da bola na cena da 6.2; tocar num Pokémon no jardim (o mesmo toque que abre a ficha).
  - Licença: o repositório não declara; o áudio é da Nintendo / Game Freak. Mesmo status dos GIFs do Showdown e dos ícones das berries, e entra no `CREDITS.md` do mesmo jeito.
- **Efeitos:** pacote CC0 Interface Sounds, do Kenney, no mesmo espírito das molduras de UI. (O RPG Audio foi testado e saiu: porta, pano e clique de metal soavam como objetos, não como o jogo.) Momentos: botão principal, colher, soltar, chacoalhada da Poké Ball, clique da captura, fuga do selvagem e level up. O arquivo de origem de cada um fica em `server/src/config/sfx.ts`; `npm run sounds:sfx -- <pastas dos pacotes>` gera `web/public/sounds/sfx/<uso>.mp3`. Para trocar um som, troque o arquivo no config e rode de novo.
- **Formato MP3** para tudo: o Safari de iPhones mais antigos não toca Ogg. A conversão usa o `ffmpeg-static`, só no desenvolvimento; a VM recebe os MP3 prontos.
- **Web Audio** (`web/src/lib/sound.ts`): um único `AudioContext` liberado no primeiro toque. Com `new Audio()`, o Safari bloqueia som fora de um toque, como o grito quando o encontro volta do servidor, as chacoalhadas por timer e o level up nos destaques.
- **Mudo:** botão no HUD, lembrado no `localStorage`. Volume baixo por padrão: é um jogo idle, aberto em qualquer lugar.
- **Celular:** o navegador só libera áudio depois do primeiro toque. O jogo não tenta tocar antes disso, e o primeiro toque destrava sem som.
- Sem mudança no servidor.

*6.4 — Instalar na tela inicial (PWA)*
- **Manifest** (`web/public/manifest.webmanifest`): nome "Pocket Meadow", nome curto, `display: standalone`, `orientation: portrait`, `start_url` e `scope` em `/`, `theme_color` e `background_color` da paleta (`--sky`, `--grass-side`), e os ícones.
- **Ícone:** o `favicon.svg` atual ainda é o logo padrão do Vite. Trocar por um ícone **original e provisório**, em pixel art simples (folha ou gramado, com as cores do jogo), feito como SVG no próprio repo e convertido em PNG por um script de desenvolvimento: 192, 512 e 512 *maskable* (com margem segura), mais `apple-touch-icon` 180. CC0 e listado no `CREDITS.md`. O usuário troca pela arte dele depois, mudando só o SVG de origem e rodando o script.
- **`index.html`:** `<link rel="manifest">`, `theme-color`, `apple-touch-icon` e as metas do iOS (`apple-mobile-web-app-capable`, título e barra de status). O `viewport-fit=cover` e a safe-area já existem.
- **Service worker** (`web/public/sw.js`, sem biblioteca nova), registrado só no build de produção (no `npm run dev` não):
  - `/api/*` **nunca** passa pelo cache: o estado vem sempre do servidor (seção 2);
  - `/assets/*` (com hash): cache primeiro;
  - `/sprites/*`, `/sounds/*`, `/ui/*`: cache primeiro com atualização em segundo plano, **sob demanda** (nada de baixar tudo na instalação: são dezenas de MB) e com teto de entradas, apagando as mais antigas;
  - navegação (`index.html`): rede primeiro, cache se estiver sem conexão. Sem conexão e sem cache, uma página simples "sem conexão" no estilo do jogo.
- **Versão nova:** o service worker novo espera. O jogo mostra "Versão nova disponível · Atualizar", e o toque troca e recarrega. Nunca recarregar no meio de uma luta (o estado da luta já é salvo em `battlePersist`, mas a troca espera a luta acabar).
- **Caddy:** `/sw.js` e `/manifest.webmanifest` sem cache longo (o bloco `@page` já dá `no-cache` a quem não é `/assets`, `/sprites`, `/sounds` ou `/ui`; conferir).
- **Login no app instalado:** testar o login pelo Google com o app instalado no Android e no iPhone. No iOS, o app instalado e o Safari não dividem cookies, e o redirecionamento do OAuth pode voltar no Safari em vez do app. Se acontecer, registrar e decidir à parte (não bloqueia a 6.4).
- Pronto quando: o Chrome do Android oferece "Instalar", o iPhone adiciona pela tela de compartilhar com o ícone certo, o app abre em tela cheia sem barra do navegador, um deploy novo aparece com o aviso de atualizar, a API nunca vem do cache, e sem rede o app abre e mostra "sem conexão" em vez de erro do navegador.

*6.5 — Revisão mobile e estados* — feito em 2026-10-28
- **Como ficou:** a `api()` corta a requisição em 15 s (`REQUEST_TIMEOUT_MS`) e marca a conexão (`web/src/lib/connection.svelte.ts`): falha de rede, tempo estourado ou 502–504 acendem o aviso "Sem conexão · tentando de novo" no topo, e qualquer resposta apaga. Offline, o App tenta o `/state` a cada 5 s e no evento `online`. O botão tocado antes da requisição fica `aria-busy` sozinho (`web/src/lib/busy.ts`), sem marcar botão por botão. A Exploração busca o mapa de novo quando a rede volta.
- **Revisão em 360×640 e 412×915** (Playwright, telas: login, jardim, coleção, ficha nas três abas, daycare, mochila, exploração, encontro, luta, captura, destaques, Pokédex): sem rolagem horizontal; alvos abaixo de 44px corrigidos (zoom do jardim, abas, filtros, regiões e resgate da Pokédex); nome do inicial cortado no cadastro corrigido. Os canteiros no zoom mínimo têm 48×24 (é o losango do chão; o zoom aumenta).
- **Teclado do celular:** conferido num aparelho de verdade; não cobre os campos de apelido nem de nome.
- Passar todas as telas em 360px e num celular de verdade (seção 4.4). Telas: abertura e login, cadastro (nome e inicial), jardim (com zoom e pan), canteiro, ficha (as três abas), coleção (com seleção múltipla), daycare, mochila, exploração, encontro, luta ao vivo, captura e destaques.
- Em cada tela, conferir: sem rolagem horizontal; nada escondido atrás do HUD, do dock ou da barra de gestos (safe-area); alvos de 44px ou mais; texto de 16px ou mais em campos; nada que dependa de hover; retrato em 360×640 e 412×915; teclado do celular não cobrindo o campo de apelido nem o de nome.
- **Estados em todas as ações:** carregando (o botão que disparou fica `aria-busy`, como já existe no CSS), erro com a mensagem do `errorText` (nenhum erro "engolido") e sem conexão.
- **Sem conexão:** um aviso fixo e discreto no topo ("Sem conexão · tentando de novo") quando o `/state` ou uma ação falha por rede, que some sozinho quando volta. As ações não ficam presas em "carregando" para sempre: tempo limite na requisição (config, ex.: 15 s) e o botão volta com a mensagem.
- Nenhum botão fica "morto" sem explicação: botão desativado mostra o motivo (como já fazem soltar e daycare).
- Usar os módulos comuns (`serverClock`, `time`, `ready`, `api`) e não criar outro jeito de tratar erro por tela.
- Pronto quando: a lista de telas acima passou em 360px e num celular de verdade, desligar o Wi-Fi no meio de uma ação mostra o aviso e nada trava, e religar volta sozinho.
- ~~Ficha do Pokémon em abas~~ (feito em 2026-10-27): abas Perfil · Golpes · Treino, com topo e rodapé fixos, e barra de rolagem pixel no jogo todo.
- ~~Som~~ (feito em 2026-10-27): volume base pela metade, ícone de alto-falante no HUD com painel de volume e mudo, e som atrasado descartado.

**Fase 7 — Pokédex: guia e álbum** (seção 5.12) — feito em 2026-10-28
- ~~Vistos e capturados, informação liberada por progresso, onde encontrar, guia do jogo e álbum por blocos com recompensas.~~ Aba na Coleção; camadas no servidor; `max_level_reached` + `pokedex_claims`; recompensas de semente / doces genéricos / energia.

**Fase 8 — Combate em tempo real** (seção 5.18; em partes, cada uma testada antes da próxima)
- *8.1 — Traços dos Pokémon:* snapshots de golpes, pool por espécie e habilidades; colunas de IVs, EVs, nature, habilidade e golpes; sorteio na captura; migração dos que já existem (testada numa cópia do banco de produção, seção 4.6); ficha mostrando tudo. (A troca de golpe ao subir de nível saiu em 2026-10-28: golpes sorteados, seção 5.18.)
- *8.2 — Simulação compartilhada:* módulo puro com atributos, dano, tipos, cooldowns, energia, IA do selvagem, troca no time e habilidades do conjunto escolhido. Testes cobrindo determinismo (mesma seed e mesmos toques dão o mesmo resultado) e as regras (ninguém toca antes do cooldown). Rotas de início e de fim da luta, com o servidor refazendo a luta.
  - Para o jogo não ficar quebrado até a 8.3: o "Batalhar" atual passa a rodar a simulação com o jogador automático no servidor, no lugar de `power`/`winChance`. A cena da 6.2 continua mostrando o resultado, e a captura segue automática até a 8.4.
  - **Mesmo resultado em todo motor de JavaScript** (Safari no celular, Node no servidor): a simulação usa só `+ − × ÷` e `Math.floor`/`Math.min`/`Math.max`, nada de `Math.exp`, `Math.pow`, `Math.log` ou trigonometria, e o tempo é em milissegundos inteiros.
  - O módulo fica em `server/src/game/sim/`, sem importar nada do Node nem do banco; o front importa por alias do Vite. Um teste garante isso.
  - Fator de Velocidade: `1 + 0,4 × (média − velocidade) / média`, limitado a 0,8–1,2, onde a média é a Velocidade de um Pokémon base 80, IV 15, sem EV, nature neutra, no mesmo nível. No Nv 50, um Rattata mediano fica perto de 1,0 e um Snorlax bate no teto de 1,2.
  - EVs passam a valer aqui: cada lutador que entrou na luta ganha o EV yield do selvagem ao vencer, com os tetos da 5.18.
- *8.3 — Tela de combate:* botões de golpe rápido e carregado com cooldown e energia visíveis, barras de HP, número de dano, animações do PMD com os fallbacks em CSS (seção 5.13), sons, tempo limite e o interruptor "Auto" (a luta acontece igual, sem tocar). Funciona em 360px.
  - Cobertura do PMD nas 251 (medida em 2026-10-27): `Attack`, `Hurt`, `Charge` e `Swing` em todas; `Shoot` em 246; `Strike` em 193; **`Faint` só em 61**, então o desmaio usa o fallback em CSS na maioria.
- *8.4 — Captura em passos:* encontro vencido (`won_at`, sem status novo), lançar ou deixar ir, chance de fuga por erro. A cena da 6.2 vira só a parte do lançamento.
- *8.5 — Modo automático:* o interruptor "Auto" (que já existe na 8.3) vira preferência do treinador no servidor, com o interruptor também na tela de exploração. A captura continua sempre sendo decisão do jogador.
- Pronto quando: uma luta completa roda no celular sem travar, o resultado do servidor bate com o do front nos testes, e o save existente continua jogável depois da migração.
- *8.6 — Status e efeitos dos golpes:* condições de status, efeitos secundários, dreno, recuo e as habilidades ligadas a status, tudo na simulação compartilhada (ver "Status e efeitos dos golpes" na 5.18). Vem depois da parte 1 do juice e antes da parte 2.
- *Juice do combate (anotado em 2026-10-27, depois da 8.5). Parte 1: Poké Ball e impacto dos golpes. Parte 2: efeitos visuais por golpe e por status:*
  - **Efeitos por golpe:** pegar efeitos visuais (partículas, rajadas, folhas, chamas, raios…) e mapear para os golpes que os Pokémon podem ter. O mapa sai por tipo e categoria do golpe (físico ou especial, rápido ou carregado), com exceções por golpe quando valer a pena; golpe sem efeito usa o do tipo. Fica num lugar só, como o `gardenSprite`. Só assets com licença redistribuível (seção 4.3), creditados no `CREDITS.md`.
  - **Animações da luta mais vivas:** impacto com tremida de tela curta, flash no acerto, destaque no supereficaz e no crítico, e uma entrada mais marcada do golpe carregado.
  - **Pokébola mais bonita e mais dramática:** arco do lançamento, a bola abrindo e puxando o Pokémon num brilho, pausas maiores entre as chacoalhadas (a última mais demorada), e no fim estrelinhas na captura ou a bola estourando na fuga.
  - **Status sobre o sprite** (pedido em 2026-10-27, depois da 8.6): efeito visual em cima do Pokémon enquanto durar o status. Chama na queimadura, bolhas roxas no veneno, faíscas na paralisia, "Zzz" no sono, cristais de gelo no congelamento, estrelinhas girando na confusão.
  - **Cor do número de dano pela origem** (pedido em 2026-10-27): dá para saber de onde veio cada dano. Golpe normal em branco, crítico e super eficaz como hoje, queimadura em laranja, veneno em roxo, recuo em cinza, autoataque da confusão em rosa, e cura e dreno em verde. A cor de cada status é a mesma do selo na placa.
  - Tudo respeitando `prefers-reduced-motion` e leve no celular.
  - **Futuro: animação própria por golpe** (anotado em 2026-10-28). Hoje o efeito sai por tipo (PVFX Foundry, `web/src/lib/fx.ts`) e os golpes especiais soltam uma bola na cor do tipo. Nos jogos, cada golpe tem a sua (o Will-O-Wisp faz um arco antes de bater, por exemplo). O Pokémon Showdown faz isso com uma animação escrita à mão por golpe, montada com poucas peças: imagem que voa de um ponto a outro com curva, movimento do atacante e do alvo e flash no fundo. Dá para seguir o mesmo modelo com as nossas peças, começando pelos golpes mais usados. O código e as imagens do Showdown não podem ser usados (AGPL e imagens sem licença livre).
  - Do pacote, o Warm Explosion (Fogo) e o Ember Jet (pulso da queimadura) desenham só a metade da frente do anel no chão, que fica aberto quando a fumaça some. Se incomodar, a troca sugerida é Fogo → Solar Shrapnel e a queimadura numa chaminha em código.

**Fase 9 — Pokébolas** (seção 5.6, "Pokébolas") — feita em 2026-10-28 (9.1–9.4)
- ~~*9.1 — Bolas como item:* config das bolas, sprites, migração (`caught_ball`, `agitation` e estoque inicial), lançamento com `{ ball }`, escolha na tela, bola na cena e na ficha, recompensas, botão de teste.~~
- ~~*9.2 — Fuga crescente e berries na captura:* agitação, fuga por degrau, "Dar berry", Pinap só na captura (cargas antigas de `catch_boost` continuam até gastar).~~
- ~~*9.3 — Berries novas:* Golden Razz e Silver Pinap (só captura), plantio lento, pesos baixos na queda de sementes, recompensas de nível 15/20 e bloco de jogo completo do álbum; o botão de teste também dá sementes/berries delas.~~
- ~~*9.4 — Arremesso com física:* gesto segurar/girar/soltar; voo 2,5D; anel Nice/Great/Excellent; `POST /miss` gasta bola sem RNG; berry arremessada sem giro; a11y (toque simples / teclado / reduced-motion) sempre acerta `normal`.~~
- Decisões: `BerryDef.effect` opcional; bônus = `catch_boost` × berry × qualidade × curva; fuga com `fleeBase`/`fleeStep`/`fleeMax`; servidor confia na qualidade enviada (jogo solo). A física da 9.4 foi refeita na revisão (auxílio de mira, arco único, giro com inércia): ver "Feito em 2026-10-28" na seção 5.6.
- ~~*Anel colorido pela chance* (seção 5.6):~~ feito em 2026-10-28 (`ringColorFor`, cores `#3ecf5a` / `#e8c547` / `#ef7a2e` / `#e05a4a`).

**Depois (ideias anotadas, ainda sem fase):** **animação de evolução** (5.8 / coleção — anotado em 2026-10-28); breed com herança de IVs e nature (5.18); construção do jardim com biomas, máquinas e itens de evolução (5.16); **climas no jardim** com bônus para Pokémon e plantas (5.11 — anotado em 2026-10-29); campo de encontro (5.14); missões de NPC (5.15); cuidador do daycare (5.9); personagem e perfil de treinador (5.17); Pokémon machucados depois da luta, com cura no jardim, itens ou centro (5.18); clima no combate (5.18).

---

## 10. Questões em aberto
- ~~Mais de uma tentativa de captura por encontro (gastando algo)?~~ Decidido: dá para lançar de novo até capturar ou ele fugir (seção 5.18). Gastar bola fica para quando as pokébolas virarem item (5.6).
- ~~Pokémon com IVs/natures ou só nível?~~ Decidido: IVs, EVs e nature (seção 5.18).
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

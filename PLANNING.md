# Pocket Meadow — Planejamento do Projeto

> Projeto pessoal, sem fins comerciais. Fan project; Pokémon é marca da Nintendo / Game Freak / The Pokémon Company.
> Este documento descreve a visão, a arquitetura e as mecânicas. O modelo de dados está em `DATA_MODEL.md`.
> **Todas as fórmulas e números aqui são valores iniciais de balanceamento e devem morar em arquivos de config, não espalhados pelo código.**

---

## 1. Visão

Um jogo web idle/AFK com tema Pokémon. Não há batalhas manuais nem exploração. O jogador tem um **jardim** (um gramado simples) onde seus Pokémon ficam andando à toa. O progresso vem de:

1. **Encontros**: gastar energia para tentar a sorte em uma região e encontrar um Pokémon aleatório.
2. **Batalha automática**: se vencer, pode tentar capturar.
3. **Duplicatas viram recurso**: soltar Pokémon gera pontos (doces) da linha evolutiva, usados para upar e evoluir.
4. **Daycare**: Pokémon colocados lá ganham XP com o tempo, sem gastar doces.
5. **Berries**: plantadas no jardim, levam tempo real para crescer e dão bônus.

Loop principal: **encontro → captura → soltar duplicatas → time mais forte → regiões novas**.

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
│     └─ download-sprites.ts
├─ web/
│  ├─ public/sprites/showdown/{id}.gif
│  ├─ public/sprites/showdown/shiny/{id}.gif
│  └─ src/
└─ data/                    # volume do SQLite (fora do git)
```

A pasta `server/src/game/` deve conter **funções puras** (recebem estado + `now` + RNG, devolvem novo estado), para serem fáceis de testar.

---

## 4. Dados externos

### 4.1 Seed das espécies (script único)
`scripts/seed-species.ts` percorre a faixa de IDs configurada (começar com Gen 1–2, IDs 1–251; faixa em config) e salva:

- De `/pokemon/{id}`: `name`, base stats (hp, attack, defense, special-attack, special-defense, speed), `types`.
- De `/pokemon-species/{id}`: `capture_rate`, `is_legendary`, `is_mythical`, `evolution_chain.url` (extrair o ID), `evolves_from_species`.
- De `/evolution-chain/{id}`: pares de evolução (de → para) e `min_level` quando houver.

Evoluções por item, troca, amizade etc. são **simplificadas**: toda evolução vira "por nível + custo em doces". Se a PokéAPI não fornecer `min_level`, usar um valor padrão do config (ex.: estágio 1→2 no nível 16, 2→3 no nível 36).

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

- Pokémon: os GIFs do Showdown, acima.
- Cenário, ícones e props (grama, canteiro, berry, presente): pixel art gratuita, com licença que permita projeto pessoal não comercial. Escalar com `image-rendering: pixelated`.
- Painéis, botões e texto: HTML e CSS, no mesmo clima, sem imitar um jogo em canvas.

Pixel art feita à mão só entra quando não houver peça pronta que sirva. Não desenhar um set inteiro por conta própria.

O primeiro jardim testa um chão isométrico com esses Pokémon 2D por cima. Ver seção 5.11.

---

## 5. Mecânicas

### 5.1 Treinador
- Tem **nível de treinador** e **XP de treinador**.
- XP de treinador vem de: vencer batalhas, capturar, evoluir.
- O nível de treinador **desbloqueia regiões, slots de daycare e canteiros de berry**.

### 5.2 Energia
- Cada encontro custa 1 de energia.
- Regenera 1 a cada `ENERGY_REGEN_MS` (inicial: 15 min), até `ENERGY_MAX` (inicial: 10).
- Calculada por timestamp (ver seção 6).

### 5.3 Regiões e spawn
Definidas em config. Cada região tem:
- `slug`, `name`, `minTrainerLevel`
- `wildLevelRange` (ex.: 3–8)
- `spawns`: lista de `{ speciesId, weight }`

Sorteio por peso. Exemplo:

```ts
{
  slug: "route-1",
  name: "Rota 1",
  minTrainerLevel: 1,
  wildLevelRange: [2, 6],
  spawns: [
    { speciesId: 16, weight: 40 },  // Pidgey
    { speciesId: 19, weight: 40 },  // Rattata
    { speciesId: 25, weight: 5 },   // Pikachu
  ],
}
```

- **Shiny**: chance `SHINY_RATE` (inicial: 1/512), possivelmente aumentada por berry.

### 5.4 Encontro
1. Jogador escolhe uma região desbloqueada.
2. Servidor aplica catch-up, verifica energia, gasta 1 energia.
3. Sorteia espécie, nível e shiny. **Salva como encontro pendente.**
4. Jogador vê o Pokémon selvagem e pode:
   - **Batalhar** (escolhendo 1 Pokémon seu), ou
   - **Fugir** (encontro encerrado, energia não volta).
5. Só pode existir **um encontro pendente por jogador** por vez.
6. Encontros pendentes expiram após `ENCOUNTER_TTL_MS` (inicial: 30 min) e viram `fled`.

### 5.5 Batalha (automática e probabilística)
- O jogador escolhe 1 Pokémon do seu time para lutar.
- Poder de um Pokémon:
  ```
  power = baseStatTotal * (1 + level / 10)
  ```
- Chance de vitória (logística sobre a razão de poder):
  ```
  ratio     = myPower / wildPower
  winChance = 1 / (1 + exp(-BATTLE_K * ln(ratio)))      // BATTLE_K inicial: 4
  winChance = clamp(winChance, BATTLE_MIN, BATTLE_MAX)  // 0.05 .. 0.95
  ```
  Com poderes iguais a chance é 50%. Sempre existe uma chance pequena de vencer um muito mais forte e de perder para um muito mais fraco.
- **Derrota**: encontro encerrado. O Pokémon do jogador não sofre penalidade (não há HP persistente).
- **Vitória**: Pokémon do jogador ganha XP; treinador ganha XP; segue para a captura.

### 5.6 Captura
- Após a vitória, uma tentativa de captura:
  ```
  catchChance = clamp((captureRate / 255) * CATCH_MULT * berryBonus, CATCH_MIN, 1)
  ```
  `captureRate` vem da PokéAPI (3 para lendários, 255 para comuns). Inicial: `CATCH_MULT = 1.2`, `CATCH_MIN = 0.03`.
- Sucesso: o Pokémon entra na coleção (no jardim). Falha: ele foge.
- Uma tentativa por encontro (pode ser revisto no futuro).

### 5.7 Doces (pontos ao soltar)
- Doces pertencem a uma **linha evolutiva** (`evolution_chain_id`), não a uma espécie. Soltar um Charmander dá doces que servem para Charmander, Charmeleon e Charizard.
- Ao soltar:
  ```
  candies = RELEASE_BASE + floor(level / RELEASE_LEVEL_DIV)   // inicial: 3 + floor(level / 5)
  ```
  Shiny dá multiplicador (inicial ×3).
- Também concede **doce genérico** (`RELEASE_GENERIC`, inicial: 1), usável em qualquer Pokémon a uma taxa pior (ex.: 3 genéricos = 1 doce específico).
- Não é possível soltar um Pokémon que está no daycare. Confirmar no frontend antes de soltar shiny ou favorito.

### 5.8 Nível, XP e evolução
- Nível máximo: `LEVEL_CAP` (inicial: 100).
- XP necessária para o próximo nível:
  ```
  xpToNext(level) = floor(10 * level ^ 1.5)
  ```
- Fontes de XP do Pokémon: vencer batalha (`BATTLE_XP = wildLevel * 5`), daycare, e **usar doces** (cada doce = `CANDY_XP` XP, inicial: 25).
- **Evolução**: requer `level >= minLevel` da evolução **e** custo em doces da linha (inicial: estágio 1→2 custa 25, 2→3 custa 100). Mantém nível, XP, shiny e apelido.

### 5.9 Daycare
- Slots limitados: começa com 1, +1 nos níveis de treinador definidos em config (ex.: 5, 15, 30).
- Pokémon no daycare ganha `DAYCARE_XP_PER_HOUR` (inicial: 30) de XP passivo, calculado por timestamp ao retirar ou ao consultar o estado.
- Limite de tempo acumulado: `DAYCARE_MAX_HOURS` (inicial: 24) para incentivar o jogador a voltar.
- Pokémon no daycare **não pode** batalhar, ser solto nem evoluir enquanto estiver lá.
- Qualquer Pokémon pode entrar (inclusive de nível baixo; o caso de uso principal é upar raros sem precisar de duplicatas).

### 5.10 Berries
- O jardim tem canteiros (começa com 2, mais desbloqueados por nível de treinador).
- Plantar consome 1 semente do inventário; a berry fica pronta em `growMs` (definido por tipo).
- Colher dá `yield` unidades da berry e chance de semente extra.
- Usar uma berry aplica um **efeito** ao jogador. Exemplos iniciais (todos em config):

| Berry | Tempo | Efeito |
|---|---|---|
| Oran | 30 min | +2 energia imediata |
| Pinap | 2 h | Próxima captura com chance ×1.5 |
| Razz | 4 h | Próximo encontro com pesos de raros dobrados |
| Nanab | 6 h | Daycare ×2 de XP por 2 h |
| Lum | 12 h | Próximo encontro com chance de shiny ×4 |

- Efeitos são **por cargas** (ex.: "próximo encontro") ou **por tempo** (ex.: "por 2 h"). Ver tabela `active_effects`.
- Sementes vêm de: colheita, recompensas de nível de treinador e, ocasionalmente, de vencer batalhas.

### 5.11 Jardim (visual)
Teste reversível. O chão e os objetos (grama, canteiro, itens) ficam numa grade isométrica, em blocos, porque colocar coisa num gramado frontal fica achatado. Os Pokémon continuam os GIFs 2D do Showdown, em pé sobre o bloco, sem serem redesenhados em perspectiva. O passo segue a grade. O sprite só espelha (`transform: scaleX(-1)`) conforme o lado horizontal do movimento. A ordem de desenho segue a profundidade do bloco, para quem está na frente cobrir quem está atrás.

Se o mix ficar estranho, o jardim volta a um gramado frontal. O teste é só visual, no cliente. Não muda regra, timestamp nem API.

- Mostra no máximo `GARDEN_MAX_VISIBLE` (inicial: 15) Pokémon andando. Prioridade: favoritos, depois aleatórios.
- Movimento puramente visual no cliente: alvo aleatório na grade, andar até ele, esperar alguns segundos, repetir.
- Clicar em um Pokémon abre os detalhes (nível, XP, doces da linha, ações).
- Canteiros de berry ocupam um bloco da grade.

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
- Todas as rolagens de um encontro (espécie, nível, shiny, batalha, captura) usam a sequência desse PRNG, nessa ordem.

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
| POST | `/encounters/:id/battle` | `{ pokemonId }` → resolve batalha e, se vencer, captura |
| POST | `/encounters/:id/flee` | Encerra encontro |
| POST | `/pokemon/:id/release` | Solta e credita doces |
| POST | `/pokemon/:id/feed` | `{ candies, useGeneric? }` → aplica XP |
| POST | `/pokemon/:id/evolve` | `{ toSpeciesId }` |
| PATCH | `/pokemon/:id` | Apelido, favorito |
| POST | `/daycare/:slot` | `{ pokemonId }` → coloca |
| DELETE | `/daycare/:slot` | Retira e aplica XP |
| POST | `/plots/:index/plant` | `{ berryKey }` |
| POST | `/plots/:index/harvest` | Colhe |
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
- Soltar, doces, alimentar, evoluir.
- Tela de coleção (lista/filtro) e tela de detalhes.

**Fase 4 — Daycare**

**Fase 5 — Berries e efeitos**

**Fase 6 — Polimento**
- Pokédex (espécies vistas/capturadas), animações de captura, sons, contador de energia, notificações de berry pronta.
- Testes das funções puras de `game/`.

---

## 10. Questões em aberto
- Batalha com 1 Pokémon ou time de até 3?
- Mais de uma tentativa de captura por encontro (gastando algo)?
- Pokémon com IVs/natures ou só nível?
- Encontros de lendários: só em regiões especiais ou eventos?
- Ranking entre jogadores? A visita ao jardim de outra pessoa já está decidida; o ranking, não.

# Pocket Meadow — Modelo de Dados

> Banco: **SQLite** (modo WAL, `foreign_keys = ON`). ORM sugerido: Drizzle.
> Timestamps: **INTEGER em milissegundos Unix** (`Date.now()` do servidor).
> Booleanos: INTEGER 0/1.
> Contexto das mecânicas: ver `PLANNING.md`.

## Visão geral

O banco guarda dois tipos de dado:

1. **Dados estáticos** (seed da PokéAPI): `species`, `evolutions`.
2. **Estado dos jogadores**: todo o resto.

**Não ficam no banco** (ficam em `server/src/config/`): regiões, tabelas de spawn, tipos de berry, efeitos, fórmulas e constantes. O banco referencia essas coisas por **chave de texto** (`region_slug`, `berry_key`, `effect_key`, `item_key`). Isso permite rebalancear sem migração.

```
users 1──1 trainers
users 1──* sessions
users 1──* pokemon *──1 species
users 1──* candies (por evolution_chain_id)
users 1──* daycare_slots ──0..1 pokemon
users 1──* berry_plots
users 1──* inventory
users 1──* active_effects
users 1──* encounters *──1 species
encounters 1──* encounter_fighters *──0..1 pokemon
species 1──* evolutions (from/to)
users 1──* pokedex_entries
```

---

## 1. Dados estáticos

### `species`
Seed via `scripts/seed-species.ts`. Uma linha por Pokémon (forma padrão).

```sql
CREATE TABLE species (
  id                    INTEGER PRIMARY KEY,           -- National Dex ID (= ID da PokéAPI)
  name                  TEXT    NOT NULL,              -- "bulbasaur"
  display_name          TEXT    NOT NULL,              -- "Bulbasaur"
  type1                 TEXT    NOT NULL,
  type2                 TEXT,
  hp                    INTEGER NOT NULL,
  attack                INTEGER NOT NULL,
  defense               INTEGER NOT NULL,
  sp_attack             INTEGER NOT NULL,
  sp_defense            INTEGER NOT NULL,
  speed                 INTEGER NOT NULL,
  base_stat_total       INTEGER NOT NULL,              -- soma dos 6 stats (usado no poder)
  base_experience       INTEGER NOT NULL,              -- XP que dá ao ser derrotado (PLANNING.md, seção 5.5)
  capture_rate          INTEGER NOT NULL,              -- 3..255, da PokéAPI
  evolution_chain_id    INTEGER NOT NULL,              -- chave dos doces
  evolves_from_id       INTEGER REFERENCES species(id),
  evolution_stage       INTEGER NOT NULL DEFAULT 1,    -- 1, 2 ou 3
  is_legendary          INTEGER NOT NULL DEFAULT 0,
  is_mythical           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_species_chain ON species(evolution_chain_id);
```

Sprites não são guardados: o caminho é derivado do ID. No jardim, `/sprites/pmd/{id}/` (shiny em `shiny/`); no card e no encontro, `/sprites/showdown/{id}.gif` e `/sprites/showdown/shiny/{id}.gif`.

### `evolutions`
Simplificado: toda evolução é por nível mínimo. A evolução por troca também (a missão de NPC é só um atalho, PLANNING.md, seção 5.15). O `candy_cost` ficou de um modelo anterior e não é usado.

```sql
CREATE TABLE evolutions (
  from_species_id  INTEGER NOT NULL REFERENCES species(id),
  to_species_id    INTEGER NOT NULL REFERENCES species(id),
  min_level        INTEGER NOT NULL,                 -- da PokéAPI ou padrão do config
  candy_cost       INTEGER NOT NULL,                 -- sem uso: evolução é só por nível (PLANNING.md, seção 5.8)
  via_trade        INTEGER NOT NULL DEFAULT 0,       -- 1 = era troca nos jogos; evolui por nível igual, a missão de NPC é atalho (PLANNING.md, seção 5.15)
  PRIMARY KEY (from_species_id, to_species_id)
);
```

Suporta evoluções ramificadas (ex.: Eevee → várias): o jogador escolhe o destino.

---

## 2. Contas

### `users`
```sql
CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT    NOT NULL,                   -- argon2id
  created_at     INTEGER NOT NULL
);
```

### `sessions`
```sql
CREATE TABLE sessions (
  id          TEXT    PRIMARY KEY,                   -- SHA-256 em base64url do token (32 bytes). O cookie guarda o token cru.
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
```

### `auth_events`
Rastro para olhar várias contas no mesmo lugar. A linha não é apagada no logout. Trocas entram numa tabela própria quando essa mecânica existir.

```sql
CREATE TABLE auth_events (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event       TEXT    NOT NULL CHECK (event IN ('register', 'login', 'logout')),
  ip          TEXT    NOT NULL,                      -- visto pelo servidor, nunca enviado pelo cliente como dado de jogo
  user_agent  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_auth_events_user ON auth_events(user_id);
CREATE INDEX idx_auth_events_ip ON auth_events(ip);
```

---

## 3. Estado do treinador

### `trainers`
Uma linha por usuário. Contém tudo que é escalar e global do jogador.

```sql
CREATE TABLE trainers (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level               INTEGER NOT NULL DEFAULT 1,
  xp                  INTEGER NOT NULL DEFAULT 0,    -- XP dentro do nível atual
  energy              INTEGER NOT NULL,
  energy_updated_at   INTEGER NOT NULL,              -- âncora do catch-up de energia
  generic_candies     INTEGER NOT NULL DEFAULT 0,
  total_encounters    INTEGER NOT NULL DEFAULT 0,    -- estatísticas
  total_catches       INTEGER NOT NULL DEFAULT 0,
  total_releases      INTEGER NOT NULL DEFAULT 0,
  updated_at          INTEGER NOT NULL
);
```

Desbloqueios (regiões, slots de daycare, canteiros) são **derivados de `level`** via config. Não guardar flags de desbloqueio.

---

## 4. Pokémon do jogador

### `pokemon`
```sql
CREATE TABLE pokemon (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  species_id        INTEGER NOT NULL REFERENCES species(id),
  level             INTEGER NOT NULL,
  xp                INTEGER NOT NULL DEFAULT 0,      -- XP dentro do nível atual
  is_shiny          INTEGER NOT NULL DEFAULT 0,
  nickname          TEXT,
  is_favorite       INTEGER NOT NULL DEFAULT 0,
  location          TEXT    NOT NULL DEFAULT 'garden'
                    CHECK (location IN ('garden', 'daycare')),
  caught_at         INTEGER NOT NULL,
  caught_region     TEXT,                            -- region_slug do config; NULL para o inicial
  original_species_id INTEGER NOT NULL REFERENCES species(id) -- espécie na captura (histórico)
);

CREATE INDEX idx_pokemon_user          ON pokemon(user_id);
CREATE INDEX idx_pokemon_user_species  ON pokemon(user_id, species_id);
```

Soltar = `DELETE` da linha (em transação, creditando os doces). Se quiser histórico, adicionar `released_at` e filtrar por `released_at IS NULL`.

### `candies`
Doces por linha evolutiva.

```sql
CREATE TABLE candies (
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evolution_chain_id  INTEGER NOT NULL,
  amount              INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (user_id, evolution_chain_id)
);
```

### `daycare_slots`
```sql
CREATE TABLE daycare_slots (
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_index        INTEGER NOT NULL,                -- 0..(slots desbloqueados - 1)
  pokemon_id        INTEGER NOT NULL UNIQUE REFERENCES pokemon(id) ON DELETE CASCADE,
  entered_at        INTEGER NOT NULL,
  last_settled_at   INTEGER NOT NULL,                -- até quando a XP já foi aplicada
  PRIMARY KEY (user_id, slot_index)
);
```

Regras:
- Ao colocar: `pokemon.location = 'daycare'`, `entered_at = last_settled_at = now`.
- No catch-up: `end = min(now, entered_at + DAYCARE_MAX_HOURS)`; XP = `(end - last_settled_at)` em horas × taxa (× bônus de efeito ativo); aplicar no Pokémon; `last_settled_at = end`.
- Ao retirar: aplicar o catch-up, apagar a linha e definir `pokemon.location = 'garden'`.
- Slot vazio = linha ausente.

---

## 5. Encontros

### `encounters`
Persistidos para evitar reroll por refresh e para servir de histórico/depuração.

```sql
CREATE TABLE encounters (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region_slug        TEXT    NOT NULL,
  species_id         INTEGER NOT NULL REFERENCES species(id),
  level              INTEGER NOT NULL,
  is_shiny           INTEGER NOT NULL DEFAULT 0,
  rng_seed           INTEGER NOT NULL,               -- seed do PRNG deste encontro
  status             TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'lost', 'caught', 'escaped', 'fled')),
  -- 'lost'    = perdeu a batalha
  -- 'caught'  = venceu e capturou
  -- 'escaped' = venceu, mas a captura falhou
  -- 'fled'    = jogador fugiu ou o encontro expirou
  win_chance         REAL,                           -- registrado para depuração/balanceamento
  catch_chance       REAL,
  caught_pokemon_id  INTEGER REFERENCES pokemon(id) ON DELETE SET NULL,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  resolved_at        INTEGER
);

CREATE INDEX idx_encounters_user_created ON encounters(user_id, created_at DESC);

-- Quem lutou: o time tem de 1 a 3 Pokémon (PLANNING.md, seção 5.5).
CREATE TABLE encounter_fighters (
  encounter_id  INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  slot          INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 2),
  pokemon_id    INTEGER REFERENCES pokemon(id) ON DELETE SET NULL,  -- NULL se foi solto depois
  power         REAL    NOT NULL,                     -- poder na hora da batalha, para depuração/balanceamento
  PRIMARY KEY (encounter_id, slot)
);

-- Garante no máximo 1 encontro pendente por jogador
CREATE UNIQUE INDEX uq_encounters_one_pending
  ON encounters(user_id) WHERE status = 'pending';
```

Os campos `win_chance` e `catch_chance` também permitem consultar depois se o balanceamento está como esperado.

### `pokedex_entries`
```sql
CREATE TABLE pokedex_entries (
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  species_id      INTEGER NOT NULL REFERENCES species(id),
  seen_count      INTEGER NOT NULL DEFAULT 0,
  caught_count    INTEGER NOT NULL DEFAULT 0,
  first_seen_at   INTEGER NOT NULL,
  first_caught_at INTEGER,
  shiny_caught    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, species_id)
);
```
Atualizada ao criar um encontro (visto), ao capturar e ao evoluir (a nova espécie conta como capturada).

---

## 6. Berries, inventário e efeitos

### `berry_plots`
```sql
CREATE TABLE berry_plots (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plot_index   INTEGER NOT NULL,                     -- 0..(canteiros desbloqueados - 1)
  berry_key    TEXT    NOT NULL,                     -- chave do config: 'oran', 'pinap', ...
  planted_at   INTEGER NOT NULL,
  ready_at     INTEGER NOT NULL,                     -- planted_at + growMs (fixado no plantio)
  PRIMARY KEY (user_id, plot_index)
);
```
Canteiro vazio = linha ausente. Pronta quando `now >= ready_at`. Colher = apagar a linha e creditar no inventário.

### `inventory`
Itens genéricos, por chave do config.

```sql
CREATE TABLE inventory (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key   TEXT    NOT NULL,                       -- 'berry:oran', 'seed:oran', ...
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (user_id, item_key)
);
```
Convenção de chave: `seed:<berry>` para sementes, `berry:<berry>` para berries colhidas. Novos tipos de item entram só no config.

### `active_effects`
```sql
CREATE TABLE active_effects (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effect_key   TEXT    NOT NULL,                     -- 'catch_boost', 'rare_boost', 'shiny_boost', 'daycare_boost'
  multiplier   REAL    NOT NULL DEFAULT 1,
  charges      INTEGER,                              -- efeitos por uso ("próximo encontro"); NULL se for por tempo
  expires_at   INTEGER,                              -- efeitos por tempo; NULL se for por cargas
  created_at   INTEGER NOT NULL,
  CHECK (charges IS NOT NULL OR expires_at IS NOT NULL)
);

CREATE INDEX idx_effects_user ON active_effects(user_id);
```
Regras:
- Efeito por cargas: decrementa ao ser consumido; apaga quando chega a 0.
- Efeito por tempo: apagado no catch-up quando `expires_at <= now`.
- Política de empilhamento (somar, multiplicar ou renovar) definida por efeito no config. Sugestão inicial: o mesmo `effect_key` **renova** em vez de empilhar.
- Efeitos imediatos (ex.: Oran = +energia) não criam linha, só alteram o estado.

---

## 7. Transações críticas

Cada item abaixo deve ser uma única transação (`BEGIN IMMEDIATE` no SQLite):

| Ação | Passos |
|---|---|
| Criar encontro | catch-up → validar região/energia/sem pendente → `energy -= 1` → consumir efeitos de encontro → inserir encontro → atualizar pokédex (visto) |
| Batalhar | catch-up → validar encontro pendente e time (1 a 3, distintos, no jardim, do jogador) → rolar vitória → inserir `encounter_fighters` → (se venceu) XP dividido entre o time, XP do treinador, rolar captura e, se capturou, inserir Pokémon → atualizar status do encontro e pokédex |
| Soltar (um ou vários) | catch-up → validar todos (do jogador, nenhum no daycare, sobra pelo menos 1 Pokémon) → apagar → creditar `candies` por linha + `generic_candies` → `total_releases += n`. Se um falhar, nada é solto |
| Alimentar | catch-up → validar (no jardim, abaixo do nível máximo, saldo da moeda escolhida) → limitar as doses ao necessário para o nível máximo → debitar → aplicar XP e level ups |
| Evoluir | catch-up → validar (no jardim, linha em `evolutions`, `min_level`) → trocar `species_id` → pokédex (vista e capturada) → XP do treinador. Não custa doce |
| Colher | validar `ready_at <= now` → apagar canteiro → creditar berries/sementes |

Regra de segurança: o jogador **nunca** pode ficar com zero Pokémon (bloquear soltar o último).

---

## 8. Seed inicial de um novo jogador

No `POST /auth/register`, em uma transação:
1. `users` + `trainers` (`energy = ENERGY_MAX`, `energy_updated_at = now`).
2. Pokémon inicial escolhido (nível 5) em `pokemon` + `pokedex_entries`.
3. `inventory`: `seed:oran` ×3, `seed:pinap` ×1.

---

## 9. Social

Decidido no `PLANNING.md`, ainda sem tabelas: amigos, visita ao jardim de outro jogador, presente e troca de Pokémon. Não há batalha entre jogadores. Presente e troca serão transações, e a troca não pode deixar nenhum dos dois jogadores com zero Pokémon.

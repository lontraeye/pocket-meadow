# Pocket Meadow — Jornada (regiões, capítulos e marcos)

Mapa da progressão do jogo: que áreas existem, em que ordem abrem, o que o jogador persegue em cada trecho e o que fica para missões e eventos. Escrito em 2026-10-29 a partir das tabelas de encontro da PokéAPI (Gen 1 e 2). Complementa as seções 5.3 (regiões), 5.14 (campo de encontro), 5.15 (missões) e 5.16 (construção do jardim) do `PLANNING.md`.

Nada aqui está implementado ainda. A ordem de implementação está na seção 9.

O **roteiro** de cada região (missão principal, eventos e missões secundárias por capítulo) fica em `roteiro/`. Pronto: `roteiro/JOHTO.md`. Kanto vem depois.

---

## 1. O problema

- O jogo tem **6 áreas** (3 em Kanto, 3 em Johto) e cobre poucas espécies.
- A única progressão é o nível de treinador. Não há um objetivo maior.
- Das 251 espécies, a PokéAPI mostra que:

| Como aparece nos jogos (Gen 1–2) | Espécies | Exemplos |
|---|---|---|
| Andando (mato e caverna) | 140 | Pidgey, Zubat, Mareep, Larvitar |
| Só pescando ou surfando | 14 | Magikarp, Dratini, Tentacool, Chinchou, Corsola, Mantine |
| Só com Headbutt (árvores) | 3 | Aipom, Pineco, Heracross |
| Só com Rock Smash | 1 | Shuckle |
| Presente, encontro fixo, ovo ou troca | 35 | iniciais, Eevee, fósseis, Lapras, Snorlax, bebês, lendários |
| Só evoluindo | 58 | Charizard, Gengar, Tyranitar, Espeon |

Hoje o jogo só usa o "andando", e só em 6 áreas.

## 2. Decisões (2026-10-29)

1. **O jogador escolhe a região inicial** no cadastro: Kanto ou Johto, com os iniciais de lá. A outra região abre quando ele vira campeão da primeira.
2. **Áreas abrem por marcos da história**, não só por nível. Cada região tem 8 capítulos inspirados no caminho dos ginásios, mais a Liga. Cada capítulo fecha com um **marco**: um desafio que libera o próximo. O nível de treinador continua existindo e entra como requisito do marco.
3. **Água, árvores e pedras entram por ferramentas** ganhas nos marcos: Vara Velha, Vara Boa, Super Vara, Surf, Headbutt e Rock Smash. Cada área ganha "pontos" extras com as tabelas reais desses métodos.

A história e os capítulos são **nossos**, inspirados no caminho dos jogos. Os nomes de lugares e espécies seguem os jogos, como já acontece nas áreas atuais. Os líderes e os desafios são descritos por cidade e tipo; a forma final de cada desafio é nossa (seção 6).

## 3. Regras das áreas

- **Uma área do jogo = uma tabela de encontro.** Andares com a mesma tabela viram uma área só (as oito da Bell Tower, as três de Mt. Moon). Andares com tabelas diferentes podem virar uma área com a **média dos andares**, como já fazemos com os períodos do Crystal.
  - O config passa a aceitar várias fontes por área: `sources: [{ area, version }, ...]`. O script tira a média das tabelas, com o mesmo peso por fonte.
- **Versão por área.** Padrão: Yellow em Kanto e Crystal em Johto. Trocar quando a versão padrão perde espécies. Conferido na PokéAPI:
  - Yellow não tem Weedle, Kakuna, Ekans, Arbok, Meowth, Koffing, Pikachu selvagem (só na Floresta, no Red), Electabuzz, Shellder, Staryu, Horsea, Psyduck e Golduck selvagens.
  - Crystal não tem Mareep, Flaaffy e Girafarig andando (só Gold/Silver), nem Mankey e Primeape.
  - **Rotas gêmeas com versões diferentes:** onde os jogos repetem a tabela (Rota 3 e 4, 5 e 6, 7 e 8, 12 e 13, 14 e 15, 16 e 18, 24 e 25), usar uma versão em cada uma, para as duas não serem iguais. Ex.: Rota 5 no Yellow e Rota 6 no Blue (Meowth); Rota 3 no Yellow e Rota 4 no Red (Ekans).
- **Período do dia (opcional, recomendado):** o Crystal tem tabelas de manhã, dia e noite. Hoje tiramos a média. O clima do jardim já tem o relógio de Brasília (`weather.ts`). Dá para trocar a tabela pelo horário: Hoothoot e Gastly à noite, Ledyba de manhã. O replay continua funcionando se o período for salvo no encontro.
- **Espécies fora da faixa (252+) e lendários são descartados** das tabelas comuns. Lendários só entram por evento (seção 7).

## 4. Ferramentas (métodos de encontro)

Cada área pode ter, além do mato, **pontos** de um método. O ponto só aparece quando o jogador tem a ferramenta. Cada ponto é uma tabela própria no snapshot, com o mesmo sorteio de hoje.

| Ferramenta | Método da PokéAPI | O que libera (exemplos) | Kanto: marco | Johto: marco |
|---|---|---|---|---|
| Vara Velha | `old-rod` | Magikarp, Poliwag, Goldeen, Krabby, Tentacool | 3 (Vermilion) | 2 (Azalea) |
| Headbutt | `headbutt-*` | Aipom, Pineco, Heracross, Exeggcute, Hoothoot | 4 (Celadon) | 2 (Azalea) |
| Vara Boa | `good-rod` | Shellder, Chinchou, Staryu, Corsola, Dratini, Gyarados | 5 (Fuchsia) | 5 (Cianwood) |
| Surf | `surf` | Tentacool, Psyduck, Quagsire, Mantine, Horsea | 5 (Fuchsia) | 4 (Ecruteak) |
| Rock Smash | `rock-smash` | Shuckle, Krabby | 6 (Saffron) | 4 (missão do Sudowoodo) |
| Super Vara | `super-rod` | Dragonair, Lanturn, Seadra, Kingler, Qwilfish | 7 (Cinnabar) | 8 (Blackthorn) |

- O Headbutt é uma ferramenta, não um golpe. Não depende do time do jogador. (Dá para ligar a habilidades depois, como a seção 5.16 prevê.)
- A ferramenta vale nas duas regiões: quem ganhou o Surf em Kanto surfa em Johto.
- As tabelas de Headbutt e Rock Smash só existem nos jogos da Gen 2. Em Kanto, só as Rotas 26 e 27 têm árvores (são do caminho da Liga de Johto). Na prática, essas duas ferramentas rendem em Johto, e quem começa em Kanto as aproveita depois.
- **Ligação com o campo de encontro (5.14):** o mini gramado ganha manchas de água, árvores ou pedras quando a área tem ponto e o jogador tem a ferramenta. Tocar na mancha sorteia da tabela daquele método.

## 5. Capítulos

Níveis selvagens vêm das tabelas. O **nível do marco** é a referência para o desafio (seção 6) e fica no config. Todos os números são a calibrar.

### 5.1 Kanto

| Cap. | Trecho | Áreas que abrem (versão, Nv selvagem) | Novidades de espécie | Marco (tipo) · Nv | Recompensa |
|---|---|---|---|---|---|
| 1 | Pallet → Pewter | Rota 1 (Y, 2–7) · Rota 22 (Y, 2–6) · Rota 2 (Y, 3–7) · Floresta Verde (R, 3–6) | Nidoran ♀/♂, Mankey, Pikachu, Weedle | Pewter (Pedra) · 12 | — |
| 2 | Mt. Moon → Cerulean | Rota 3 (Y, 8–12) · Mt. Moon (Y, 1F–B2F, 6–13) · Rota 4 (R, 8–12) | Clefairy, Paras, Sandshrew, Ekans | Cerulean (Água) · 18 | Fóssil (escolha: Hélice ou Domo), revive no cap. 7 |
| 3 | Ponte e porto | Rota 24 (Y) e 25 (R) (12–17) · Rota 5 (Y) e 6 (B) (3–17) · Rota 11 (Y, 15–20) · Caverna do Diglett (Y, 15–31) | Abra, Jigglypuff, Meowth, Drowzee, Diglett, Oddish, Bellsprout | Vermilion (Elétrico) · 24 | **Vara Velha** |
| 4 | Túnel e Celadon | Rota 9 e 10 (Y, 16–22) · Rock Tunnel (Y, 10–22) · Rota 7 e 8 (Y/B, 15–27) | Machop, Onix, Magnemite, Vulpix, Kadabra | Celadon (Planta) · 29 | **Headbutt** · Eevee (presente) |
| 5 | Torre e ciclovia | Torre Pokémon (Y, 18–29) · Rotas 12–15 (Y/R, 24–32) · Rota 16 e 18 (Y, 22–26) · Rota 17 (Y, 26–32) | Gastly, Haunter, Cubone, Venonat, Farfetch'd, Doduo, Ponyta | Fuchsia (Veneno) · 35 | **Vara Boa**, **Surf** · Snorlax (evento) |
| 6 | Safári e Saffron | Zona Safári (Y, 4 setores, 7–36) · Usina Elétrica (R, 30–38) · Rota 21 (Y, 11–19) | Kangaskhan, Scyther, Pinsir, Chansey, Tauros, Rhyhorn, Exeggcute, Electabuzz, Voltorb | Saffron (Psíquico) · 40 | **Rock Smash** · Lapras (presente) · Hitmonlee ou Hitmonchan (escolha) |
| 7 | Ilhas | Ilhas Seafoam (Y/R, 9–45) · Mansão Pokémon (Y/B, 12–46) · Rotas 19 e 20 (só água) | Seel, Dewgong, Shellder, Staryu, Horsea, Psyduck, Koffing, Grimer, Magmar, Growlithe, Ditto | Cinnabar (Fogo) · 45 | **Super Vara** · fóssil revivido · Aerodactyl (missão do âmbar) |
| 8 | Estrada da Vitória | Rota 23 (Y, 36–46) · Victory Road (Y, 26–49) | Nidorino/Nidorina selvagens, Primeape, Machoke | Viridian (Terra) · 50 | — |
| Liga | Liga de Kanto | — | — | Liga (4 + campeão) · 55 | **Campeão de Kanto**: abre Johto · Caverna Celeste |

### 5.2 Johto

| Cap. | Trecho | Áreas que abrem (versão, Nv selvagem) | Novidades de espécie | Marco (tipo) · Nv | Recompensa |
|---|---|---|---|---|---|
| 1 | New Bark → Violet | Rota 29 (C, 2–3) · Rota 46 (C, 2–3) · Rota 30 (C, 3–4) · Rota 31 (C, 4–5) · Sprout Tower (C, 3–6) · Dark Cave, lado Violet (C, 2–4) | Sentret, Hoothoot, Ledyba, Spinarak, Hoppip, Dunsparce, Phanpy | Violet (Voador) · 10 | Ovo do Togepi (missão) |
| 2 | Ruínas e Azalea | Rota 32 (G, 4–7) · Ruins of Alph (C, Unown 5) · Union Cave 1F/B1F (C, 4–8) · Slowpoke Well 1F (C, 5–8) · Rota 33 (C, 6–7) | Mareep, Wooper, Unown, Slowpoke, Ekans | Azalea (Inseto) · 14 | **Vara Velha**, **Headbutt** |
| 3 | Ilex e Goldenrod | Ilex Forest (C, 5–7) · Rota 34 (C, 10–12) | Snubbull, Ditto, Abra, Drowzee, Jigglypuff | Goldenrod (Normal) · 18 | Regador · Eevee (missão) · Ovo Estranho (missão) |
| 4 | Ecruteak | Rota 35 (C, 10–16) · National Park (C, 10–15) · Rota 36 (C, 4–6) · Rota 37 (C, 13–16) · Burned Tower (C, 12–16) | Yanma, Sunkern, Stantler, Growlithe, Koffing | Ecruteak (Fantasma) · 22 | **Surf** · Sudowoodo (evento, dá a **Rock Smash**) · cães lendários soltos (seção 7) |
| 5 | Costa e Cianwood | Rota 38 e 39 (C, 13–18) · Whirl Islands (C, 22–28) · Rotas 40 e 41 (só água) | Magnemite, Tauros, Miltank, Seel, Krabby, Mantine, Horsea | Cianwood (Lutador) · 26 | **Vara Boa** |
| 6 | Olivine | Rota 42 (C, 13–16) · Mt. Mortar (C, andares baixos, 13–17) | Marill, Machop, Spearow/Fearow | Olivine (Aço) · 29 | Tyrogue (presente, Mt. Mortar) |
| 7 | Mahogany | Rota 43 (G, 15–17) · Lake of Rage (só água/árvore) · Mt. Mortar alto (C, 28–32) | Girafarig, Flaaffy, Farfetch'd, Gyarados vermelho (evento) | Mahogany (Gelo) · 33 | — |
| 8 | Blackthorn | Ice Path (C, 21–26) · Dark Cave, lado Blackthorn (C, 20–30) · Rota 44 (C, 22–26) · Rota 45 (C, 20–30) · Dragon's Den (só água) | Swinub, Delibird, Sneasel, Jynx, Ursaring, Gligar, Skarmory, Donphan, Tangela, Lickitung, Dratini | Blackthorn (Dragão) · 38 | **Super Vara** · Dratini (presente) |
| Liga | Caminho da Liga | Rota 26 e 27 (C, 28–32) · Tohjo Falls (C, 20–24) · Victory Road (C, 32–40) · Union Cave B2F e Slowpoke Well B1F (só com Surf) | Quagsire, Golbat, Rhyhorn, Sandslash, Lapras (evento) | Liga (4 + campeão) · 45 | **Campeão de Johto**: abre Kanto · Bell Tower |

### 5.3 Segunda região e fim de jogo

- **Ao virar campeão, a outra região abre no capítulo 1.** O jogador chega forte e passa rápido pelos primeiros capítulos, mas ainda precisa capturar e cumprir os marcos para abrir as áreas. Os marcos da segunda região usam os mesmos níveis: o desafio começa fácil para quem já é campeão, e é isso mesmo.
- **Campeão das duas regiões** abre o fim de jogo: Rota 28 (C, 39–43), Mt. Silver (C, 40–53, com Larvitar), Caverna Celeste (Y/R, 45–65) e os eventos lendários da seção 7.

## 6. Marcos

Um marco tem duas partes:

1. **Requisitos para tentar:** nível de treinador mínimo e um **objetivo do capítulo**, como capturar N espécies diferentes das áreas do capítulo. Tudo derivado do que o banco já guarda (`pokedex_entries`, `pokemon`).
2. **O desafio:** uma luta contra o líder, com time fixo no config (espécies, níveis e golpes) e a IA da simulação compartilhada (seção 5.18). Gasta energia como um encontro. Perder não custa nada além da energia.

**Faseado:** a primeira versão sai **só com os requisitos**. Cumpriu, o marco fica disponível e o jogador o resgata com um toque. A luta contra o líder entra depois (seção 9, parte 5), sem mudar o resto.

- O marco cumprido é **guardado no banco** (conquista, não derivado). As ferramentas e as áreas abertas saem dos marcos pelo config, sem coluna própria.
- Recompensas de marco: ferramenta, presente (um Pokémon pronto, como o Eevee) ou abertura de evento. Tudo em config.
- **Mapa da região:** a tela de exploração vira um mapa por região, com as áreas como pontos ligados na ordem dos capítulos, os bloqueados apagados e o próximo marco em destaque. A primeira versão pode ser uma lista em trilha (capítulos empilhados). A arte do mapa fica com o usuário, como a dos biomas (5.16).

## 7. Especiais: presentes, eventos e lendários

Todas as 35 espécies sem encontro selvagem, com o caminho proposto. **Presente** = recompensa de marco. **Evento** = um encontro único que abre num marco e fica disponível até ser capturado (sem rerolar: o encontro é sorteado e persistido como os outros). **Missão** = entra com o sistema da seção 5.15.

| Espécie | Nos jogos | Proposta |
|---|---|---|
| Bulbasaur, Charmander, Squirtle | Inicial de Kanto | Inicial de quem escolhe Kanto. Os outros dois: missão do professor de Kanto, depois de campeão |
| Chikorita, Cyndaquil, Totodile | Inicial de Johto | Mesmo esquema, em Johto |
| Eevee | Presente (Celadon / Bill) | Presente do marco 4 (Kanto) ou 3 (Johto) |
| Lapras | Presente (Silph) / Union Cave às sextas | Presente do marco 6 (Kanto); evento em Union Cave B2F às sextas (Johto) |
| Hitmonlee, Hitmonchan | Presente do Dojo | Escolha no marco 6 (Kanto) |
| Tyrogue | Presente em Mt. Mortar | Presente do marco 6 (Johto) |
| Omanyte, Kabuto | Fóssil revivido | Escolha no marco 2, revive no marco 7 (Kanto) |
| Aerodactyl | Âmbar revivido | Missão (âmbar do museu de Pewter), revive no marco 7 |
| Porygon | Prêmio do Game Corner | Missão ou loja de prêmios (moeda a decidir) |
| Snorlax | Bloqueando a rota | Evento do marco 5 (Kanto); em Johto, evento no fim de jogo |
| Sudowoodo | Árvore que se mexe | Evento do marco 4 (Johto) |
| Gyarados vermelho | Lake of Rage | Evento shiny garantido do marco 7 (Johto) |
| Togepi | Ovo do assistente | Missão no marco 1 (Johto): chocar o ovo andando com ele (ligado ao daycare e ao breed) |
| Pichu, Cleffa, Igglybuff, Smoochum, Elekid, Magby | Ovo Estranho | Missão do Ovo Estranho (marco 3, Johto), um bebê sorteado; depois, breed (5.18) |
| Xatu | Troca com NPC | Natu é selvagem (Ruins of Alph), então já tem rota |
| Articuno, Zapdos, Moltres | Encontro fixo | Eventos do fim de jogo em Seafoam, Usina e Victory Road |
| Mewtwo | Caverna Celeste | Evento final de Kanto, depois das aves |
| Raikou, Entei, Suicune | Soltos na Burned Tower, vagando | **Vagando:** depois do marco 4 de Johto, cada encontro em Johto tem uma chance pequena de ser um deles, uma vez por espécie. Suicune fecha com evento na Bell Tower |
| Lugia, Ho-Oh | Whirl Islands / Bell Tower | Eventos do fim de jogo, cada um liberado por missão (asa prateada e asa arco-íris) |
| Celebi | Evento (GS Ball) | Missão especial no fim de jogo, Ilex Forest |
| Mew | Evento | Recompensa de completar o álbum da Pokédex (5.12) |

**As 58 que só saem evoluindo** já têm caminho: a pré-evolução aparece em alguma área ou especial acima. As evoluções por troca seguem a seção 5.15, e as por pedra, a 5.16.

## 8. Missões para depois (só anotadas)

Não implementar agora. Elas ficam aqui para os capítulos já preverem o espaço:

- Professor de cada região: os outros iniciais (seção 7).
- Fóssil e âmbar: entregar no laboratório de Cinnabar.
- Ovo do Togepi e Ovo Estranho: chocar andando (encontros feitos com o ovo no time).
- Asas de Lugia e Ho-Oh, e a GS Ball de Celebi.
- Trocas com NPC por evolução (Kadabra, Machoke, Graveler, Haunter, Onix, Scyther, Poliwhirl, Slowpoke, Seadra, Porygon), como a seção 5.15 descreve.
- Unown: completar as 26 formas (Ruins of Alph). Pede guardar a forma do Unown; hoje não guardamos.
- Coleções por capítulo: "capturar todas as espécies da Rota X" dá recompensa pequena. Usa só `pokedex_entries`.

## 9. Ordem de implementação

Cada parte é testada antes da próxima, como nas fases do `PLANNING.md`.

1. **Conteúdo:** todas as áreas de andar das seções 5.1 e 5.2 no config, com várias fontes por área e versão por área. Ainda abertas por nível de treinador (uma escada provisória), para o jogo ganhar conteúdo logo. Sem migração.
   - **Johto feito em 2026-10-29:** 39 áreas, do capítulo 1 ao fim de jogo, cada uma com `chapter`. A escada provisória é `CHAPTER_MIN_LEVEL` em `server/src/config/regions.ts` (nível 1, 3, 6, 9, 12, 15, 18, 21, 24 e 30). O config aceita `sources` (média das fontes, cada uma com o mesmo peso); o snapshot guarda `sources` no lugar de `area`/`version`. As Rotas 32 e 43 juntam Crystal e Gold (Mareep, Flaaffy e Girafarig só existem no Gold; Ekans e Farfetch'd, só no Crystal). A condição "sem enxame" da PokéAPI conta como mato normal (antes a Dark Cave ficava vazia). A exploração agrupa Johto por capítulo e mostra só o próximo capítulo fechado. Kanto continua com as 3 áreas de antes até o roteiro de Kanto.
2. **Navegação** (seção 11): lugares e ligações de Johto, posição atual, viagem entre vizinhos, a tela nova (lugar atual, espécies da área, caminhos, mapa) e os feedbacks. Os capítulos ainda abrem pela escada de nível. Pede migração.
   - **Feito em 2026-10-29:** `server/src/config/places.ts` (54 lugares, ligações, `TOOL_CHAPTER`: Surf vale a partir do capítulo 4 até as ferramentas existirem), migração `0018_places` (`trainers.current_place`, `trainer_places`), `GET /places` e `POST /places/travel`, e o encontro recusa `not_here` fora do lugar atual. Tela: `Journey.svelte` (objetivo do capítulo, lugar, espécies capturadas/vistas/"?", procurar, caminhos com "novo" e motivo do bloqueio, aviso de chegada) e `PlaceMap.svelte` (mapa em SVG, viagem pelo mapa). Kanto saiu da exploração até ganhar lugares próprios. Falta dos feedbacks: "+1 da Rota X" depois da captura e o selo de área completa.
3. **Região inicial, capítulos e marcos:** escolha no cadastro, iniciais de Johto, marcos com requisitos (sem luta) no topo da tela, áreas abrindo por marco, Voo e ferramentas derivadas dos marcos. Reset das contas. Pede migração (seção 10).
   - **Feito em 2026-10-29 (sem a escolha de região e sem o reset):** por enquanto todo mundo começa em Johto, com Chikorita, Cyndaquil ou Totodile; a escolha Kanto/Johto volta quando Kanto tiver mapa. Marcos em `server/src/config/milestones.ts` (nível + espécies das áreas do capítulo capturadas, resgatado na cidade do marco); capítulo N+1 abre com o marco N (a escada de nível saiu de Johto). Surf no marco de Ecruteak, Voo no de Cianwood (viaja pelo mapa para cidade visitada). Migração `0019_milestones` (`trainer_milestones`), que dá a quem já joga os marcos que a escada de nível abria. `POST /places/milestones/:key/claim`. Na tela: o marco no topo ("Espécies do capítulo 5/6 · Nv 3/3"), "Vá até Violet" e "Desafiar" na cidade, bandeira no mapa, celebração ao conquistar e "Voar para…". O reset das contas ficou para depois (decisão do usuário).
   - **A calibrar:** a conta de espécies vale para qualquer espécie das áreas do capítulo, então as comuns (Pidgey, Rattata, Zubat) já contam para o capítulo seguinte. Alternativa: contar só as espécies novas do capítulo.
4. **Campo de encontro** (5.14), já pensando nas manchas de ferramenta.
5. **Ferramentas:** pontos de pesca, Surf, Headbutt e Rock Smash, com o snapshot por método.
6. **Desafio do líder:** luta de treinador com time fixo, usando a simulação da Fase 8.
7. **Presentes e eventos** da seção 7, e depois as missões (5.15).

## 10. Dados e pontos a decidir

**Mudanças de dados previstas (parte 2):**
- `trainers.home_region` (`kanto` ou `johto`).
- `trainer_milestones` (`user_id`, `milestone_key`, `cleared_at`). As ferramentas e as áreas abertas saem daqui pelo config.
- Config: `regionConfigs` ganha `chapter` (o marco que abre a área) no lugar de `minTrainerLevel`, e `sources` no lugar de `source`. Config novo de marcos e capítulos.
- Snapshot de regiões por método: `slots` passa a ser `{ walk, surf, oldRod, ... }`. Pede ajuste na seção 5.3.
- Encontro guarda o método (e o período do dia, se entrar).

**Contas atuais:** serão resetadas quando o loop novo estiver pronto (o usuário é o único jogador). Não precisa converter saves antigos para a jornada.

**Pontos a decidir:**
- Requisito de cada marco: quantas espécies do capítulo, e o nível de treinador mínimo. Depende do ritmo real dos jogadores.
- Período do dia nas tabelas do Crystal: entra na parte 1 ou fica para depois.
- Zona Safári: área comum ou regra própria (bola própria, poucos passos). Sugestão: área comum na primeira versão.
- Nome e visual dos líderes: genéricos por cidade e tipo, ou personagens próprios do jogo.
- Recompensa de dinheiro ao vencer um líder, junto com a ideia de dinheiro por vitória que já está anotada.

## 11. Navegação e tela de exploração (alinhado em 2026-10-29)

**O problema:** a exploração é uma lista com todas as áreas abertas. Não há "onde estou", nem "para onde vou", nem objetivo à vista. Tudo amontoado, sem jornada.

**Decidido:**
1. **O jogador está em um lugar.** Lugar = cidade ou área (rota, caverna, floresta). Só se procura Pokémon onde se está.
2. **Anda só para os vizinhos** (lugares ligados ao atual no mapa), na hora e sem custo. Lugar bloqueado aparece no caminho, apagado, com o motivo ("abre no marco de Azalea", "precisa de Surf").
3. **Voo depois:** um marco libera o Voo (Johto: marco 5, Cianwood, como o HM dos jogos). Com ele, o mapa leva direto a qualquer cidade já visitada.
4. **Tela principal = lugar atual + mapa num botão** (desenho abaixo).
5. **Jardim e jornada são duas gameplays paralelas.** Ao tocar em Explorar, o jogador volta para o último lugar onde parou (não para New Bark nem para uma lista). O Jardim fica a um toque de qualquer lugar, como um teletransporte, e voltar a explorar retoma do mesmo ponto. Cuidar do jardim (berries, daycare, PC, futura felicidade) não depende de onde se está na jornada.

### 11.1 A tela (o mapa é a tela, revisto em 2026-10-29)

A primeira versão (lugar + lista de caminhos + mapa num botão) ainda parecia menu. Agora a exploração é o próprio mapa:

```
┌──────────────────────────────┐
│ Cap. 1 · New Bark → Violet 0/18│  ← objetivo numa linha, com barra
├──────────────────────────────┤
│   [Cherrygrove]──(Rota 29)◉──[New Bark] │  ← mapa: toca para selecionar;
│                              │     você desliza até o lugar novo
├──────────────────────────────┤
│ ROTA 29               Nv 2–3  │  ← painel do lugar selecionado
│ Grama baixa e Pokémon tran…   │
│ 0/5 [?][?][?][?][?]           │  ← só onde você está
│ [     Procurar no mato     ]  │  ← ou "Ir para…", ou o motivo do bloqueio
├──────────────────────────────┤
│ [ Mais ]         [ Jardim ]   │  ← Mais: treino, efeitos, testes
└──────────────────────────────┘
```

- **Mapa:** os lugares na geografia, ligados por linhas. As ligações do lugar atual em azul; fechadas tracejadas; vizinho novo com um ponto amarelo; cidades com telhado. Abre centrado em você e acompanha a viagem. Desenho provisório em SVG; a arte fica com o usuário depois.
- **Painel:** o lugar selecionado (no começo, onde você está). Onde você está: espécies e procurar. Vizinho aberto: "Ir para…". Fechado: o motivo. Longe: "vá pelos vizinhos".
- **Mobile:** tudo cabe em 360×640 sem rolar; o mapa encolhe primeiro.

### 11.2 Feedbacks

- **Marco no topo** com barra e o que falta (ex.: "capture 2 espécies do capítulo · Nv 3 ✓"). Quando tudo está cumprido, vira botão "Desafiar" e pulsa.
- **Espécies da área:** capturada (sprite), vista (sprite apagado) e não vista ("?"). Contador "4/9". Mostra quantas espécies a área tem, sem dizer a raridade.
- **Chegada:** ao entrar num lugar novo, um aviso curto ("Rota 31 · 11 espécies aqui · novo!").
- **Depois da captura:** o destaque mostra "+1 da Rota 30 (5/9)" e o avanço do marco.
- **Selo "novo"** nos caminhos para lugares que acabaram de abrir e ainda não foram visitados.
- **Área completa:** todas as espécies dela capturadas ganha um selo no lugar e no mapa (recompensa pequena depois, seção 8).

### 11.3 O mapa de Johto (lugares e ligações)

Na geografia dos jogos. As cidades entram como lugares novos (não têm tabela de encontro). Cap. = capítulo em que o lugar abre.

| Lugar | Tipo | Cap. | Liga com |
|---|---|---|---|
| New Bark | cidade | 1 | Rota 29, Rota 27 (Surf) |
| Rota 29 | área | 1 | New Bark, Cherrygrove, Rota 46 |
| Rota 46 | área | 1 | Rota 29, Rota 45 |
| Cherrygrove | cidade | 1 | Rota 29, Rota 30 |
| Rota 30 | área | 1 | Cherrygrove, Rota 31 |
| Rota 31 | área | 1 | Rota 30, Violet, Dark Cave (Violet) |
| Dark Cave (Violet) | área | 1 | Rota 31 |
| Violet | cidade | 1 | Rota 31, Sprout Tower, Rota 32, Rota 36 |
| Sprout Tower | área | 1 | Violet |
| Rota 32 | área | 2 | Violet, Ruins of Alph, Union Cave |
| Ruins of Alph | área | 2 | Rota 32, Arredores das Ruínas |
| Union Cave | área | 2 | Rota 32, Rota 33, Union Cave (fundo) |
| Rota 33 | área | 2 | Union Cave, Azalea |
| Azalea | cidade | 2 | Rota 33, Slowpoke Well, Ilex Forest |
| Slowpoke Well | área | 2 | Azalea, Slowpoke Well (fundo) |
| Ilex Forest | área | 3 | Azalea, Rota 34 |
| Rota 34 | área | 3 | Ilex Forest, Goldenrod |
| Goldenrod | cidade | 3 | Rota 34, Rota 35 |
| Rota 35 | área | 4 | Goldenrod, National Park |
| National Park | área | 4 | Rota 35, Rota 36 |
| Rota 36 | área | 4 | National Park, Violet, Rota 37, Arredores das Ruínas |
| Rota 37 | área | 4 | Rota 36, Ecruteak |
| Ecruteak | cidade | 4 | Rota 37, Burned Tower, Tin Tower, Rota 38, Rota 42 |
| Burned Tower | área | 4 | Ecruteak |
| Rota 38 | área | 5 | Ecruteak, Rota 39 |
| Rota 39 | área | 5 | Rota 38, Olivine |
| Arredores das Ruínas | área | 5 | Ruins of Alph, Rota 36 |
| Olivine | cidade | 5 | Rota 39, Rota 40 (Surf) |
| Rota 40 / 41 | mar | 5 | Olivine, Whirl Islands, Cianwood (Surf) |
| Whirl Islands | área | 5 | Rota 40 / 41 |
| Cianwood | cidade | 5 | Rota 40 / 41 |
| Rota 42 | área | 6 | Ecruteak, Mt. Mortar, Mahogany |
| Mt. Mortar | área | 6 | Rota 42, Mt. Mortar (alto) |
| Mahogany | cidade | 6 | Rota 42, Rota 43, Rota 44 |
| Mt. Mortar (alto) | área | 7 | Mt. Mortar |
| Rota 43 | área | 7 | Mahogany, Lake of Rage |
| Lake of Rage | área (água) | 7 | Rota 43 |
| Rota 44 | área | 8 | Mahogany, Ice Path |
| Ice Path | área | 8 | Rota 44, Blackthorn |
| Blackthorn | cidade | 8 | Ice Path, Rota 45, Dragon's Den, Dark Cave (Blackthorn) |
| Dark Cave (Blackthorn) | área | 8 | Blackthorn, Dark Cave (Violet) |
| Dragon's Den | área (água) | 8 | Blackthorn |
| Rota 45 | área | 8 | Blackthorn, Rota 46 |
| Rota 27 | área | Liga | New Bark (Surf), Tohjo Falls |
| Tohjo Falls | área | Liga | Rota 27, Rota 26 |
| Rota 26 | área | Liga | Tohjo Falls, Victory Road |
| Victory Road | área | Liga | Rota 26, Indigo Plateau |
| Indigo Plateau | cidade | Liga | Victory Road, Rota 28 |
| Union Cave (fundo) | área | Liga | Union Cave (Surf) |
| Slowpoke Well (fundo) | área | Liga | Slowpoke Well (Surf) |
| Tin Tower | área | fim | Ecruteak |
| Rota 28 | área | fim | Indigo Plateau, Mt. Silver |
| Mt. Silver | área | fim | Rota 28 |

- **O jogador começa em New Bark.** Ligações com lugares de capítulo fechado aparecem apagadas: dá para ver o que vem depois.
- **Lugar só de água** (Lake of Rage, Dragon's Den, as rotas do mar) fica vazio até a parte 4 (ferramentas). Enquanto isso, não aparece ou aparece como "precisa de Surf".
- **Dados:** `trainers.current_place` (slug) e `trainer_places` (`user_id`, `place_slug`, `first_visit_at`) para visitados, Voo e o selo "novo". O config de lugares (`places.ts`) tem slug, nome, tipo, capítulo, texto, posição no mapa e vizinhos (com a ferramenta exigida, se houver). As áreas usam o mesmo slug das regiões de hoje. O servidor confere a viagem (vizinho aberto, ou Voo para cidade visitada) e o encontro (só no lugar atual).

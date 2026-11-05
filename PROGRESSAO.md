# Progressão do Pocket Meadow

Escrito em 2026-11-03 para repriorizar. O PLANNING.md tem a história das decisões e os detalhes de cada sistema; este arquivo é o mapa: o que existe, como as peças se ligam, quanto tempo a campanha leva e o que falta. Quando um número daqui mudar no código, atualizar aqui também.

## 1. O que existe hoje

| Sistema | Pilar | O que dá | O que pede / quando abre |
|---|---|---|---|
| Encontro, campo e luta ao vivo | mundo | XP de Pokémon e de treinador, captura, drops (bolas, sementes) | nada |
| Captura (arremesso) | mundo | Pokémon, XP de treinador | bolas |
| Jornada: 40 áreas em 10 capítulos, mapa, Voo | mundo | espécies, ferramentas | marcos |
| Ferramentas (vara, Headbutt, Surf, Rock Smash, Voo) | mundo | espécies novas, Apricorn, berries, bolas | marco e um Pokémon do tipo no time |
| Marcos e líderes (8 + Liga) | mundo | capítulo seguinte, ferramentas | **nível de treinador** (3, 6, 9… 24, 30) e vencer o líder |
| Pokédex e álbum | coleção | recompensas por bloco completo | capturas |
| Missões do dia (3 + baú) | volta | XP de treinador, doces, bolas, sementes, Apricorns | nada (renovam à meia-noite) |
| Pets: fome, carinho, felicidade | jardim | XP no jardim, presentes no chão | berries, toques |
| Horta: arbustos que frutificam e secam | jardim | berries; semente ao limpar o seco | sementes; canteiros no nível 1, 1, 8, 20 |
| Árvores de Apricorn (vermelha, azul, amarela) | jardim | Apricorns | treinador nível 2; bancada nível 2 e 3 |
| Bancada de bolas (3 níveis) | jardim | Poké, Great e Ultra Balls | operador; melhoria pede treinador 6 e 12 e itens |
| Daycare + cuidador | jardim | níveis rápidos (alcance até ×4, cuidador até ×2) | vagas no nível 1, 5, 15, 30 |
| Clima do dia | enfeite | berries crescem mais rápido; chuva acelera Apricorn | nada |
| Aviso de "pronto" | volta | lembra o que está esperando | nada |
| Energia | freio | — | **desligada** desde 2026-10-29 |

## 2. Como a progressão funciona hoje (números)

**Um só portão:** o capítulo seguinte pede nível de treinador (o marco) e vencer o líder. O líder pede um time no nível do ás.

**XP de treinador acumulado** (curva `30 × nível^1,7`): nível 3 = 321, 6 = 1.729, 9 = 4.832, 12 = 10.152, 15 = 18.159, 18 = 29.289, 21 = 43.958, 24 = 62.557, 30 = 113.035.

**De onde vem esse XP:** vitória `8 + 2 × nível do selvagem`, captura `10 + nível`, evolução 30 ou 60, missões `15 + 3 × nível` cada e o baú `40 + 6 × nível`. **O jardim não dá XP de treinador**, só as missões de jardim (que valem igual às outras).

**Simulação da campanha atual** (uma luta ≈ 1,5 min contando achar o encontro; captura em 1 de cada 3):

| Cap. | Treinador | Lutas pelo XP do treinador | Ás do líder | Lutas para 1 Pokémon chegar ao ás |
|---|---|---|---|---|
| 1 | 1 → 3 | 7 | 9 | 20 |
| 2 | 3 → 6 | 38 | 16 | 77 |
| 3 | 6 → 9 | 81 | 20 | 66 |
| 4 | 9 → 12 | 117 | 25 | 69 |
| 5 | 12 → 15 | 136 | 30 | 34 |
| 6 | 15 → 18 | 218 | 35 | 81 |
| 7 | 18 → 21 | 232 | 31 | 0 |
| 8 | 21 → 24 | 258 | 40 | 67 |
| 9 | 24 → 30 | 623 | 45 | 44 |

Total: uns **1.760 encontros, ~44 h de luta ativa**. As missões do dia (3 + baú) valem de 130 a 535 XP conforme o nível, o que equivale a umas 7 lutas em qualquer capítulo: quase nada perto do que cada capítulo pede.

## 3. Diagnóstico

1. **O portão é o XP de treinador, e ele só sai de luta.** Do capítulo 3 em diante, o nível de treinador pesa mais que o nível do time: no capítulo 9 são 623 lutas só para subir de 24 para 30.
2. **O jardim não empurra a jornada.** Tudo o que o jardim produz (berries, bolas, níveis no daycare, presentes) ajuda a luta, mas não conta para o marco. O jogador que cuida do jardim e volta várias vezes ao dia não avança mais do que quem só luta. Isso contradiz o pilar "mais idle".
3. **A curva do treinador acelera mais que a renda.** Cada capítulo pede ~1,6× o anterior, mas a renda por luta só cresce com o nível do selvagem.
4. **Saltos de nível dos líderes:** do selvagem do capítulo 2 (média 6) para o ás da Bugsy (16) são 10 níveis; o daycare novo resolve parte disso.
5. **Desbloqueios soltos:** canteiros, vagas do daycare e melhorias da bancada abrem por nível de treinador em números sem relação com os capítulos (8, 15, 20, 30), e o jogador não sabe o que vem a seguir.
6. **Sem meta de capítulo visível:** o painel do marco não diz quanto falta nem o caminho.

## 4. Modelo decidido (2026-11-03)

Decidido com o usuário depois do diagnóstico:

- **Johto em ~3 semanas** para quem joga algumas vezes por dia.
- **O marco é só o líder.** Sem nível de treinador nem captura como requisito: quem monta um time bom avança, mesmo no nível 1. O portão da jornada é o time e a habilidade na luta.
- **Quem joga mais avança mais rápido.** Sem retorno decrescente nas lutas.
- **A exploração gasta recursos, e os recursos vêm principalmente do jardim.** O jardim ancora a jornada: sem cuidar dele, não dá para explorar muito.
- **Captura mais difícil,** para gastar mais bolas (que vêm da bancada).
- **Jardim um pouco mais lento,** para os recursos terem valor.

### 4.1 O ciclo

```
jardim (horta, árvores, bancada, daycare) ──recursos──▶ exploração (encontros, captura)
      ▲                                                        │
      └──── Pokémon, materiais, espécies, ferramentas ◀────────┘
                               │
                     time melhor ──▶ líder (marco) ──▶ capítulo novo
                                                       (áreas, ferramentas, desbloqueios do jardim)
```

### 4.2 Os recursos da exploração (decididos em 2026-11-03)

- **Energia por campo revelado, não por luta.** Revelar um campo (abrir o campo de uma área ou "Explorar de novo") gasta 1 de energia; todos os Pokémon daquele campo podem ser enfrentados com ela. A energia volta devagar sozinha e rápido com berries (a Oran já restaura energia).
- **HP que não volta sozinho.** O time termina a luta machucado e o HP fica. Cura: berries, descanso no jardim (por tempo) e uma **máquina de cura** no jardim, como a do Pokécenter, que acelera. Desmaiado não descansa: fica em 0 por 2 h em qualquer lugar (jardim, time, daycare, PC) e volta com 10% de HP; só então o descanso do jardim segue. A máquina cura na hora, desmaiado incluso, e limpa o desmaio. Incentiva ter dois times para revezar.
- **Pokémon com fome não luta.** A colheita passa a render mais berries e entra um jeito de alimentar vários de uma vez; o jogador divide as berries entre o que usa na exploração (energia, cura) e o que dá aos pets.
- **Bolas:** captura mais difícil; as bolas vêm principalmente da bancada.

### 4.2.1 O que cada lado precisa do outro

| A exploração gasta | Vem do jardim |
|---|---|
| energia por campo revelado | berries da horta (Oran), recarga lenta por tempo |
| HP do time | berries, descanso no jardim, máquina de cura |
| pets alimentados para lutar | berries da horta |
| bolas, mais na captura difícil | bancada (Apricorns das árvores) |
| tempo de treino do time | daycare e cuidador |

| O jardim precisa | Vem da exploração |
|---|---|
| sementes novas | lutas, Headbutt, presentes |
| operador e cuidador de espécies certas | captura |
| desbloqueios (vagas, níveis da bancada, árvores) | marcos (líderes vencidos) |
| Apricorns extras | Headbutt |

### 4.3 Construção do jardim (decidido em 2026-11-03)

Substitui a tabela antiga de "desbloqueio por marco" (cada estrutura abria uma vez, numa casa fixa). O jardim vira um jogo de montar:

- **Inventário de construção**, separado da mochila: estruturas (bancada, máquina de cura, árvores de Apricorn, canteiro), e depois peças de habitat (chão e objetos, 5.22) e decoração.
- **Cada peça colocada é uma instância**, com posição e estado próprios: duas máquinas de cura têm cargas separadas; duas bancadas têm operador, lote e nível separados.
- **Colocar, mover e guardar:** no modo de construção o jogador põe a peça em qualquer casa livre do jardim, move e guarda de volta no inventário. Guardar uma estrutura com trabalho em andamento pede confirmação (ou espera esvaziar).
- **O marco dá a receita e uma unidade.** A primeira vem pronta; as próximas se constroem com materiais (receita por peça, no config). Os materiais vêm da exploração (Apricorn, berries, e materiais novos como pedra do Rock Smash e madeira do Headbutt).
- **Canteiro não se constrói:** o marco só sobe o limite de canteiros colocados no jardim.
- **Sem moeda e sem loja por enquanto** (fica para o futuro).
- **Quem já joga:** o que existe hoje vira instância nas mesmas casas; nada some.

Proposta inicial (números a fechar no item 7):

| Marco | Ganha (1 unidade + receita) | Canteiros |
|---|---|---|
| Início | bancada, árvore vermelha, máquina de cura | 4 |
| 1 Violet | — | 4 |
| 2 Azalea | receita da árvore vermelha | 6 |
| 3 Goldenrod | árvore azul; bancada pode subir ao nível 2 (Great Ball) | 6 |
| 4 Ecruteak | — | 8 |
| 5 Cianwood | receita da máquina de cura | 8 |
| 6 Olivine | árvore amarela; bancada pode subir ao nível 3 (Ultra Ball) | 10 |
| 7 Mahogany | primeiras peças de habitat (5.22) | 10 |
| 8 Blackthorn | receita da bancada | 12 |
| Liga | (visitantes) | 12 |

As vagas do daycare (que não é uma peça do jardim) passam a abrir por marco também: 1 no início, 2ª na Azalea, 3ª na Cianwood, 4ª na Blackthorn.

O nível de treinador continua existindo (XP, recompensas de nível), mas não trava nada do jardim.

## 5. O que falta construir (em ordem)

1. ~~**Marco = só o líder**~~ (feito em 2026-11-03).
2. ~~**Energia por campo revelado**~~ (feito em 2026-11-03): chegar numa área não revela nada; "Revelar campo" gasta 1 e as lutas daquele campo saem de graça; procurar no mato e usar mancha (pesca, árvore, pedra) gastam 1; líder não gasta. Máximo 10, volta 1 a cada 15 min (era 1 por hora até 2026-11-04); a Oran dá +2.
2.1. ~~**Desmaio pausa a luta**~~ (feito em 2026-11-03): no manual, quando o Pokémon do jogador desmaia, a luta pausa e pergunta quem entra; no automático também pausa, com 4 s para escolher; sem toque, entra o próximo vivo e a luta segue.
3. ~~**Fome trava a luta**~~ (feito em 2026-11-03): com fome abaixo de 20 (`fightMinHunger`) o Pokémon fica fora do time da luta (todos famintos: não há luta); cada luta tira 8 de fome de quem entrou (`battleHungerCost`); colheita com +2 berries; "Alimentar todos" (`POST /garden/pets/feed-all`) dá 1 berry a cada um, do mais faminto ao menos; abre pelo aviso "N com fome" e antes da luta ("Alimentar o time").
4. ~~**HP persistente e máquina de cura**~~ (feito): HP fica depois da luta; cura por descanso no jardim e pela máquina de cura (estrutura do jardim; 1 carga cura a equipe toda; liberada desde o início). Desmaiado não descansa: volta sozinho em 2 h com 10% de HP, em qualquer lugar; a máquina limpa o desmaio na hora. Berry de HP fica para depois.
5. ~~**Captura mais difícil e bolas vindo da bancada**~~ (feito em 2026-11-03): `catchMult` de 1,2 para 0,8 (capture rate 255 sai em 80%, 190 em 60%, 45 em 14%); começa com 15 Poké Balls (eram 30); vencer selvagem não dá mais bola; nível de treinador, missões e baú trocam bola por Apricorn (nível: 2 vermelhos, 2 azuis a cada 5, 2 amarelos a cada 10; missão comum: 2 vermelhos; captura nova: 1 Great e 1 azul; baú: 1 Great, 3 vermelhos e 2 azuis); presentes com menos bolas (pesos 40/10 para 15/4). Pedra (Rock Smash) e Pokédex ficam como estavam.
6. **Construção do jardim** (4.3), em passos:
   1. ~~Inventário de construção e peças com posição~~ (feito em 2026-11-03): tabela `garden_placements` (uma estrutura de cada por enquanto; canteiros com `slot`), migração preguiçosa no catch-up (o que existe fica nas casas de antes), estrutura que abre vai sozinha para a casa de sempre se estiver livre, modo Construir no jardim (colocar, mover, guardar), peça guardada para de produzir, passeio desvia de qualquer peça. Duas da mesma estrutura (estado por instância) entram no passo 2, junto com as receitas.
   2. ~~Marcos dão peças, receitas e o limite de canteiros~~ (feito em 2026-11-04), em três partes:
      - 2a: o jardim abre pelos marcos (`config/gardenUnlocks`), não pelo nível de treinador; a tabela do 4.3 vale para peças, canteiros, vagas do daycare e nível máximo da bancada. A bancada vem desde o começo (sem ela, faltaria bola e o jogo travaria).
      - 2b: cada estrutura é uma peça com estado próprio (`garden_structures.id`): duas bancadas têm operador, lote e nível separados (o mesmo Pokémon não opera duas); duas máquinas têm cargas separadas (a cura antes da luta usa a de mais cargas).
      - 2c: materiais novos (madeira do Headbutt e pedra do Rock Smash, 2 a 4 por vez) e receitas (`config/buildRecipes`): árvore vermelha (Azalea; 10 madeiras, 5 Apricorns, 3 Oran; 1 h), máquina de cura (Cianwood; 10 pedras, 5 madeiras, 5 Oran; 2 h), bancada (Blackthorn; 15 madeiras, 10 pedras, 10 Apricorns; 4 h). Construir leva tempo, uma obra por vez, e para no teto do tipo: árvore vermelha 1 → 2 (Azalea) → 3 (Ecruteak), máquina 1 → 2 (Cianwood), bancada 1 → 2 (Blackthorn). Números de partida; o balanço é do item 7.
   3. Peças de habitat por cima disso, com o motor que já está na branch `feat/habitats`.
7. **Ritmo do jardim e simulação da campanha** para fechar ~3 semanas, com a simulação virando script. **Tabela base aplicada em 2026-11-04** (seção 7), com a conta em `npm run economia` (server/scripts/economia.ts); tempo da campanha medido no mesmo script (seção 7.1: ~12 dias de treino até a Blackthorn); falta conferir jogando.
8. **Habitats (5.22)** e **visitantes**, do capítulo 7 em diante.
9. **Liga, rival e pós-jogo.**

**Para depois (anotado):** breed, com sorteio de sexo (macho/fêmea; alguns sprites mudam com o sexo, então o sprite tem de respeitar isso) e ovos personalizados (muda só a cor do ovo), com ninho e incubadora no jardim.

## 6. Pontos a decidir

- ~~Teto por estrutura de produção~~: decidido em 2026-11-04: o marco sobe quantas de cada dá para ter (passo 2c).
- ~~Quanto material cai no campo e quanto as receitas custam~~: tabela base em 2026-11-04 (seção 7), a ajustar jogando.
- ~~Quanto mais lento o jardim fica e quantas berries a colheita passa a dar~~: tabela base em 2026-11-04 (seção 7), a ajustar jogando.
- ~~A máquina de cura~~: decidido em 2026-11-03: cura na hora, com usos limitados que recarregam com o tempo.

## 7. Ritmo base (item 7, 2026-11-04)

Valores de partida, para ajustar jogando. A conta sai de `npm run economia` (server/scripts/economia.ts), que lê os configs: quando um número mudar, rodar de novo e atualizar a tabela de baixo.

**Jogador de referência:** 4 sessões por dia de ~12 min, uma a cada ~4 h, e a noite de 8 h; Johto em ~21 dias (9 capítulos, ~2,3 dias cada). Uma luta leva ~1,5 min contando achar o encontro, então cabem ~32 lutas por dia: **o tempo limita antes da energia** (que daria 88). Da energia, 70% vai para revelar campo e 30% para as manchas (árvore e pedra, quando abrem); tenta capturar 1 de cada 3 Pokémon; o time cresce de 2 (cap. 1) a 6 (cap. 5); metade dos canteiros com Oran.

**O que mudou:**

| Número | Antes | Agora | Por quê |
|---|---|---|---|
| Chance de item na mancha (árvore, pedra) | 30% | 50% | o material saía lento demais (~30 Headbutts para 10 madeiras) |
| Madeira no Headbutt | peso 75, 2 a 4 | peso 125, 3 a 5 | ~0,9 madeira por uso |
| Pedra no Rock Smash | peso 100, 2 a 4 | peso 150, 3 a 5 | ~1,2 pedra por uso |
| Receita da árvore vermelha | 10 madeiras, 5 Apricorns, 3 Oran | 8, 4, 3 | ~9 usos de Headbutt, meio dia de energia |
| Receita da máquina de cura | 10 pedras, 5 madeiras, 5 Oran | 8, 4, 5 | ~11 usos |
| Receita da bancada | 15 madeiras, 10 pedras, 10 Apricorns | 12, 10, 10 | ~22 usos, a peça mais cara |
| Fome do pet | zera em 12 h | zera em 16 h | a noite deixa a barriga pela metade; o gasto principal passa a ser a luta |
| Fome por luta | 8 | 6 | com o time pequeno do começo, a horta empata com a fome |
| Oran | 30 min | 1 h | jardim um pouco mais lento; com sessões a cada 4 h, quase não muda para quem joga pouco |
| Árvore vermelha | 1 a cada 3 h | 1 a cada 2h30 | bolas do começo quase empatam com a vontade de capturar |
| Descanso (HP 0 → cheio) | 2 h | 4 h | o HP vale alguma coisa entre sessões |
| Recarga da máquina de cura | 3 h por carga | 6 h por carga | 4 curas da equipe por dia por máquina (eram 8) |

**Conta por dia** (entra / sai), com as ~32 lutas que cabem no tempo (energia a 1 a cada 15 min desde 2026-11-04):

| Cap. | Energia | Lutas | Manchas | Madeira | Pedra | Berries | Bolas | Curas |
|---|---|---|---|---|---|---|---|---|
| 1 | 40 | 32 | 0 | 0 | 0 | 30 / 15 | 37 / 14 | 4 |
| 2 | 40 | 32 | 0 | 0 | 0 | 30 / 18 | 37 / 15 | 4 |
| 3 | 40 | 32 | 12 | 11 | 0 | 45 / 22 | 40 / 16 | 4 |
| 4 | 40 | 32 | 12 | 11 | 0 | 45 / 26 | 59 / 17 | 4 |
| 5 | 40 | 32 | 12 | 5,5 | 7 | 59 / 30 | 77 / 18 | 4 |
| 6 | 40 | 32 | 12 | 5,5 | 7 | 59 / 30 | 77 / 19 | 8 |
| 7 | 40 | 32 | 12 | 5,5 | 7 | 74 / 30 | 77 / 20 | 8 |
| 8 | 40 | 32 | 12 | 5,5 | 7 | 74 / 30 | 77 / 22 | 8 |
| 9 | 40 | 32 | 12 | 5,5 | 7 | 89 / 30 | 77 / 24 | 8 |

Berries: Oran dos canteiros contra a fome do time (o dia e as lutas). Bolas: Poké Balls das árvores vermelhas (todas as que o teto deixa), do Headbutt e das missões, limitadas pela bancada, contra as tentativas de captura. Curas: cargas da máquina por dia.

Com a energia a 15 min, ela quase não limita: dariam ~160 lutas por dia, então o freio de verdade é o tempo de jogo. Quem joga ~2 h por dia (88 lutas) fica perto do empate nos capítulos 1 e 2 (berries 30 / 27, bolas 37 / 39) e com sobra do 3 em diante; quem joga mais que isso passa a esbarrar em berries e bolas, não na energia.

**Leitura:**
- Para o jogador de referência, berries e bolas sobram em todos os capítulos (o dobro do uso): o aperto só aparece para quem gasta a energia toda. Se a captura tiver de pesar mais para quem joga pouco, o caminho é cortar a produção (árvore vermelha de volta a 3 h, missões com menos Apricorn), não a energia.
- A conta não desconta os Apricorns das receitas e das melhorias da bancada (15 e 30), nem as Great e Ultra, que dividem o tempo da bancada.
- Madeira e pedra: com mais energia sobrando para as manchas, uma receita a cada 1 a 2 dias, o que fecha com o teto de peças subindo por marco.
- Não entra na conta: presentes do chão, nível de treinador, sementes e as berries de captura.

### 7.1 Tempo da campanha

O mesmo script anda hora a hora com o time: XP das lutas no mato do capítulo (fórmula da luta, com o nível de cada um), do daycare (as vagas do marco, os mais baixos do time, com o bônus de alcance e um cuidador ×1,25 do capítulo 2) e do jardim (pet com felicidade 80). O capítulo acaba quando o time tem **tantos membros quanto o líder, cada um no ás − 2**; quem falta entra capturado no nível médio do mato.

| Cap. | Líder (ás) | Alvo | Selvagem | Time no início | Dias | Lutas | Luta | Daycare | Jardim |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Violet (9) | 2 × 7 | 3 | 5, 3 | 0,9 | 29 | 54% | 36% | 10% |
| 2 | Azalea (16) | 3 × 14 | 6 | 9, 7, 6 | 2,3 | 75 | 48% | 37% | 14% |
| 3 | Goldenrod (20) | 2 × 18 | 8 | 14, 14 | 1,3 | 40 | 45% | 47% | 7% |
| 4 | Ecruteak (25) | 4 × 23 | 12 | 18, 18, 14, 12 | 2,6 | 83 | 32% | 60% | 8% |
| 5 | Cianwood (30) | 2 × 28 | 19 | 23, 23 | 1,0 | 33 | 52% | 44% | 4% |
| 6 | Olivine (35) | 3 × 33 | 14 | 29, 28, 23 | 2,4 | 76 | 25% | 70% | 5% |
| 7 | Mahogany (31) | 3 × 29 | 23 | 33, 33, 33 | 0 | 0 | — | — | — |
| 8 | Blackthorn (40) | 4 × 38 | 23 | 33, 33, 33, 23 | 1,8 | 57 | 22% | 76% | 2% |

**Total até a Blackthorn: ~12 dias** de treino, contra ~19 do alvo (8 × 2,3). A Liga ainda não tem time no config e fica fora.

**Leitura:**
- O treino sozinho fecha em ~2/3 do alvo. O resto do tempo é o que a conta não vê: abrir as áreas do capítulo, capturar as espécies, pegar o tipo certo para as ferramentas, perder para o líder e tentar de novo. Por isso **não mexer no XP ainda**: primeiro ver jogando quanto tempo isso leva.
- Os capítulos alternam: 2, 4 e 6 levam ~2,5 dias (o líder tem 3 ou 4 Pokémon, ou o salto de nível é grande); 1, 3 e 5 levam ~1 dia (2 Pokémon). O 7 sai de graça: o ás de Mahogany (31) é mais baixo que o de Olivine (35), como no Crystal.
- O daycare carrega a segunda metade: de 60% a 76% do XP do capítulo 4 em diante. Combina com o jardim no centro; se pesar demais, a alavanca é `levelsPerHour` (hoje 4 níveis por dia).
- Se depois de jogar faltar tempo: subir o ás dos capítulos rápidos (1, 3, 5, 7) ou cortar o daycare. Se sobrar: o contrário. O XP da luta fica por último, porque mexe em tudo.

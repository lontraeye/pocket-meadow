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

## 4. Proposta

### 4.1 A meta da campanha

Johto inteira (8 marcos + Liga) em **3 a 4 semanas** de um jogador que abre o jogo 3 a 5 vezes por dia, em sessões de 5 a 10 minutos (~30 a 45 min por dia), mais o que o jardim produz sozinho entre as visitas. Na média, **2 a 3 dias por capítulo**, crescendo um pouco no fim. Quem joga mais (lutas seguidas) chega antes, mas o teto diário vem das coisas que rendem por tempo.

### 4.2 Uma moeda de progresso: XP de treinador vindo dos dois lados

O marco continua pedindo nível de treinador (é simples e já existe). O que muda é **de onde vem o XP**:

| Fonte | Hoje | Proposta |
|---|---|---|
| Luta e captura | única fonte relevante | continua, com retorno decrescente no dia (a partir de N lutas, metade do XP), para a luta não ser o único caminho |
| Missões do dia + baú | ~7 lutas por dia | a fonte principal do dia: ~40% do que um capítulo pede em 2 a 3 dias |
| Jardim | nada | colher (horta e Apricorn), coletar lote da bancada, cuidar dos pets, terminar estadia no daycare: XP pequeno e com teto diário |
| Pokédex e álbum | itens | também XP de treinador por bloco |

Com isso, a curva do treinador é recalibrada para a renda de um dia típico (seção 4.4), em vez de ser só `30 × nível^1,7`.

### 4.3 Meta de capítulo: o marco vira uma lista curta

Cada marco mostra **o que falta**, com 3 a 4 itens, um de cada pilar:

- nível de treinador N (como hoje);
- **mundo:** capturar X espécies das áreas do capítulo;
- **jardim:** uma meta que puxa um sistema do capítulo (ex.: colher 10 berries, fazer um lote de Great Balls, deixar um Pokémon no daycare até o fim);
- vencer o líder.

O painel do marco lista isso com progresso, como as missões. Assim o jogador sempre sabe o próximo passo (pilar 4 do PLANNING), e o jardim faz parte da jornada.

### 4.4 Desbloqueios amarrados aos capítulos

Cada marco abre algo do jardim, para o mundo também empurrar o jardim:

| Marco | Mundo (hoje) | Jardim (proposta) |
|---|---|---|
| Início | — | horta (2 canteiros), daycare (1 vaga), árvore vermelha e bancada (nível 2 de treinador) |
| 1 Violet | — | 3º canteiro |
| 2 Azalea | Old Rod, Headbutt | 2ª vaga do daycare; cuidador |
| 3 Goldenrod | — | melhoria da bancada nível 2 (Great Ball) e árvore azul |
| 4 Ecruteak | Surf, Rock Smash | 4º canteiro |
| 5 Cianwood | Good Rod, Voo | 3ª vaga do daycare |
| 6 Olivine | — | melhoria da bancada nível 3 (Ultra Ball) e árvore amarela |
| 7 Mahogany | — | (habitats: primeiro bioma) |
| 8 Blackthorn | Super Rod | 4ª vaga do daycare; (habitats: mais biomas) |
| Liga | — | (visitantes) |

Os itens entre parênteses dependem de sistemas que ainda não existem.

### 4.5 Estimativa com a proposta

Um dia típico no meio do jogo (capítulo 5), por fonte:

| Fonte | Por dia |
|---|---|
| ~20 lutas e algumas capturas | ~900 XP |
| 3 missões + baú | ~900 XP (com o novo peso) |
| Jardim (colheitas, lotes, pets, daycare) | ~500 XP (com teto) |
| **Total** | **~2.300 XP** |

Para 2 a 3 dias por capítulo, cada capítulo deveria pedir ~5.000 a 7.000 XP no meio do jogo, contra os 8.000 a 11.000 de hoje no capítulo 5 e os 50.000 do capítulo 9. Isso dá **~25 dias para Johto**, e a luta deixa de ser o único caminho. Os números finais saem do primeiro playtest de uma semana.

## 5. O que falta construir (em ordem)

1. **Painel do marco com "o que falta"** (lista do 4.3, só com o que já dá para medir: nível, espécies do capítulo, líder). Pequeno; dá a meta visível.
2. **XP de treinador do jardim e do álbum** (4.2), com teto diário. Pequeno; usa o registro de ações que já existe.
3. **Recalibrar a curva do treinador e o peso das missões** (4.5), com a simulação deste arquivo virando um teste/script para repetir.
4. **Desbloqueios do jardim por marco** (4.4), no lugar dos níveis soltos.
5. **Metas de jardim no marco** (4.3), usando os mesmos tipos das missões.
6. **Habitats (5.22)** e **visitantes**, que entram nos capítulos 7 em diante.
7. **Liga, rival e pós-jogo** (capítulo 10: Tin Tower, Mt. Silver), quando a campanha principal estiver redonda.

## 6. Pontos a decidir

- O alvo de 3 a 4 semanas para Johto (mais curto deixa o jogo raso; mais longo vira grind).
- Retorno decrescente nas lutas do dia: sim ou não, e a partir de quantas.
- Se o marco continua pedindo só nível de treinador, ou passa a pedir a lista do 4.3.
- A energia segue desligada; o freio passa a ser o teto diário das fontes de XP.

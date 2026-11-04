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
- **HP que não volta sozinho.** O time termina a luta machucado e o HP fica. Cura: berries, descanso no jardim (por tempo) e uma **máquina de cura** no jardim, como a do Pokécenter, que acelera. Incentiva ter dois times para revezar.
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
2. ~~**Energia por campo revelado**~~ (feito em 2026-11-03): chegar numa área não revela nada; "Revelar campo" gasta 1 e as lutas daquele campo saem de graça; procurar no mato e usar mancha (pesca, árvore, pedra) gastam 1; líder não gasta. Máximo 10, volta 1 por hora; a Oran dá +2.
2.1. ~~**Desmaio pausa a luta**~~ (feito em 2026-11-03): no manual, quando o Pokémon do jogador desmaia, a luta pausa e pergunta quem entra; no automático também pausa, com 4 s para escolher; sem toque, entra o próximo vivo e a luta segue.
3. ~~**Fome trava a luta**~~ (feito em 2026-11-03): com fome abaixo de 20 (`fightMinHunger`) o Pokémon fica fora do time da luta (todos famintos: não há luta); cada luta tira 8 de fome de quem entrou (`battleHungerCost`); colheita com +2 berries; "Alimentar todos" (`POST /garden/pets/feed-all`) dá 1 berry a cada um, do mais faminto ao menos; abre pelo aviso "N com fome" e antes da luta ("Alimentar o time").
4. ~~**HP persistente e máquina de cura**~~ (feito): HP fica depois da luta; cura por descanso no jardim e pela máquina de cura (estrutura do jardim; 1 carga cura a equipe toda; liberada desde o início). Berry de HP fica para depois.
5. ~~**Captura mais difícil e bolas vindo da bancada**~~ (feito em 2026-11-03): `catchMult` de 1,2 para 0,8 (capture rate 255 sai em 80%, 190 em 60%, 45 em 14%); começa com 15 Poké Balls (eram 30); vencer selvagem não dá mais bola; nível de treinador, missões e baú trocam bola por Apricorn (nível: 2 vermelhos, 2 azuis a cada 5, 2 amarelos a cada 10; missão comum: 2 vermelhos; captura nova: 1 Great e 1 azul; baú: 1 Great, 3 vermelhos e 2 azuis); presentes com menos bolas (pesos 40/10 para 15/4). Pedra (Rock Smash) e Pokédex ficam como estavam.
6. **Construção do jardim** (4.3), em passos:
   1. Inventário de construção e instâncias com posição: o que existe vira peça colocada (migração), modo de construção para colocar, mover e guardar; canteiros soltos com limite.
   2. Marcos dão peças, receitas e o limite de canteiros (a tabela do 4.3); materiais novos (pedra, madeira) e as receitas; vagas do daycare por marco.
   3. Peças de habitat por cima disso, com o motor que já está na branch `feat/habitats`.
7. **Ritmo do jardim e simulação da campanha** para fechar ~3 semanas, com a simulação virando script.
8. **Habitats (5.22)** e **visitantes**, do capítulo 7 em diante.
9. **Liga, rival e pós-jogo.**

**Para depois (anotado):** breed, com sorteio de sexo (macho/fêmea; alguns sprites mudam com o sexo, então o sprite tem de respeitar isso) e ovos personalizados (muda só a cor do ovo), com ninho e incubadora no jardim.

## 6. Pontos a decidir

- Teto por estrutura de produção (bancada, árvore): sem teto, quem junta material faz muitas e as bolas perdem valor. Proposta: o marco também sobe quantas de cada dá para ter.
- Quanto mais lento o jardim fica e quantas berries a colheita passa a dar (sai do balanço do item 7).
- ~~A máquina de cura~~: decidido em 2026-11-03: cura na hora, com usos limitados que recarregam com o tempo.

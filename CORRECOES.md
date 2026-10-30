# Correções diversas

Branches de ajustes soltos — bugs de UI, regras de XP, polimentos — **fora** das fases do roadmap (`PLANNING.md`). Cada item entra aqui ao ser feito; o PR final resume a lista.

**Como usar:** uma correção (ou grupo bem pequeno) por commit, mensagem no estilo do repo (português, foco no porquê). Atualizar esta lista no mesmo commit.

---

## `fix/correcoes` (out/2026, lote 30/10)

### Campo de encontro

- [x] **Depois da luta, volta ao campo** — luta começada no campo termina com "Voltar ao campo" (e "Ir ao jardim" como link), em vez de mandar direto ao jardim.
- [x] **Campo não se repõe sozinho** — quem foi enfrentado sai e a vaga fica vazia; os outros continuam. O campo só enche ao chegar na área (se estiver vazio) ou pelo **"Explorar de novo"** (`POST /field/explore`), que só aparece e só vale com o campo vazio (`field_not_empty` se não estiver).

### Mapa

- [x] **Caminhar até lugares distantes** — tocar num lugar longe mostra "Caminhar até X · N pontos" (menor caminho pelos caminhos abertos). O boneco anda sozinho, ponto a ponto (~0,9 s por ponto, com pulinho), e o mapa acompanha. Cada passo é um `travel` ao vizinho, então o servidor confere tudo. Dá para parar no meio. Toque duplo também caminha. Cidade com Voo continua com "Voar" (e "Caminhar" como alternativa).

### Pokédex

- [x] **Nome das bolas nas recompensas** — o resgate mostrava `ball:poke`, `ball:great`: o `rewardLine` não passava a lista de bolas para o `itemLabel`. Agora sai "Poké Ball ×5".

### Luta

- [x] **Botão 2x** — ao lado do Auto, acelera o relógio da luta (simulação, timer e recargas) para o dobro; fica lembrado no aparelho (`pm-battle-speed`). O servidor aceita até `simConfig.maxSpeed` (2): o `finish_too_early` passa a conferir `tempo real × 2`. Ao retomar uma luta acelerada, começa do último toque salvo. As animações seguem no ritmo normal.

### Mapa (visual)

- [x] **Jornada ganha a tela** — no mapa e no campo, a barra do topo (nível, energia, ícones) some; volta na luta e nas outras telas.
- [x] **Marco por cima do mapa** — o painel do marco abre sobreposto ao mapa (não muda o tamanho dele) e tem ▴ para recolher; recolhido vira um botão "🚩 Marco de …" no canto (pisca com "!" quando dá para desafiar). Lembrado no aparelho (`pm-goal-open`). Título sozinho na linha e a ação ("Desafiar"/"Vá até") ao lado do nível, para caber em 320 px.
- [x] **Painel do lugar flutua sobre o mapa** — o mapa ocupa a altura toda e nunca muda de tamanho; o painel (espécies, viagem) fica por cima, embaixo, do tamanho do conteúdo (sem espaço sobrando). O mapa sabe quanto está coberto (`bottomInset`): centraliza você no meio da parte visível, desliza se o painel cobrir o lugar escolhido e ganha espaço extra embaixo para rolar até o fim. No campo, o painel tem altura fixa.
- [x] **Treinador segue o caminho** — ao viajar, o boneco passa pela quina do caminho em "L" (cada trecho com tempo proporcional ao comprimento), em vez de cortar na diagonal por cima das árvores.
- [x] **Sem seleção de texto** — toques rápidos no mapa não selecionam os nomes das placas.
- [x] **Pixel art** — gramado em tiles, caminhos de terra em "L" (só horizontal/vertical), árvores no vazio (sempre nas mesmas casas), casinha nas cidades, mato alto nas rotas, caverna, torre, floresta, água, placas com o nome, cursor piscando na seleção, setinha nos vizinhos abertos e um treinador no lugar do marcador. Desenhos originais em `web/src/lib/mapSprites.ts` (sem asset de fora). Para não engasgar ao arrastar: gramado e árvores viram uma imagem só (canvas), cada desenho vira uma imagem pequena, lugares fechados usam uma versão já apagada (sem filtro CSS) e o mapa tem camada própria.

### Tipos

- [x] **Journey: `data` possivelmente nulo** no resgate do marco — o único erro do `svelte-check`.

---

## `fix/correcoes-out-29` (out/2026)

### XP de batalha (estilo jogos)

- [x] **Quem recebe XP** — só quem **entrou em campo e não desmaiou**. Bench (ficou na pokébola) e KO ficam de fora. O XP é **dividido entre esses** (`battleXpSharers` + `fighterXp`), não pelo tamanho do time inteiro. EVs seguem a mesma regra. **Exp Share** (item) fica anotado no PLANNING para depois.
- [x] **Painel pós-luta** — ao acabar, golpes/troca somem e entra uma caixa de texto no estilo dos jogos, avançando **só com toque**:
  1. selvagem desmaiou (ou derrota)
  2. cada um que ganhou XP (`X ganhou N de XP!`) — a barra azul anima só se for o Pokémon em campo
  3. level up, se houver
  4. semente / recompensas de nível (reserva do “dinheiro”)
- [x] **Barra azul de XP** — colada sob a de HP no plate aliado (fina, sem números), parada durante a luta; enche no passo de XP do painel.
- [x] **Highlights sem XP** — o modal depois da luta não repete a distribuição de XP; fica golpe novo / pode evoluir / XP de treinador. Semente e itens de nível já passaram no painel da luta.

### HUD e configurações

- [x] **Ícones no menu superior** — Pokédex, Mochila e Config em ícones pixel 12×12. Escala **24px** (×2 inteiro) para os pixels não saírem com larguras diferentes.
- [x] **Config** — abre modal (`Modal` com `fullMobile`: tela cheia no celular). Por agora: volume + silenciar + **Sair da conta**. Fecha no ✕ ou no fundo (desktop). Volume e Sair saíram do HUD.

### UI / jardinagem / ficha (mesmo lote)

- [x] **Modal reutilizável** — `web/src/lib/Modal.svelte` no `document.body` (não fica preso em `transform` da Pokédex). Destaques (`Highlights`) e Config usam.
- [x] **Doces na ficha** — troca Linha/Genérico fica visível mesmo se o tipo atual zerou; stepper só quando há doses daquele tipo.
- [x] **Nomes no jardim** — etiqueta nome + Lv sobre cada Pokémon; botão olho no zoom liga/desliga e lembra no `localStorage`.

### Docs

- [x] **PLANNING 5.5** — vitória/XP alinhados com “entrou + de pé” e divisão por N; nota do Exp Share.

---

## Já feito em `fix/correcoes` (e/ou no `main`)

- [x] **Troca de golpe só em dev** — o botão Trocar na ficha e a rota `POST /pokemon/:id/moves` só valem com `npm run dev` / `DEV_TOOLS=1`. Em produção a ficha só mostra os golpes.
- [x] **Volume padrão 50%** — sem valor no `localStorage`, a barra começa em metade.
- [x] **Jardim 12×12 + gramado infinito + pan** — zona andável, anel/fundo infinito, zoom, pan; meadow `fixed`; HUD/docks por cima.
- [x] **Golpes sorteados, sem troca** — ao subir de nível o rápido não muda; carregado vazio sorteia. Ao evoluir, golpes sorteados de novo. Pool da linha evolutiva.
- [x] **Seed secreta dos lançamentos** — `encounters.secret_seed` (migração `0013`); metadata drizzle em dia; `bodyLimit` 64 KB e teto de inputs na luta.
- [x] **Zoom minimalista / gramado escuro de fundo / menus menores no PC / pan sem drag nativo / spawn espalhado / sem empilhar casas / zoom lembrado**.
- [x] **Chips da coleção no mobile** — filtros enchem a largura (`8423987`).

## Próximos / fila

- Exp Share (item): ampliar quem recebe XP sem exigir entrada em campo.
- Dinheiro de vitória no painel pós-luta (hoje só itens/semente).

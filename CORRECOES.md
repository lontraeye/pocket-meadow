# Correções diversas (`fix/correcoes`)

Branch de ajustes soltos — bugs de UI, travas de teste, polimentos — **fora** das fases do roadmap (`PLANNING.md`). Cada item entra aqui ao ser feito; o PR final resume a lista.

**Como usar:** uma correção (ou grupo bem pequeno) por commit, mensagem no estilo do repo (português, foco no porquê). Atualizar esta lista no mesmo commit.

## Feito nesta branch

- [x] **Troca de golpe só em dev** — o botão Trocar na ficha e a rota `POST /pokemon/:id/moves` só valem com `npm run dev` / `DEV_TOOLS=1`. Em produção a ficha só mostra os golpes.
- [x] **Volume padrão 50%** — sem valor no `localStorage`, a barra do HUD começa em metade (quem já salvou volume continua com o dele).
- [x] **Jardim 12×12 + gramado infinito + pan** — zona andável 12×12 (canteiros na última fileira); anel cinza intransitável (demarcação) grande o bastante p/ parecer infinito; tiles planos (sem extrusão 3D); barra de zoom 1–3×; pan com folga. Meadow em `position: fixed`; HUD/docks por cima. Sprites acima do chão (faixa de z-index).
- [x] **Golpes sorteados, sem troca** — ao subir de nível o rápido não muda e as ofertas de troca saíram; se o slot de carregado estiver vazio, entra um carregado sorteado. Ao evoluir, os dois golpes são sorteados de novo pela espécie nova, com aviso na ficha antes de confirmar (PLANNING.md, seção 5.18). TMs ficam anotados para depois.
- [x] **Pool da linha evolutiva** — o sorteio usa os golpes da espécie e das pré-evoluções, ainda limitado pelo nível. Evoluir nunca tira mais o carregado (antes: 37 de 122 evoluções tinham faixa de risco, e Ninetales, Wigglytuff, Clefairy e Politoed nunca teriam carregado).
- [x] **Docs** — seção 10 corrigida (tem nature) e a pergunta de IVs/natures da 5.13 marcada como decidida.

## Já no `main` (antes desta branch)

- [x] **Chips da coleção no mobile** — filtros enchem a largura da linha em vez de ficarem grudados à esquerda (`8423987`).

## Próximos / fila

_(adicionar aqui antes ou ao fazer)_

-

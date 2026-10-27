# Correções diversas (`fix/correcoes`)

Branch de ajustes soltos — bugs de UI, travas de teste, polimentos — **fora** das fases do roadmap (`PLANNING.md`). Cada item entra aqui ao ser feito; o PR final resume a lista.

**Como usar:** uma correção (ou grupo bem pequeno) por commit, mensagem no estilo do repo (português, foco no porquê). Atualizar esta lista no mesmo commit.

## Feito nesta branch

- [x] **Troca de golpe só em dev** — o botão Trocar na ficha e a rota `POST /pokemon/:id/moves` só valem com `npm run dev` / `DEV_TOOLS=1`. Em produção a ficha só mostra os golpes.
- [x] **Volume padrão 50%** — sem valor no `localStorage`, a barra do HUD começa em metade (quem já salvou volume continua com o dele).
- [x] **Jardim 12×12 + gramado infinito + pan** — zona andável 12×12 (canteiros na última fileira); anel cinza intransitável (demarcação) grande o bastante p/ parecer infinito; tiles planos (sem extrusão 3D); barra de zoom 1–3×; pan com folga. Meadow em `position: fixed`; HUD/docks por cima. Sprites acima do chão (faixa de z-index).

## Já no `main` (antes desta branch)

- [x] **Chips da coleção no mobile** — filtros enchem a largura da linha em vez de ficarem grudados à esquerda (`8423987`).

## Próximos / fila

_(adicionar aqui antes ou ao fazer)_

-

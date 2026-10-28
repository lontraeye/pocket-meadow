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
- [x] **Seed secreta dos lançamentos** — a seed da luta que vai para o front deixava recuperar a `rng_seed` (as derivações são XOR) e prever cada lançamento. Lançamentos e semente da vitória agora usam `encounters.secret_seed` (migração `0013`), sorteada na criação e nunca enviada. Encontros antigos seguem com a `rng_seed`.
- [x] **Metadata do drizzle em dia** — as migrações `0008`–`0012` foram escritas à mão sem snapshot, e o `drizzle-kit generate` passava a propor recriar colunas e a tabela `pokemon`. A `0013` foi escrita à mão (só a coluna nova) e o `0013_snapshot.json` traz o schema completo, então o próximo `generate` volta a comparar certo. Obs.: o `schema.ts` declara o CHECK `ck_pokemon_ability_slot`, que o banco não tem (a `0008` não criou); não faz falta, o código só grava valores válidos.
- [x] **Limites contra corpo gigante** — `bodyLimit` de 64 KB em todas as rotas (413 `payload_too_large`) e teto de 600 toques no fim da luta (`simConfig.maxInputs`). Uma luta normal tem ~55 toques.

- [x] **Zoom do jardim minimalista** — no lugar do slider, um controle vertical semitransparente com + e − e a barrinha do nível no meio (tocar nela também escolhe). Rodinha do mouse e pinça no celular, sempre em volta do ponto do mouse ou dos dedos. Passos de meio (1×, 1,5×, 2×, 2,5×, 3×): o PMD fica em 2× a 6×, sempre inteiro, sem borrar.

- [x] **Gramado infinito de verdade, verde escuro fora da área** — no lugar do anel cinza de ladrilhos (32×32, mais de mil elementos), o gramado de fora é o fundo do jardim: losangos em verde escuro, alinhados com os ladrilhos e seguindo pan e zoom, sem borda em lugar nenhum. Só os 144 ladrilhos da zona jogável viram elementos.

- [x] **Menus do jardim menores no PC** — com o jardim em tela cheia, o HUD e os botões de baixo esticavam na largura toda. Agora ficam centralizados, com largura máxima (HUD 40rem, botões 30rem); no celular nada muda.

- [x] **Pan travando no PC** — às vezes o clique começava numa imagem ou em algo selecionado e o navegador iniciava o arrasto nativo (a "imagem fantasma" do jardim), que engole o movimento do mouse e trava o pan até soltar. O jardim agora cancela o `dragstart` e não deixa selecionar nada.

- [x] **Pokémon espalhados ao abrir o jardim** — antes cada um nascia na próxima casa livre, em ordem, e todos se amontoavam no canto de cima até saírem andando. Agora nascem em casas sorteadas do jardim todo, olhando para lados diferentes. Provisório até o PC e os biomas decidirem onde cada um fica.

- [x] **Pokémon não andam uns sobre os outros** — cada casa tem no máximo um dono. Antes de cada passo o Pokémon reserva a casa seguinte e só solta a de trás ao chegar; se a da frente está ocupada, espera parado (350 ms) e tenta de novo, e depois de 4 tentativas escolhe outro destino (dois cara a cara não travam). O destino sorteado já ignora casas ocupadas. Medido: 10 Pokémon andando por 40 s, nenhum na mesma casa.

- [x] **Zoom lembrado** — o nível escolhido fica salvo no aparelho (`localStorage`, como o volume) e volta igual depois do F5. Sem nada salvo, abre no zoom calculado pela largura da tela, como antes.

## Já no `main` (antes desta branch)

- [x] **Chips da coleção no mobile** — filtros enchem a largura da linha em vez de ficarem grudados à esquerda (`8423987`).

## Próximos / fila

_(adicionar aqui antes ou ao fazer)_

-

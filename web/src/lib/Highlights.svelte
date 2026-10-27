<script lang="ts">
  import type { HighlightCard } from './highlights'
  import { play } from './sound'

  let {
    cards,
    onDone,
  }: {
    cards: HighlightCard[]
    onDone: () => void
  } = $props()

  let index = $state(0)

  const current = $derived(cards[index] ?? null)
  const last = $derived(cards.length === 0 || index >= cards.length - 1)

  let soundedFor = $state<string | null>(null)

  $effect(() => {
    void cards
    index = 0
    soundedFor = null
  })

  // Um som por cartão, não a cada reexecução do efeito.
  $effect(() => {
    if (!current?.sound) return
    if (soundedFor === current.id) return
    soundedFor = current.id
    play(current.sound)
  })

  // Cada cartão passa só com um toque: avançando sozinho (0,9 s), o resumo
  // depois da luta passava rápido demais para ler (2026-10-27).
  $effect(() => {
    if (cards.length === 0) onDone()
  })

  function advance() {
    if (index >= cards.length - 1) {
      onDone()
      return
    }
    index += 1
  }

  function skipAll() {
    onDone()
  }
</script>

{#if current}
  <button type="button" class="stack" onclick={advance} aria-label="Próximo destaque">
    <div class="card" class:good={current.tone === 'good'} class:bad={current.tone === 'bad'}>
      {#if current.iconSrc}
        <img src={current.iconSrc} alt="" width="36" height="36" />
      {/if}
      <strong>{current.title}</strong>
      {#if current.detail}<span>{current.detail}</span>{/if}
    </div>
    <small class="hint">{last ? 'Toque para continuar' : `${index + 1}/${cards.length} · toque`}</small>
  </button>
  {#if !last}
    <button type="button" class="btn-link skip" onclick={skipAll}>Pular destaques</button>
  {/if}
{/if}

<style>
  .stack {
    display: grid;
    gap: 0.4rem;
    width: 100%;
    min-height: 88px;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: center;
    cursor: pointer;
    touch-action: manipulation;
  }

  .card {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    min-height: 72px;
    padding: 0.75rem 0.5rem;
    background: #00000012;
    box-shadow: inset 0 0 0 var(--px) #00000022;
  }

  .card.good {
    background: #3d7a2822;
  }

  .card.bad {
    background: #b33a2b18;
  }

  .card img {
    image-rendering: pixelated;
  }

  .card strong {
    font-size: 1.1rem;
  }

  .card span {
    font-size: 0.95rem;
    font-weight: 600;
    opacity: 0.9;
  }

  .hint {
    font-weight: 600;
    opacity: 0.7;
  }

  .skip {
    justify-self: center;
    min-height: 44px;
  }
</style>

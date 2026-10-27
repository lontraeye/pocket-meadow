<script lang="ts">
  import { onMount } from 'svelte'
  import { api, type GameState } from './lib/api'
  import AuthForm from './lib/AuthForm.svelte'
  import Collection from './lib/Collection.svelte'
  import Explore from './lib/Explore.svelte'
  import Garden from './lib/Garden.svelte'

  let phase = $state<'loading' | 'auth' | 'play'>('loading')
  let screen = $state<'meadow' | 'explore' | 'collection'>('meadow')
  let game = $state<GameState | null>(null)

  async function loadState() {
    const response = await api('/api/state')
    if (response.status === 401) {
      game = null
      phase = 'auth'
      screen = 'meadow'
      return
    }
    if (!response.ok) {
      if (!game) phase = 'auth'
      return
    }
    game = (await response.json()) as GameState
    phase = 'play'
  }

  async function logout() {
    await api('/api/auth/logout', {})
    game = null
    phase = 'auth'
    screen = 'meadow'
  }

  onMount(() => {
    void loadState()
  })
</script>

{#if phase === 'loading'}
  <main class="status"><p>Abrindo o jardim…</p></main>
{:else if phase === 'auth' || game === null}
  <AuthForm onSignedIn={loadState} />
{:else}
  <main class="meadow" class:fit={screen !== 'meadow'}>
    <header class="panel hud">
      <div class="level" aria-label="Nível de treinador">
        <small>Nv</small>{game.trainer.level}
      </div>
      <div class="energy">
        <span class="label">Energia {game.trainer.energy}/{game.trainer.energyMax}</span>
        <div class="pips" aria-hidden="true">
          {#each Array.from({ length: game.trainer.energyMax }, (_, i) => i) as i (i)}
            <span class="pip" class:full={i < game.trainer.energy}></span>
          {/each}
        </div>
      </div>
      <button type="button" class="btn" onclick={logout}>Sair</button>
    </header>
    {#if screen === 'explore'}
      <Explore {game} onClose={() => (screen = 'meadow')} onState={loadState} />
    {:else if screen === 'collection'}
      <Collection {game} onClose={() => (screen = 'meadow')} onState={loadState} />
    {:else}
      <Garden {game} onState={loadState} />
      <div class="docks">
        <button type="button" class="btn" onclick={() => (screen = 'collection')}>Coleção</button>
        <button type="button" class="btn btn-primary" onclick={() => (screen = 'explore')}>
          {game.encounter ? 'Ver encontro' : 'Explorar'}
        </button>
      </div>
    {/if}
  </main>
{/if}

<style>
  .status,
  .meadow {
    box-sizing: border-box;
    width: 100%;
    margin: 0 auto;
    padding: 0.5rem;
  }

  .status {
    display: grid;
    place-items: center;
    min-height: var(--screen-h);
    font-size: 1.2rem;
  }

  .meadow {
    max-width: 64rem;
    min-height: var(--screen-h);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .hud {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 0.25rem;
  }

  .level {
    display: grid;
    place-items: center;
    min-width: 44px;
    height: 44px;
    background: var(--ink);
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 700;
    line-height: 1;
    box-shadow: inset 0 calc(var(--px) * -2) 0 #00000055;
  }

  .level small {
    font-size: 0.55rem;
    color: #fff;
  }

  .energy {
    display: grid;
    gap: 0.2rem;
    flex: 1;
    min-width: 0;
  }

  .label {
    font-size: 15px;
    font-weight: 600;
  }

  .pips {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 14px);
    gap: 3px;
  }

  .pip {
    height: 14px;
    background: #00000022;
    box-shadow: inset 0 0 0 var(--px) #00000033;
  }

  .pip.full {
    background: var(--accent);
    box-shadow:
      inset 0 calc(var(--px) * -2) 0 #c79a00,
      inset 0 var(--px) 0 #fff3a0;
  }

  .docks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
    flex: none;
  }

  /* A tela de encontro cabe no celular: o meio rola e os botões ficam embaixo. */
  .meadow.fit {
    height: var(--screen-h);
    max-height: var(--screen-h);
    overflow: hidden;
  }
</style>

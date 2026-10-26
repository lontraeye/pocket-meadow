<script lang="ts">
  import { onMount } from 'svelte'
  import { api, type GameState } from './lib/api'
  import AuthForm from './lib/AuthForm.svelte'
  import Garden from './lib/Garden.svelte'

  let phase = $state<'loading' | 'auth' | 'garden'>('loading')
  let game = $state<GameState | null>(null)

  async function loadState() {
    const response = await api('/api/state')
    if (response.status === 401) {
      game = null
      phase = 'auth'
      return
    }
    if (!response.ok) {
      phase = 'auth'
      return
    }
    game = (await response.json()) as GameState
    phase = 'garden'
  }

  async function logout() {
    await api('/api/auth/logout', {})
    game = null
    phase = 'auth'
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
  <main class="meadow">
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
    <Garden {game} />
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
    min-height: 100dvh;
    font-size: 1.2rem;
  }

  .meadow {
    max-width: 64rem;
    min-height: 100dvh;
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
</style>

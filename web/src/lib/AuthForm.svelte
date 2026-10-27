<script lang="ts">
  import { api, errorText, type ApiError } from './api'

  let { onSignedIn }: { onSignedIn: () => void } = $props()

  const starters = [
    { key: 'bulbasaur', speciesId: 1, name: 'Bulbasaur' },
    { key: 'charmander', speciesId: 4, name: 'Charmander' },
    { key: 'squirtle', speciesId: 7, name: 'Squirtle' },
  ]

  let mode = $state<'login' | 'register'>('login')
  let username = $state('')
  let password = $state('')
  let starter = $state('charmander')
  let message = $state('')
  let pending = $state(false)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    pending = true
    message = ''
    try {
      const response = await api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        username,
        password,
        ...(mode === 'register' ? { starter } : {}),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
        message = errorText(body)
        return
      }
      onSignedIn()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }
</script>

<main class="screen">
  <h1 class="logo">Pocket<span>Meadow</span></h1>

  <form class="panel" onsubmit={submit}>
    <h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Novo treinador'}</h2>

    <label>
      Usuário
      <input class="field" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" bind:value={username} />
    </label>
    <label>
      Senha
      <input
        class="field"
        name="password"
        type="password"
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
        bind:value={password}
      />
    </label>

    {#if mode === 'register'}
      <fieldset>
        <legend>Escolha seu parceiro</legend>
        <div class="starters" role="radiogroup">
          {#each starters as option (option.key)}
            <button
              type="button"
              role="radio"
              aria-checked={starter === option.key}
              class="starter"
              class:selected={starter === option.key}
              onclick={() => (starter = option.key)}
            >
              <img src="/sprites/showdown/{option.speciesId}.gif" alt="" />
              <span>{option.name}</span>
            </button>
          {/each}
        </div>
      </fieldset>
    {/if}

    {#if message}<p class="message" role="alert">{message}</p>{/if}

    <button class="btn btn-primary submit" type="submit" disabled={pending}>
      {#if pending}…{:else}{mode === 'login' ? 'Entrar' : 'Criar conta'}{/if}
    </button>
  </form>

  <button
    type="button"
    class="btn-link"
    onclick={() => {
      mode = mode === 'login' ? 'register' : 'login'
      message = ''
    }}
  >
    {mode === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta'}
  </button>
</main>

<style>
  .screen {
    box-sizing: border-box;
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 0.75rem;
    width: 100%;
    max-width: 26rem;
    min-height: var(--screen-h);
    margin: 0 auto;
    padding: 1.5rem 1rem 2rem;
  }

  .logo {
    display: grid;
    justify-items: center;
    margin: 0.5rem 0 0.25rem;
    font-size: 2.6rem;
    letter-spacing: 1px;
    color: #fff;
    text-shadow:
      0 3px 0 var(--grass-side),
      3px 0 0 var(--grass-side),
      -3px 0 0 var(--grass-side),
      0 -3px 0 var(--grass-side),
      0 6px 0 var(--ink);
  }

  .logo span {
    color: var(--accent);
    font-size: 1.15em;
    margin-top: -0.15em;
  }

  form {
    display: grid;
    gap: 0.75rem;
    width: 100%;
  }

  h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  label,
  fieldset {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    margin: 0;
    border: 0;
    padding: 0;
    font-weight: 600;
  }

  legend {
    padding: 0;
    margin-bottom: 0.25rem;
  }

  .starters {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4rem;
  }

  .starter {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    min-width: 0;
    padding: 0 0 0.15rem;
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
    background: none;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }

  .starter.selected {
    border-image: url('/ui/selected.png') 6 fill / 8px round;
  }

  .starter img {
    width: 64px;
    height: 64px;
    object-fit: contain;
    object-position: bottom;
  }

  .starter.selected img {
    animation: hop 0.6s steps(2) infinite;
  }

  .starter span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .message {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
  }

  .submit {
    width: 100%;
  }

  @keyframes hop {
    50% {
      transform: translateY(-4px);
    }
  }

  @media (min-width: 800px) {
    .screen {
      padding-top: 4rem;
    }
  }
</style>

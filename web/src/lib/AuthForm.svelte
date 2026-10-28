<script lang="ts">
  import { spriteLoading } from './spriteLoading'
  import { onMount } from 'svelte'
  import { api, errorText, type ApiError } from './api'
  import { play } from './sound'

  let { onSignedIn }: { onSignedIn: () => void } = $props()

  const starters = [
    { key: 'bulbasaur', speciesId: 1, name: 'Bulbasaur' },
    { key: 'charmander', speciesId: 4, name: 'Charmander' },
    { key: 'squirtle', speciesId: 7, name: 'Squirtle' },
  ]

  // O servidor volta para /?auth=<motivo> (server/src/routes/auth.ts).
  const returnMessages: Record<string, string> = {
    cancelled: 'Login cancelado.',
    failed: 'Não deu para entrar com o Google. Tente de novo.',
    unavailable: 'O login pelo Google não está configurado neste servidor.',
  }

  // 'checking': perguntando se há cadastro esperando nome e inicial.
  let mode = $state<'checking' | 'login' | 'signup'>('checking')
  let username = $state('')
  let starter = $state('charmander')
  let message = $state('')
  let pending = $state(false)
  // Entrada sem conta: aparece quando o servidor está com DEV_TOOLS (a rota
  // /dev/status só existe lá). Vale no `npm run dev` e no `npm run preview`.
  let devLogin = $state(false)

  onMount(() => {
    const params = new URLSearchParams(window.location.search)
    const reason = params.get('auth')
    if (reason) {
      message = returnMessages[reason] ?? ''
      params.delete('auth')
      const query = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
    }
    void checkSignup()
    void checkDevTools()
  })

  async function checkDevTools() {
    try {
      devLogin = (await api('/api/dev/status')).ok
    } catch {
      devLogin = false
    }
  }

  async function checkSignup() {
    try {
      const response = await api('/api/auth/signup')
      mode = response.ok ? 'signup' : 'login'
    } catch {
      mode = 'login'
      message = 'Sem conexão com o servidor.'
    }
  }

  async function submitSignup(event: SubmitEvent) {
    event.preventDefault()
    await send('/api/auth/signup', { username, starter })
  }

  async function submitDev(event: SubmitEvent) {
    event.preventDefault()
    await send('/api/dev/login', { username, starter })
  }

  async function send(path: string, body: unknown) {
    play('tap')
    pending = true
    message = ''
    try {
      const response = await api(path, body)
      if (!response.ok) {
        const error = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
        message = errorText(error)
        if (error.error === 'signup_expired') mode = 'login'
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

{#snippet starterPicker()}
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
          <img use:spriteLoading src="/sprites/showdown/{option.speciesId}.gif" alt="" />
          <span>{option.name}</span>
        </button>
      {/each}
    </div>
  </fieldset>
{/snippet}

{#snippet nameField()}
  <label>
    Nome de treinador
    <input
      class="field"
      name="username"
      autocomplete="nickname"
      autocapitalize="none"
      spellcheck="false"
      bind:value={username}
    />
  </label>
{/snippet}

<main class="screen">
  <h1 class="logo">Pocket<span>Meadow</span></h1>

  {#if mode === 'signup'}
    <form class="panel" onsubmit={submitSignup}>
      <h2>Novo treinador</h2>
      {@render nameField()}
      {@render starterPicker()}
      {#if message}<p class="message" role="alert">{message}</p>{/if}
      <button class="btn btn-primary submit" type="submit" disabled={pending}>
        {#if pending}…{:else}Começar{/if}
      </button>
    </form>
  {:else}
    <section class="panel">
      <h2>Bem-vindo</h2>
      <p class="hint">Entre com a sua conta Google. O jogo guarda só um identificador da conta, sem e-mail nem nome.</p>
      {#if message}<p class="message" role="alert">{message}</p>{/if}
      <a class="btn btn-primary submit" href="/api/auth/google" aria-disabled={mode === 'checking'}>Entrar com Google</a>
    </section>

    {#if devLogin}
      <form class="panel" onsubmit={submitDev}>
        <h2>Entrar sem Google (teste)</h2>
        {@render nameField()}
        {@render starterPicker()}
        <button class="btn submit" type="submit" disabled={pending}>Entrar</button>
      </form>
    {/if}
  {/if}
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

  form,
  section {
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
    padding: 0.25rem 0 0.3rem;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }

  .starter.selected {
    border-color: var(--selected);
    background: var(--selected-face);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -2px 0 var(--selected);
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

  /* Em 360px o "Charmander" não cabia em 15px; diminui só em tela estreita. */
  .starter span {
    max-width: 100%;
    font-size: clamp(12px, 3.6vw, 15px);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    margin: 0;
    font-weight: 600;
  }

  a.submit {
    text-decoration: none;
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

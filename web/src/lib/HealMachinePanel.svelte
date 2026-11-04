<script lang="ts">
  // Painel da máquina de cura: cargas, tempo até a próxima e curar a equipe.
  import { api, errorText, type ApiError, type GameState } from './api'
  import { formatCountdown } from './time'
  import { serverClock } from './serverClock.svelte'
  import { play } from './sound'

  let {
    game,
    machineId,
    onState,
    onClose,
    onHealed,
  }: {
    game: GameState
    /** Qual máquina (cada uma tem as suas cargas). */
    machineId: number
    onState: () => Promise<void>
    onClose: () => void
    /** Dispara a animação da máquina no jardim (enche → brilha → vazia). */
    onHealed?: () => void
  } = $props()

  const clock = serverClock(() => game.now)
  let pending = $state(false)
  let message = $state('')

  const machine = $derived(game.garden.healMachines.find((row) => row.id === machineId) ?? game.garden.healMachines[0]!)
  const nextLeft = $derived(
    machine.nextChargeAt !== null ? Math.max(0, machine.nextChargeAt - clock.now()) : null,
  )
  const teamHurt = $derived(
    game.pokemon.some((mon) => mon.teamSlot !== null && mon.hpRatio < 1),
  )

  async function healTeam() {
    pending = true
    message = ''
    try {
      const response = await api('/api/garden/heal-machine/use', { id: machine.id })
      const body = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & {
        healed?: number
      }
      if (!response.ok) {
        message = errorText(body)
        return
      }
      play('harvest')
      onHealed?.()
      message = `Curou ${body.healed ?? 0} da equipe.`
      await onState()
      onClose()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }
</script>

<div class="panel">
  <header class="head">
    <h2>Máquina de cura</h2>
    <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
  </header>
  <p class="hint">1 carga cura a equipe toda na hora.</p>
  <p class="charges" aria-live="polite">
    <strong>{machine.charges}</strong> / {machine.max} cargas
  </p>
  {#if nextLeft !== null && machine.charges < machine.max}
    <p class="hint">Próxima em {formatCountdown(nextLeft)}</p>
  {:else}
    <p class="hint">Cargas cheias.</p>
  {/if}
  <button
    type="button"
    class="btn btn-primary heal"
    disabled={pending || machine.charges < 1 || !teamHurt}
    onclick={() => void healTeam()}
  >
    {#if machine.charges < 1}
      Sem cargas
    {:else if !teamHurt}
      Equipe saudável
    {:else}
      Curar a equipe
    {/if}
  </button>
  {#if message}<p class="message" role="status">{message}</p>{/if}
</div>

<style>
  .panel {
    display: grid;
    gap: 0.55rem;
    width: 100%;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .close {
    min-width: 44px;
    min-height: 44px;
  }

  .hint,
  .message {
    margin: 0;
    font-size: 0.9rem;
  }

  .hint {
    opacity: 0.75;
  }

  .charges {
    margin: 0;
    font-size: 1.05rem;
  }

  .heal {
    min-height: 44px;
  }
</style>

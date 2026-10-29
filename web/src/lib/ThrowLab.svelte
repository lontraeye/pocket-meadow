<script lang="ts">
  import { onMount } from 'svelte'
  import { applyThrowTuning, THROW_DEFAULTS, THROW_PHYSICS, type ThrowReading, type ThrowTuning } from './throwPhysics'

  /**
   * Laboratório do arremesso (só dev). Liga o treino (arremessos não gastam
   * nada nem chamam o servidor), mostra a leitura de cada arremesso e deixa
   * mexer nos números da física ao vivo. Os ajustes ficam no aparelho; o botão
   * Copiar dá o JSON para levar para os padrões do throwPhysics.ts.
   */
  let {
    practice = $bindable(false),
    readings,
  }: {
    practice?: boolean
    readings: ThrowReading[]
  } = $props()

  type Knob = { key: keyof ThrowTuning; label: string; min: number; max: number; step: number }

  const KNOBS: Knob[] = [
    { key: 'idealSpeed', label: 'Força ideal (U/s)', min: 1.5, max: 6, step: 0.1 },
    { key: 'speedTolerance', label: 'Folga da força', min: 0.05, max: 0.5, step: 0.01 },
    { key: 'powerResponse', label: 'Maciez da força', min: 0.4, max: 1, step: 0.05 },
    { key: 'minUpSpeed', label: 'Força mínima (U/s)', min: 0.3, max: 3, step: 0.1 },
    { key: 'flightTimeS', label: 'Tempo de voo (s)', min: 0.3, max: 1.2, step: 0.02 },
    { key: 'lateralGain', label: 'Peso do ângulo', min: 0.2, max: 1.5, step: 0.05 },
    { key: 'hitRadiusFrac', label: 'Raio do alvo (× corpo)', min: 0.25, max: 0.9, step: 0.01 },
    { key: 'curveShiftRadii', label: 'Curva (raios)', min: 0, max: 4, step: 0.1 },
    { key: 'depthRatio', label: 'Perspectiva', min: 1.2, max: 4, step: 0.1 },
    { key: 'velocityWindowMs', label: 'Janela do gesto (ms)', min: 30, max: 160, step: 5 },
  ]

  const storageKey = 'pm-throw-tuning'

  let values = $state<Record<string, number>>({})

  function sync() {
    values = Object.fromEntries(KNOBS.map((knob) => [knob.key, THROW_PHYSICS[knob.key] as number]))
  }

  function changed(): Partial<ThrowTuning> {
    const patch: Record<string, number> = {}
    for (const knob of KNOBS) {
      const value = THROW_PHYSICS[knob.key] as number
      if (value !== THROW_DEFAULTS[knob.key]) patch[knob.key] = value
    }
    return patch as Partial<ThrowTuning>
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(changed()))
    } catch {
      /* sem storage */
    }
  }

  function setKnob(key: keyof ThrowTuning, value: number) {
    applyThrowTuning({ ...changed(), [key]: value })
    sync()
    save()
  }

  function reset() {
    applyThrowTuning({})
    sync()
    save()
  }

  let copied = $state(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(changed(), null, 2))
      copied = true
      setTimeout(() => (copied = false), 1200)
    } catch {
      /* clipboard bloqueado: os valores estão na tela */
    }
  }

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<ThrowTuning>
      applyThrowTuning(saved)
    } catch {
      /* ignora */
    }
    sync()
  })

  const RESULT: Record<ThrowReading['result'], string> = {
    tap: 'toque (não lança)',
    weak: 'fraco (não lançou)',
    hit: 'acertou',
    short: 'curto',
    over: 'passou por cima',
    wide: 'errou de lado',
  }

  function fmt(reading: ThrowReading): string {
    const parts = [
      `força ${reading.power.toFixed(2)}×`,
      `${reading.angleDeg >= 0 ? '+' : ''}${reading.angleDeg.toFixed(0)}°`,
      RESULT[reading.result],
    ]
    if (reading.distRatio !== null) parts.push(`centro ${(reading.distRatio * 100).toFixed(0)}%`)
    if (reading.quality && reading.quality !== 'normal') parts.push(reading.quality)
    if (reading.curve) parts.push(`curva ${reading.turns.toFixed(1)}v`)
    return parts.join(' · ')
  }

  const hits = $derived(readings.filter((r) => r.result === 'hit').length)
  const launched = $derived(readings.filter((r) => r.result !== 'tap' && r.result !== 'weak').length)

  /** Resumo da sessão: onde o gesto natural cai e que erro mais acontece. */
  const summary = $derived.by(() => {
    const thrown = readings.filter((r) => r.result !== 'tap')
    if (thrown.length < 3) return null
    const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
    const straight = thrown.filter((r) => !r.curve)
    const count = (result: ThrowReading['result']) => thrown.filter((r) => r.result === result).length
    return {
      power: avg(thrown.map((r) => r.power)),
      angle: straight.length > 0 ? avg(straight.map((r) => r.angleDeg)) : null,
      short: count('short') + count('weak'),
      over: count('over'),
      wide: count('wide'),
    }
  })

  let copiedLog = $state(false)
  async function copyLog() {
    const text = [
      summary
        ? `força média ${summary.power.toFixed(2)}× · ângulo médio ${summary.angle?.toFixed(0) ?? '—'}° · curto ${summary.short} · passou ${summary.over} · lado ${summary.wide} · acertos ${hits}/${launched}`
        : '',
      `U ${readings[0]?.unitPx ?? '—'} px · ${navigator.userAgent}`,
      ...readings.map(fmt),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      copiedLog = true
      setTimeout(() => (copiedLog = false), 1200)
    } catch {
      /* clipboard bloqueado */
    }
  }
</script>

<section class="panel lab" aria-label="Laboratório do arremesso">
  <label class="practice">
    <input type="checkbox" bind:checked={practice} />
    <span>Treino (não gasta bola)</span>
    {#if launched > 0}<small>{hits}/{launched} acertos</small>{/if}
  </label>
  {#if summary}
    <p class="summary">
      Força média <b>{summary.power.toFixed(2)}×</b>{#if summary.angle !== null}
        · ângulo <b>{summary.angle >= 0 ? '+' : ''}{summary.angle.toFixed(0)}°</b>{/if}
      · curto {summary.short} · passou {summary.over} · lado {summary.wide}
    </p>
  {/if}
  {#if readings.length > 0}
    <ol class="log">
      {#each readings.slice(0, 5) as reading, i (i)}
        <li class:hit={reading.result === 'hit'}>{fmt(reading)}</li>
      {/each}
    </ol>
  {/if}
  <details>
    <summary>Física (U = {readings[0]?.unitPx ?? '—'} px)</summary>
    {#each KNOBS as knob (knob.key)}
      <label class="knob">
        <span>{knob.label}</span>
        <input
          type="range"
          min={knob.min}
          max={knob.max}
          step={knob.step}
          value={values[knob.key] ?? 0}
          oninput={(event) => setKnob(knob.key, Number((event.currentTarget as HTMLInputElement).value))}
        />
        <strong class:changed={values[knob.key] !== THROW_DEFAULTS[knob.key]}>{values[knob.key]}</strong>
      </label>
    {/each}
    <div class="actions">
      <button type="button" class="btn" onclick={reset}>Padrões</button>
      <button type="button" class="btn" onclick={() => void copy()}>{copied ? 'Copiado!' : 'Copiar ajustes'}</button>
    </div>
    <button type="button" class="btn copy-log" onclick={() => void copyLog()}>
      {copiedLog ? 'Copiado!' : 'Copiar leituras'}
    </button>
  </details>
</section>

<style>
  .lab {
    display: grid;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    font-size: 0.8rem;
  }

  .practice {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 32px;
    font-weight: 700;
  }

  .practice small {
    margin-left: auto;
    font-weight: 600;
  }

  .summary {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .copy-log {
    width: 100%;
    margin-top: 0.4rem;
  }

  .log {
    display: grid;
    gap: 0.1rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-variant-numeric: tabular-nums;
  }

  .log li {
    color: var(--danger);
  }

  .log li.hit {
    color: var(--grass-side);
  }

  .log li:not(:first-child) {
    opacity: 0.6;
  }

  summary {
    min-height: 32px;
    line-height: 32px;
    font-weight: 700;
    cursor: pointer;
  }

  .knob {
    display: grid;
    grid-template-columns: 9.5rem minmax(0, 1fr) 3rem;
    align-items: center;
    gap: 0.4rem;
    min-height: 36px;
  }

  .knob input {
    width: 100%;
  }

  .knob strong {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .knob strong.changed {
    color: var(--primary);
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }

  .actions .btn {
    flex: 1;
  }
</style>

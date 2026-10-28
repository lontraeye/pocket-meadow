<script lang="ts">
  /** Tabelinha 2×3 (atributo + valor) do tema clássico — ficha e Pokédex. */
  let {
    stats,
  }: {
    stats: {
      hp: number
      attack: number
      defense: number
      spAttack: number
      spDefense: number
      speed: number
    }
  } = $props()
</script>

<table class="stat-table">
  <tbody>
    <tr>
      <th scope="row">HP</th><td>{stats.hp}</td>
      <th scope="row">AtqE</th><td>{stats.spAttack}</td>
    </tr>
    <tr>
      <th scope="row">Atq</th><td>{stats.attack}</td>
      <th scope="row">DefE</th><td>{stats.spDefense}</td>
    </tr>
    <tr>
      <th scope="row">Def</th><td>{stats.defense}</td>
      <th scope="row">Vel</th><td>{stats.speed}</td>
    </tr>
  </tbody>
</table>

<style>
  .stat-table {
    width: min(100%, 18rem);
    margin: 0.35rem auto 0;
    border-collapse: collapse;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    font-size: 0.9rem;
  }

  .stat-table th,
  .stat-table td {
    padding: 0.28rem 0.4rem;
    border: 1px solid var(--panel-shade);
  }

  .stat-table th {
    font-weight: 700;
    text-align: left;
    opacity: 0.85;
    white-space: nowrap;
  }

  .stat-table td {
    font-weight: 800;
    text-align: right;
    font-variant-numeric: tabular-nums;
    min-width: 2.4rem;
  }

  /* Separador entre as duas metades (3+3). */
  .stat-table th:nth-child(3),
  .stat-table td:nth-child(3) {
    border-left-width: 2px;
    border-left-color: var(--panel-edge);
  }
</style>

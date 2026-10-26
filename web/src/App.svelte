<script lang="ts">
  import { onMount } from 'svelte'

  let health = $state('consultando o servidor…')

  onMount(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        const body = await response.text()
        if (!response.ok) {
          health = `erro ${response.status}: ${body}`
          return
        }
        try {
          health = JSON.stringify(JSON.parse(body), null, 2)
        } catch {
          health = body
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        health = 'sem resposta do servidor'
      })

    return () => controller.abort()
  })
</script>

<main>
  <h1>Pocket Meadow</h1>
  <p>O cliente só mostra o que o servidor responde.</p>
  <pre>{health}</pre>
</main>

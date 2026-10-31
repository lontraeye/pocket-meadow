import { mount } from 'svelte'
import '@fontsource/pixelify-sans/latin-400.css'
import '@fontsource/pixelify-sans/latin-700.css'
import TileLab from './lib/TileLab.svelte'

// Laboratório de tiles (PLANNING.md, seção 5.22): só no `npm run dev`. Sem o
// app.css do jogo: ele trava a rolagem da página e tem uma `.panel` própria.
export default mount(TileLab, { target: document.getElementById('app')! })

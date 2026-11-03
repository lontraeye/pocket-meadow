import { mount } from 'svelte'
import '@fontsource/pixelify-sans/latin-400.css'
import '@fontsource/pixelify-sans/latin-700.css'
import Vitrine from './lib/Vitrine.svelte'

// Vitrine do jardim: só no `npm run dev`, como o laboratório de tiles. Mostra
// a arte de art/jardim/ enfileirada em grama isométrica, para comparar.
export default mount(Vitrine, { target: document.getElementById('app')! })

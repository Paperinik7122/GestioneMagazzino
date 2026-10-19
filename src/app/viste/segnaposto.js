import { icona, intestazione } from '../../ui/kit.js';

export function nonTrovata(vista) {
  vista.innerHTML = `${intestazione('Pagina non trovata', { indietro: '#/' })}<div class="vuoto"><span class="ic">${icona('warn', 30)}</span><b>Questa pagina non esiste</b></div>`;
}

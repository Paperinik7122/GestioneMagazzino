import { icona, intestazione } from '../../ui/kit.js';

export function magazzinoProvvisorio(vista) {
  vista.innerHTML = `${intestazione('Magazzino')}<div class="vuoto"><span class="ic">${icona('box', 30)}</span><b>In arrivo</b>
    <span>L’elenco dei prodotti, le posizioni e il dettaglio per codice arrivano nel prossimo aggiornamento.</span></div>`;
}

export function nonTrovata(vista) {
  vista.innerHTML = `${intestazione('Pagina non trovata', { indietro: '#/' })}<div class="vuoto"><span class="ic">${icona('warn', 30)}</span><b>Questa pagina non esiste</b></div>`;
}

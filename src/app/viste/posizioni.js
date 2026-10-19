// Gestione delle posizioni di magazzino (elenco chiuso: si sceglie, non si scrive a mano).
import { getDb, modificato } from '../../store.js';
import { elencoPosizioni, creaPosizione, rinominaPosizione, eliminaPosizione, unisciPosizioni } from '../../domain/posizioni.js';
import { esc, num, icona, campo } from '../../ui/kit.js';
import { apriFoglio, mostraErrore, conferma, toast } from '../ui.js';

/** Elenco delle posizioni con creazione, modifica, unione ed eliminazione. dopo() si chiama a ogni modifica. */
export function foglioPosizioni(dopo) {
  const { chiudi, radice } = apriFoglio('');
  const mostra = () => {
    const pos = elencoPosizioni(getDb());
    radice.innerHTML = `<h2>Posizioni</h2>
      <p class="muted piccolo" style="margin:-6px 0 12px">Dove sono i prodotti. Quando arriva merce nuova va in “Da collocare” finché non scegli la posizione.</p>
      ${pos.map((p) => `<button class="opz" data-p="${p.id}"><div class="r1"><span class="sx">${icona('pin', 18)} ${esc(p.nome)}</span>${icona('chevron', 18)}</div>
        <div class="r2">${num(p.n_prodotti, 'prodotto', 'prodotti')}</div></button>`).join('')}
      ${campo('Nuova posizione', '<input id="f-nuova" autocomplete="off" placeholder="es. Scatola 12">')}
      <div class="barra"><button class="btn sec" data-chiudi-p>Chiudi</button><button class="btn" id="aggiungi">Aggiungi</button></div>`;
    radice.querySelector('[data-chiudi-p]').onclick = chiudi;
    radice.querySelector('#aggiungi').onclick = () => {
      try {
        creaPosizione(getDb(), radice.querySelector('#f-nuova').value);
        modificato(); dopo(); mostra(); toast('Posizione aggiunta');
      } catch (e) { mostraErrore(radice, e); }
    };
    radice.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => foglioPosizione(Number(b.dataset.p), chiudi, dopo, mostra); });
  };
  mostra();
}

function foglioPosizione(id, chiudiElenco, dopo, riapri) {
  const db = getDb();
  const lista = elencoPosizioni(db);
  const p = lista.find((x) => x.id === id);
  if (!p) return;
  const { chiudi, radice } = apriFoglio(`<h2>${esc(p.nome)}</h2>
    <p class="muted piccolo" style="margin:-6px 0 12px">${num(p.n_prodotti, 'prodotto', 'prodotti')} in questa posizione.</p>
    ${p.speciale ? '' : campo('Nome', `<input id="f-nome" value="${esc(p.nome)}" autocomplete="off">`)}
    <div class="barra"><button class="btn sec" data-chiudi>Indietro</button>${p.speciale ? '' : '<button class="btn" id="salva">Salva nome</button>'}</div>
    <div class="barra"><a class="btn sec" id="vedi" href="#/magazzino?p=${p.speciale ? 'da_collocare' : p.id}">Vedi i prodotti</a></div>
    ${p.speciale ? '' : '<div class="barra"><button class="btn sec" id="unisci">Unisci in…</button><button class="btn peric" id="elimina">Elimina</button></div>'}`);
  radice.querySelector('#vedi').onclick = () => { chiudi(); chiudiElenco(); };
  if (p.speciale) return;
  radice.querySelector('#salva').onclick = () => {
    try {
      rinominaPosizione(db, id, radice.querySelector('#f-nome').value);
      modificato(); chiudi(); dopo(); riapri(); toast('Nome salvato');
    } catch (e) { mostraErrore(radice, e); }
  };
  radice.querySelector('#elimina').onclick = async () => {
    try {
      if (p.n_prodotti) eliminaPosizione(db, id); // lancia l'errore previsto
      chiudi();
      if (!(await conferma({ titolo: 'Eliminare la posizione?', testo: p.nome, etichetta: 'Elimina', pericolo: true }))) return;
      eliminaPosizione(db, id); modificato(); dopo(); riapri(); toast('Posizione eliminata');
    } catch (e) { mostraErrore(radice, e); }
  };
  radice.querySelector('#unisci').onclick = () => {
    chiudi();
    const altre = lista.filter((x) => x.id !== id);
    const f = apriFoglio(`<h2>Unisci “${esc(p.nome)}” in…</h2>
      <p class="muted piccolo" style="margin-bottom:12px">I ${num(p.n_prodotti, 'prodotto', 'prodotti')} passano alla posizione scelta e “${esc(p.nome)}” viene eliminata.</p>
      ${altre.map((x) => `<button class="opz" data-a="${x.id}"><div class="r1"><span class="sx">${icona('pin', 18)} ${esc(x.nome)}</span></div></button>`).join('')}
      <div class="barra"><button class="btn sec" data-chiudi>Annulla</button></div>`);
    f.radice.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => {
        try {
          unisciPosizioni(db, id, Number(b.dataset.a));
          modificato(); f.chiudi(); dopo(); riapri(); toast('Posizioni unite');
        } catch (e) { mostraErrore(f.radice, e); }
      };
    });
  };
}

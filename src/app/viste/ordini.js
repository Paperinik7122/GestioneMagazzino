import { getDb, modificato } from '../../store.js';
import { elencoOrdini, creaOrdine } from '../../domain/ordini.js';
import { elencoContatti } from '../../domain/contatti.js';
import { oggiIso } from '../../domain/errori.js';
import { icona, chip, tagTipo, esc, euro, dataIt, num, intestazione, campo } from '../../ui/kit.js';
import { apriFoglio, mostraErrore } from '../ui.js';

const filtro = { tipo: 'T', testo: '', chiusi: false };

function etichette(o) {
  if (o.evaso) return chip('grigio', `Chiuso il ${dataIt(o.data_evasione)}`, 'lock');
  if (!o.nRighe) return chip('grigio', 'Vuoto', 'empty');
  if (o.tipo === 'A') {
    return o.ricevute === o.nRighe ? chip('verde', 'Tutto ricevuto', 'ok')
      : chip('viola', `${o.ricevute}/${o.nRighe} ricevuti`, o.ricevute ? 'part' : 'hourglass');
  }
  const out = [];
  if (o.collegate) out.push(chip('verde', `${o.collegate} pronti`, 'ok'));
  if (o.disponibili) out.push(chip('ambra', `${o.disponibili} da collegare`, 'link'));
  if (o.daOrdinare) out.push(chip('rosso', `${o.daOrdinare} da ordinare`, 'cart'));
  return out.join('');
}

function scheda(o) {
  return `<a class="ordine ${o.tipo} ${o.evaso ? 'chiuso' : ''}" href="#/ordine/${o.id}">
    <div class="r1"><span class="num">#${o.id}</span><span class="chi">${esc(o.contatto)}</span><span class="tot">${euro(o.totaleCorrente)}</span></div>
    <div class="r2">${tagTipo(o.tipo)}${etichette(o)}</div>
    <div class="meta">${dataIt(o.data_emissione)}${o.catalogo ? ` · catalogo ${esc(o.catalogo)}` : ''} · ${num(o.nRighe, 'prodotto', 'prodotti')}</div>
  </a>`;
}

export function ordini(vista, query) {
  if (query.get('t')) { filtro.tipo = query.get('t'); filtro.chiusi = false; }
  vista.innerHTML = `${intestazione('Ordini', { destra: `<button class="icon-btn pieno" id="nuovo" aria-label="Nuovo ordine">${icona('plus', 24, 2.4)}</button>` })}
    <div class="ricerca">${icona('search', 20)}<input id="cerca" type="search" placeholder="Cerca numero, nome o catalogo" value="${esc(filtro.testo)}" autocomplete="off"></div>
    <div class="segmenti" role="group">
      ${[['T', 'Tutti'], ['V', 'Clienti'], ['A', 'Fornitori']].map(([k, t]) => `<button data-t="${k}" aria-pressed="${filtro.tipo === k}">${t}</button>`).join('')}
    </div>
    <label class="interruttore"><input type="checkbox" id="chiusi" ${filtro.chiusi ? 'checked' : ''}>Mostra anche gli ordini chiusi</label>
    <div class="lista" id="lista"></div>`;

  const lista = vista.querySelector('#lista');
  const disegna = () => {
    const righe = elencoOrdini(getDb(), {
      tipi: filtro.tipo === 'T' ? ['V', 'A'] : [filtro.tipo], conEvasi: filtro.chiusi, testo: filtro.testo,
    });
    lista.innerHTML = righe.length ? righe.map(scheda).join('') : `<div class="vuoto"><span class="ic">${icona('orders', 30)}</span>
      <b>${filtro.testo ? 'Nessun ordine trovato' : 'Nessun ordine aperto'}</b>
      <span>${filtro.testo ? 'Prova con un altro nome o numero.' : 'Crea un nuovo ordine con il pulsante +.'}</span></div>`;
  };
  disegna();
  vista.querySelector('#cerca').oninput = (e) => { filtro.testo = e.target.value; disegna(); };
  vista.querySelector('#chiusi').onchange = (e) => { filtro.chiusi = e.target.checked; disegna(); };
  vista.querySelectorAll('[data-t]').forEach((b) => {
    b.onclick = () => {
      filtro.tipo = b.dataset.t;
      vista.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      disegna();
    };
  });
  vista.querySelector('#nuovo').onclick = () => foglioNuovoOrdine(filtro.tipo === 'A' ? 'A' : 'V');
}

/** Foglio "Nuovo ordine" (cliente o fornitore). */
export function foglioNuovoOrdine(tipoIniziale = 'V') {
  const db = getDb();
  let tipo = tipoIniziale;
  const nomi = (t) => elencoContatti(db, t).map((c) => `<option value="${esc(c.nome)}">`).join('');
  const { chiudi, radice } = apriFoglio(`<h2>Nuovo ordine</h2>
    <div class="segmenti" role="group">
      <button data-tp="V" aria-pressed="${tipo === 'V'}">Cliente</button><button data-tp="A" aria-pressed="${tipo === 'A'}">Fornitore</button>
    </div>
    ${campo('Nome', `<input id="f-nome" list="l-nomi" autocomplete="off" autocapitalize="words" autofocus><datalist id="l-nomi"></datalist>`)}
    ${campo('Data', `<input id="f-data" type="date" value="${oggiIso()}">`)}
    ${campo('Numero catalogo', '<input id="f-cat" inputmode="numeric" autocomplete="off">')}
    ${campo('Note', '<textarea id="f-note"></textarea>')}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="crea">Crea ordine</button></div>`);
  const dl = radice.querySelector('#l-nomi');
  const aggiorna = () => { dl.innerHTML = nomi(tipo === 'A' ? 'F' : 'C'); };
  aggiorna();
  radice.querySelectorAll('[data-tp]').forEach((b) => {
    b.onclick = () => {
      tipo = b.dataset.tp;
      radice.querySelectorAll('[data-tp]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      aggiorna();
    };
  });
  radice.querySelector('#crea').onclick = () => {
    try {
      const id = creaOrdine(db, {
        tipo, contatto: radice.querySelector('#f-nome').value, data: radice.querySelector('#f-data').value,
        catalogo: radice.querySelector('#f-cat').value, note: radice.querySelector('#f-note').value,
      });
      modificato();
      chiudi();
      location.hash = `#/ordine/${id}`;
    } catch (e) { mostraErrore(radice, e); }
  };
}

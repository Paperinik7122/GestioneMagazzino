// Elenco dei prodotti in magazzino, raggruppati per codice.
import { getDb } from '../../store.js';
import { elencoMagazzino, riepilogoMagazzino } from '../../domain/magazzino.js';
import { elencoPosizioni } from '../../domain/posizioni.js';
import { POSIZIONE_DA_COLLOCARE } from '../../db/schema.js';
import { icona, chip, esc, num, intestazione } from '../../ui/kit.js';
import { foglioNuovoProdotto } from './prodotto.js';
import { foglioPosizioni } from './posizioni.js';

const filtro = { testo: '', pos: '' };

function scheda(r) {
  const posizioni = (r.posizioni ?? '').split(',').filter((x) => x && x !== POSIZIONE_DA_COLLOCARE);
  const altre = r.quantita - r.da_collocare;
  return `<a class="riga link" href="#/codice/${encodeURIComponent(r.codice)}">
    <div class="r1"><div class="nome">${esc(r.nome)}<div class="cod">codice ${esc(r.codice)}</div></div>
      <span class="qta" title="Prodotti in magazzino">${r.quantita}</span></div>
    <div class="r2">
      ${r.da_collocare ? chip('ambra', `${r.da_collocare} da collocare`, 'pin') : ''}
      ${altre && posizioni.length ? chip('grigio', posizioni.join(' · '), 'pin') : ''}
      ${r.impegnati ? chip('blu', `${r.impegnati} per ordini aperti`, 'link') : ''}
    </div></a>`;
}

export function magazzino(vista, query) {
  if (query.get('f') === 'da_collocare') { filtro.pos = 'da_collocare'; filtro.testo = ''; }
  else if (query.get('p')) { filtro.pos = query.get('p'); filtro.testo = ''; }
  const db = getDb();
  const mag = riepilogoMagazzino(db);
  const pos = elencoPosizioni(db);
  if (filtro.pos && filtro.pos !== 'da_collocare' && !pos.some((p) => String(p.id) === filtro.pos)) filtro.pos = '';

  vista.innerHTML = `${intestazione('Magazzino', { destra: `<button class="icon-btn" id="posizioni" aria-label="Posizioni">${icona('pin', 24)}</button>
      <button class="icon-btn pieno" id="nuovo" aria-label="Nuovo prodotto">${icona('plus', 24, 2.4)}</button>` })}
    <div class="ricerca">${icona('search', 20)}<input id="cerca" type="search" placeholder="Cerca per nome o codice" value="${esc(filtro.testo)}" autocomplete="off"></div>
    <label class="campo"><span class="lab">Posizione</span><select id="pos">
      <option value="">Tutte le posizioni</option>
      ${pos.map((p) => `<option value="${p.speciale ? 'da_collocare' : p.id}" ${String(p.speciale ? 'da_collocare' : p.id) === filtro.pos ? 'selected' : ''}>${esc(p.nome)} (${p.n_prodotti})</option>`).join('')}
    </select></label>
    <p class="muted piccolo" id="somma" style="margin:0 2px 12px"></p>
    <div class="lista" id="lista"></div>`;

  const lista = vista.querySelector('#lista');
  const disegna = () => {
    const righe = elencoMagazzino(getDb(), { testo: filtro.testo, posizioneId: filtro.pos === '' ? null : filtro.pos === 'da_collocare' ? 'da_collocare' : Number(filtro.pos) });
    const tot = righe.reduce((s, r) => s + r.quantita, 0);
    vista.querySelector('#somma').textContent = `${num(tot, 'prodotto', 'prodotti')} · ${num(righe.length, 'codice', 'codici')}`;
    if (!righe.length) {
      const filtrato = filtro.testo || filtro.pos;
      lista.innerHTML = `<div class="vuoto"><span class="ic">${icona('box', 30)}</span>
        <b>${filtrato ? 'Nessun prodotto trovato' : 'Il magazzino è vuoto'}</b>
        <span>${filtrato ? 'Prova con un altro nome, un altro codice o un’altra posizione.' : 'I prodotti entrano quando ricevi un ordine fornitore, oppure con il pulsante +.'}</span></div>`;
      return;
    }
    lista.innerHTML = righe.map(scheda).join('');
  };
  disegna();
  vista.querySelector('#cerca').oninput = (e) => { filtro.testo = e.target.value; disegna(); };
  vista.querySelector('#pos').onchange = (e) => { filtro.pos = e.target.value; disegna(); };
  vista.querySelector('#nuovo').onclick = () => foglioNuovoProdotto({}, (codice) => { location.hash = `#/codice/${encodeURIComponent(codice.trim())}`; });
  vista.querySelector('#posizioni').onclick = () => foglioPosizioni(() => magazzino(vista, new URLSearchParams()));
  void mag;
}

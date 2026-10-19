import { getDb, meta } from '../../store.js';
import { elencoOrdini } from '../../domain/ordini.js';
import { riepilogoMagazzino } from '../../domain/magazzino.js';
import { icona, esc, num } from '../../ui/kit.js';
import { oggiIso } from '../../domain/errori.js';
import { foglioNuovoOrdine } from './ordini.js';

const GIORNI_BACKUP = 14;

function giorniDa(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.parse(oggiIso()) - Date.parse(iso.slice(0, 10))) / 86400000);
  return Number.isFinite(d) ? d : null;
}

export function home(vista) {
  const db = getDb();
  const clienti = elencoOrdini(db, { tipi: ['V'] });
  const fornitori = elencoOrdini(db, { tipi: ['A'] });
  const mag = riepilogoMagazzino(db);
  const daOrdinare = clienti.reduce((s, o) => s + o.daOrdinare, 0);
  const pronti = clienti.filter((o) => o.nRighe > 0 && o.collegate === o.nRighe).length;
  const inAttesa = fornitori.reduce((s, o) => s + (o.nRighe - o.ricevute), 0);
  const gg = giorniDa(meta('ultimo_backup'));

  const eroe = daOrdinare > 0
    ? `<a class="eroe" href="#/ordini"><span class="num">${daOrdinare}</span><span class="tx"><b>Prodotti da ordinare</b><span>mancano in magazzino per gli ordini dei clienti</span></span>${icona('chevron', 24)}</a>`
    : `<a class="eroe ok" href="#/ordini"><span class="num">${icona('ok', 40, 2)}</span><span class="tx"><b>Niente da ordinare</b><span>${pronti ? `${num(pronti, 'ordine cliente pronto', 'ordini cliente pronti')} da consegnare` : 'gli ordini cliente aperti sono coperti'}</span></span>${icona('chevron', 24)}</a>`;

  const avvisi = [];
  if (gg === null || gg > GIORNI_BACKUP) {
    avvisi.push(['', 'warn', gg === null ? 'Non hai ancora fatto nessun backup.' : `L’ultimo backup risale a ${num(gg, 'giorno', 'giorni')} fa.`]);
  }
  if (mag.senzaDataAcquisto) avvisi.push(['', 'calendar', `${num(mag.senzaDataAcquisto, 'prodotto', 'prodotti')} in magazzino senza data di acquisto.`]);

  vista.innerHTML = `
    <header class="top"><h1>Gestione Magazzino</h1></header>
    <p class="saluto">Ordini aperti e magazzino, in breve.</p>
    ${eroe}
    <div class="griglia">
      <a class="tessera cl" href="#/ordini?t=V"><span class="ic">${icona('user', 20)}</span><div class="n">${clienti.length}</div><div class="et">Ordini cliente</div><div class="sub">${pronti} pronti</div></a>
      <a class="tessera fo" href="#/ordini?t=A"><span class="ic">${icona('truck', 20)}</span><div class="n">${fornitori.length}</div><div class="et">Ordini fornitore</div><div class="sub">${num(inAttesa, 'prodotto atteso', 'prodotti attesi')}</div></a>
      <a class="tessera mg" href="#/magazzino"><span class="ic">${icona('box', 20)}</span><div class="n">${mag.prodotti}</div><div class="et">Prodotti</div><div class="sub">${num(mag.codici, 'codice', 'codici')}</div></a>
      <a class="tessera dc ${mag.daCollocare ? 'evidenza' : ''}" href="#/magazzino?f=da_collocare"><span class="ic">${icona('pin', 20)}</span><div class="n">${mag.daCollocare}</div><div class="et">Da collocare</div><div class="sub">${mag.daCollocare ? 'in attesa di posizione' : 'tutto a posto'}</div></a>
    </div>
    ${avvisi.map(([c, ic, t]) => `<div class="avviso ${c}">${icona(ic, 20)}<span>${esc(t)}</span></div>`).join('')}
    <div class="sezione"><h2>Azioni rapide</h2></div>
    <div class="azioni">
      <button class="azione" data-nuovo="V" style="border:0;font:inherit"><span class="ic">${icona('plus', 22)}</span>Ordine cliente</button>
      <button class="azione" data-nuovo="A" style="border:0;font:inherit"><span class="ic">${icona('plus', 22)}</span>Ordine fornitore</button>
      <a class="azione" href="#/magazzino"><span class="ic">${icona('box', 22)}</span>Magazzino</a>
    </div>`;
  vista.querySelectorAll('[data-nuovo]').forEach((b) => { b.onclick = () => foglioNuovoOrdine(b.dataset.nuovo); });
}

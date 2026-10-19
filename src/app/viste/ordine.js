// Schermata di un ordine: cliente (collega al magazzino, consegna) o fornitore (ricezione, autocompila).
import { getDb, modificato } from '../../store.js';
import {
  dettaglioOrdine, aggiungiRighe, eliminaRiga, collegaRiga, scollegaRiga, consegnaOrdine, eliminaOrdine, modificaOrdine,
} from '../../domain/ordini.js';
import { impostaQuantitaRicevuta, aggiungiOmaggio, chiudiRicezione, proposteAutocompila, applicaAutocompila } from '../../domain/ricezione.js';
import { disponibilita, cercaCodici } from '../../domain/codici.js';
import { elencoContatti } from '../../domain/contatti.js';
import { scalar } from '../../db/util.js';
import { oggiIso, ErroreDominio } from '../../domain/errori.js';
import { icona, chip, tagTipo, esc, euro, dataIt, num, intestazione, campo } from '../../ui/kit.js';
import { apriFoglio, mostraErrore, conferma, toast } from '../ui.js';

let vistaCorrente = null;
let idCorrente = null;

function ridisegna() {
  if (!vistaCorrente) return;
  const y = window.scrollY;
  ordine(vistaCorrente, null, idCorrente);
  window.scrollTo(0, y);
}

/** Esegue una modifica, salva e ridisegna; mostra l'errore previsto nel foglio o come avviso. */
function applica(fn, radice = null) {
  try {
    const r = fn();
    modificato();
    return { ok: true, r };
  } catch (e) {
    if (radice) mostraErrore(radice, e);
    else if (e instanceof ErroreDominio) toast(e.message, { ms: 5000 });
    else { console.error(e); toast('Qualcosa non ha funzionato. Riprova.'); }
    return { ok: false };
  }
}

export function ordine(vista, _q, id) {
  vistaCorrente = vista;
  idCorrente = Number(id);
  let d;
  try { d = dettaglioOrdine(getDb(), idCorrente); } catch { d = null; }
  if (!d) {
    vista.innerHTML = `${intestazione('Ordine', { indietro: '#/ordini' })}<div class="vuoto"><span class="ic">${icona('warn', 30)}</span><b>Ordine non trovato</b></div>`;
    return;
  }
  const o = d.ordine;
  const aperto = !o.evaso;
  const destra = aperto ? `<button class="icon-btn" id="modifica" aria-label="Modifica ordine">${icona('edit', 22)}</button>` : '';
  vista.innerHTML = `${intestazione(`Ordine #${o.id}`, { indietro: '#/ordini', destra })}
    <div class="riepilogo ${o.tipo}">
      <div class="r1"><span class="chi">${esc(o.contatto)}</span><span class="tot">${euro(d.totale)}</span></div>
      <div class="r2" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${tagTipo(o.tipo)}${o.evaso ? chip('grigio', `Chiuso il ${dataIt(o.data_evasione)}`, 'lock') : ''}</div>
      <div class="meta">${dataIt(o.data_emissione)}${o.catalogo ? ` · catalogo ${esc(o.catalogo)}` : ''} · ${num(d.righe.length, 'prodotto', 'prodotti')}</div>
      ${o.note ? `<p class="note">${esc(o.note)}</p>` : ''}
    </div>
    <div class="sezione"><h2>Prodotti</h2>${aperto ? `<a href="#" id="aggiungi">+ Aggiungi</a>` : ''}</div>
    <div class="lista" id="righe">${o.tipo === 'V' ? righeCliente(d) : righeFornitore(d)}</div>
    ${aperto ? azioniFondo(d) : ''}`;

  vista.querySelector('#modifica')?.addEventListener('click', () => foglioModifica(o, d));
  vista.querySelector('#aggiungi')?.addEventListener('click', (e) => { e.preventDefault(); foglioProdotto(o); });
  vista.querySelector('#vuoto-aggiungi')?.addEventListener('click', () => foglioProdotto(o));
  vista.querySelector('#elimina-ordine')?.addEventListener('click', () => eliminaOrdineConferma(o));
  vista.querySelector('#consegna')?.addEventListener('click', () => foglioConsegna(o, d));
  vista.querySelector('#chiudi-ric')?.addEventListener('click', () => foglioChiusura(o, d));
  vista.querySelector('#autocompila')?.addEventListener('click', () => foglioAutocompila(o));
  vista.querySelector('#omaggio')?.addEventListener('click', () => foglioOmaggio(o));

  vista.querySelectorAll('[data-collega]').forEach((b) => { b.onclick = () => foglioCollega(Number(b.dataset.collega)); });
  vista.querySelectorAll('[data-scollega]').forEach((b) => {
    b.onclick = () => { if (applica(() => scollegaRiga(getDb(), Number(b.dataset.scollega))).ok) ridisegna(); };
  });
  vista.querySelectorAll('[data-toglie]').forEach((b) => {
    b.onclick = async () => {
      if (!(await conferma({ titolo: 'Togliere il prodotto?', testo: b.dataset.nome, etichetta: 'Togli', pericolo: true }))) return;
      const ids = b.dataset.toglie.split(',').map(Number);
      if (applica(() => ids.forEach((i) => eliminaRiga(getDb(), i))).ok) ridisegna();
    };
  });
  vista.querySelectorAll('[data-ric]').forEach((b) => {
    b.onclick = () => {
      const [codice, omaggio, q] = b.dataset.ric.split('|');
      if (applica(() => impostaQuantitaRicevuta(getDb(), o.id, codice, Number(q), { omaggio: omaggio === '1' })).ok) ridisegna();
    };
  });
}

/* ---------- ordine cliente ---------- */
function righeCliente(d) {
  if (!d.righe.length) return vuotoRighe(d.ordine);
  return d.righe.map((r) => {
    const aperto = !d.ordine.evaso;
    let stato;
    if (r.magazzino_id) {
      const dettaglio = [
        r.collegato_codice !== r.codice ? `codice ${esc(r.collegato_codice)} (simile)` : '',
        r.collegato_data ? `acquistato il ${dataIt(r.collegato_data)}` : 'senza data di acquisto',
        r.collegato_prezzo !== null ? `a ${euro(r.collegato_prezzo)}` : '',
      ].filter(Boolean).join(' · ');
      stato = `<div class="r2">${chip('verde', 'Collegato', 'ok')}${r.posizione ? chip('grigio', r.posizione, 'pin') : ''}</div><div class="dett">${dettaglio}</div>`;
    } else if (aperto) {
      const x = r.disp ?? { nStesso: 0, nSimili: 0, nImpegnati: 0 };
      const c = [];
      if (x.nStesso) c.push(chip('verde', `${x.nStesso} in magazzino`, 'box'));
      if (x.nSimili) c.push(chip('ambra', `${num(x.nSimili, 'simile', 'simili')}`, 'swap'));
      if (x.nImpegnati) c.push(chip('grigio', `${x.nImpegnati} già assegnati`, 'lock'));
      if (!x.nStesso && !x.nSimili) c.push(chip('rosso', 'Da ordinare', 'cart'));
      stato = `<div class="r2">${c.join('')}</div>`;
    } else stato = '';
    const az = aperto ? `<div class="azioni-riga">
      ${r.magazzino_id
    ? `<button class="btn sec mini" data-scollega="${r.id}">${icona('link', 16)}Scollega</button>`
    : `<button class="btn mini" data-collega="${r.id}">${icona('link', 16)}Collega</button>`}
      <button class="btn mini ghost" data-toglie="${r.id}" data-nome="${esc(r.nome)}" aria-label="Togli">${icona('trash', 16)}Togli</button></div>` : '';
    return `<div class="riga"><div class="r1"><div class="nome">${esc(r.nome)}<div class="cod">${esc(r.codice)}</div></div><div class="prezzo">${euro(r.prezzo)}</div></div>${stato}${az}</div>`;
  }).join('');
}

/** Collegamento manuale: una sola schermata con stesso codice e simili. */
function foglioCollega(rigaId) {
  const db = getDb();
  const d = dettaglioOrdine(db, idCorrente);
  const riga = d.righe.find((r) => r.id === rigaId);
  if (!riga) return;
  const disp = disponibilita(db, riga.codice);
  const opz = (p, codice, nome) => `<button class="opz" data-m="${p.id}">
    <div class="r1"><span class="sx">${esc(nome ?? p.nome)}</span><span>${euro(p.prezzo_acquisto)}</span></div>
    <div class="r2">${chip('grigio', `codice ${codice}`)}${p.catalogo_acquisto ? `<span>catalogo ${esc(p.catalogo_acquisto)}</span>` : ''}
    <span>${p.data_acquisto ? `acquistato il ${dataIt(p.data_acquisto)}` : 'senza data di acquisto'}</span>
    ${p.da_collocare ? chip('ambra', 'Da collocare', 'pin') : (p.posizione ? chip('grigio', p.posizione, 'pin') : '')}</div></button>`;
  let html = `<h2>Collega “${esc(riga.nome)}”</h2>`;
  if (disp.stessoCodice.length) html += `<div class="gruppo-tit">Stesso codice · ${esc(riga.codice)}</div>${disp.stessoCodice.map((p) => opz(p, riga.codice)).join('')}`;
  for (const s of disp.simili) html += `<div class="gruppo-tit">Simile · ${esc(s.codice)}</div>${s.prodotti.map((p) => opz(p, s.codice, s.nome)).join('')}`;
  if (!disp.stessoCodice.length && !disp.simili.length) {
    html += `<div class="vuoto" style="padding:24px 8px"><span class="ic">${icona('cart', 28)}</span><b>Niente di disponibile</b>
      <span>${disp.nImpegnati ? `${num(disp.nImpegnati, 'prodotto è già assegnato', 'prodotti sono già assegnati')} ad altri ordini. ` : ''}Va ordinato al fornitore.</span></div>`;
  }
  html += `<div class="barra"><button class="btn sec" data-chiudi>Chiudi</button></div>`;
  const { chiudi, radice } = apriFoglio(html);
  radice.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = () => {
      if (applica(() => collegaRiga(db, rigaId, Number(b.dataset.m)), radice).ok) { chiudi(); toast('Prodotto collegato'); ridisegna(); }
    };
  });
}

function foglioConsegna(o, d) {
  const { chiudi, radice } = apriFoglio(`<h2>Consegna ordine #${o.id}</h2>
    <p class="muted" style="margin-bottom:12px">${num(d.righe.length, 'prodotto esce', 'prodotti escono')} dal magazzino. Totale ${euro(d.totale)}.</p>
    ${campo('Data di consegna', `<input id="f-data" type="date" value="${oggiIso()}">`)}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Consegna</button></div>`);
  radice.querySelector('#ok').onclick = () => {
    const r = applica(() => consegnaOrdine(getDb(), o.id, radice.querySelector('#f-data').value), radice);
    if (r.ok) { chiudi(); toast(`Ordine consegnato · ${euro(r.r)}`); ridisegna(); }
  };
}

/* ---------- ordine fornitore ---------- */
function righeFornitore(d) {
  if (!d.gruppi.length) return vuotoRighe(d.ordine);
  const aperto = !d.ordine.evaso;
  return d.gruppi.map((g) => {
    const chiave = `${esc(g.codice)}|${g.omaggio ? 1 : 0}`;
    const completo = g.ricevute === g.quantita;
    const stato = !aperto ? '' : `<div class="r2">${g.omaggio ? chip('rosa', 'In più / omaggio', 'gift') : ''}
      <div class="contatore">
        <button data-ric="${chiave}|${g.ricevute - 1}" ${g.ricevute <= 0 ? 'disabled' : ''} aria-label="Uno in meno">${icona('minus', 18, 2.4)}</button>
        <span class="val">${g.ricevute}/${g.quantita}</span>
        <button data-ric="${chiave}|${g.ricevute + 1}" ${completo ? 'disabled' : ''} aria-label="Uno in più">${icona('plus', 18, 2.4)}</button>
        <button class="tutto ${completo ? 'on' : ''}" data-ric="${chiave}|${completo ? 0 : g.quantita}" aria-label="Tutti arrivati">${icona('ok', 22)}</button>
      </div></div>`;
    const togli = aperto ? `<div class="azioni-riga"><button class="btn mini ghost" data-toglie="${g.righe.join(',')}" data-nome="${esc(g.nome)}">${icona('trash', 16)}Togli</button></div>` : '';
    return `<div class="riga ${completo && aperto ? 'ok-ric' : ''}"><div class="r1"><div class="nome">${g.quantita > 1 ? `${g.quantita} × ` : ''}${esc(g.nome)}<div class="cod">${esc(g.codice)}</div></div>
      <div class="prezzo">${g.omaggio ? 'omaggio' : euro(g.prezzo * g.quantita)}</div></div>${stato}${togli}</div>`;
  }).join('');
}

function foglioOmaggio(o) {
  const { chiudi, radice } = apriFoglio(`<h2>Prodotto in più</h2>
    <p class="muted piccolo" style="margin-bottom:12px">Per promozioni o regali del fornitore non presenti nell’ordine: risulta già arrivato, a prezzo zero.</p>
    ${campiProdotto({ prezzo: false })}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Aggiungi</button></div>`);
  collegaSuggerimenti(radice, { prezzo: false });
  radice.querySelector('#ok').onclick = () => {
    const v = (s) => radice.querySelector(s).value;
    if (applica(() => aggiungiOmaggio(getDb(), o.id, { codice: v('#f-cod'), nome: v('#f-nome'), quantita: v('#f-q') }), radice).ok) { chiudi(); ridisegna(); }
  };
}

function foglioChiusura(o, d) {
  const arrivati = d.gruppi.reduce((s, g) => s + g.ricevute, 0);
  const mancano = d.righe.length - arrivati;
  const tot = d.righe.filter((r) => r.ricevuta).reduce((s, r) => s + r.prezzo, 0);
  const { chiudi, radice } = apriFoglio(`<h2>Chiudi la ricezione</h2>
    <p style="margin-bottom:6px"><b>${num(arrivati, 'prodotto arrivato', 'prodotti arrivati')}</b> (${euro(tot)}) ${arrivati === 1 ? 'entra' : 'entrano'} in magazzino come “Da collocare”.</p>
    ${mancano ? `<p class="avviso" style="margin:8px 0">${icona('warn', 20)}<span>${num(mancano, 'prodotto non arrivato viene stralciato', 'prodotti non arrivati vengono stralciati')} dall’ordine.</span></p>` : ''}
    ${campo('Data di arrivo', `<input id="f-data" type="date" value="${oggiIso()}">`)}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Chiudi ricezione</button></div>`);
  radice.querySelector('#ok').onclick = () => {
    const r = applica(() => chiudiRicezione(getDb(), o.id, radice.querySelector('#f-data').value), radice);
    if (r.ok) { chiudi(); toast(`${num(r.r.arrivati, 'prodotto in magazzino', 'prodotti in magazzino')}`); ridisegna(); }
  };
}

/** Autocompila: propone, l'utente decide le quantità. I simili sono solo segnalati. */
function foglioAutocompila(o) {
  const db = getDb();
  const prop = proposteAutocompila(db, o.id);
  if (!prop.length) { toast('Niente da aggiungere: gli ordini cliente sono coperti'); return; }
  const qta = new Map(prop.map((p) => [p.codice, p.mancanti]));
  const riga = (p) => `<div class="prop" data-cod="${esc(p.codice)}">
    <div class="r1"><div class="nome">${esc(p.nome)}<div class="cod" style="font-size:.8rem;color:var(--muted)">${esc(p.codice)} · ${euro(p.prezzo)}</div></div>
    <div class="contatore"><button data-d="-1" aria-label="Meno">${icona('minus', 18, 2.4)}</button><span class="val">${p.mancanti}</span><button data-d="1" aria-label="Più">${icona('plus', 18, 2.4)}</button></div></div>
    <div class="dett">Richiesti ${p.richiesti} · in magazzino liberi ${p.liberi} · già ordinati ${p.giaOrdinati} · mancano ${p.mancanti}
      · ordini cliente ${p.ordiniCliente.map((n) => `#${n}`).join(', ')}</div>
    ${p.cataloghiDiversi ? `<div class="avv">Catalogo dei clienti: ${esc(p.cataloghi.join(', '))} — diverso da questo ordine (${esc(o.catalogo || '—')}). Controlla il prezzo.</div>` : ''}
    ${p.simili.length ? `<div class="avv">Simili in magazzino: ${p.simili.map((s) => `${esc(s.codice)} (${s.disponibili})`).join(', ')} — puoi usarli collegando a mano.</div>` : ''}</div>`;
  const { chiudi, radice } = apriFoglio(`<h2>Autocompila ordine</h2>
    <p class="muted piccolo" style="margin-bottom:12px">Prodotti richiesti dai clienti che non hai né in magazzino né già ordinati. Scegli quanti aggiungere.</p>
    ${prop.map(riga).join('')}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Aggiungi all’ordine</button></div>`);
  radice.querySelectorAll('.prop').forEach((el) => {
    const cod = el.dataset.cod;
    const max = prop.find((p) => p.codice === cod).mancanti;
    el.querySelectorAll('[data-d]').forEach((b) => {
      b.onclick = () => {
        const q = Math.max(0, Math.min(max + 20, qta.get(cod) + Number(b.dataset.d)));
        qta.set(cod, q);
        el.querySelector('.val').textContent = q;
      };
    });
  });
  radice.querySelector('#ok').onclick = () => {
    const r = applica(() => applicaAutocompila(db, o.id, [...qta].map(([codice, quantita]) => ({ codice, quantita }))), radice);
    if (r.ok) { chiudi(); toast(r.r ? `${num(r.r, 'prodotto aggiunto', 'prodotti aggiunti')}` : 'Nessuna modifica'); ridisegna(); }
  };
}

/* ---------- comuni ---------- */
function azioniFondo(d) {
  const o = d.ordine;
  const b = [];
  if (o.tipo === 'V') {
    b.push(`<button class="btn" id="consegna" ${d.puoConsegnare ? '' : 'disabled'}>${icona('ok', 20)}Consegna ordine</button>`);
    if (d.righe.length && d.nDaCollegare) b.push(`<p class="muted piccolo" style="flex-basis:100%;margin:0 2px">${num(d.nDaCollegare, 'prodotto', 'prodotti')} da collegare prima della consegna.</p>`);
  } else {
    b.push(`<button class="btn sec" id="autocompila">${icona('wand', 20)}Autocompila</button>`);
    b.push(`<button class="btn sec" id="omaggio">${icona('gift', 20)}Prodotto in più</button>`);
    const arrivati = d.righe.some((r) => r.ricevuta);
    b.push(`<button class="btn" id="chiudi-ric" ${arrivati ? '' : 'disabled'}>${icona('ok', 20)}Chiudi ricezione</button>`);
  }
  b.push(`<button class="btn peric" id="elimina-ordine">${icona('trash', 20)}Elimina ordine</button>`);
  return `<div class="barra-fissa">${b.join('')}</div>`;
}

function vuotoRighe(o) {
  return `<div class="vuoto"><span class="ic">${icona('box', 30)}</span><b>Nessun prodotto</b><span>Aggiungi i prodotti ${o.tipo === 'V' ? 'richiesti dal cliente' : 'da ordinare al fornitore'}.</span>
    ${o.evaso ? '' : `<button class="btn" id="vuoto-aggiungi">${icona('plus', 20)}Aggiungi prodotto</button>`}</div>`;
}

async function eliminaOrdineConferma(o) {
  if (!(await conferma({ titolo: `Eliminare l’ordine #${o.id}?`, testo: 'I prodotti collegati tornano disponibili. Non si può annullare.', etichetta: 'Elimina', pericolo: true }))) return;
  if (applica(() => eliminaOrdine(getDb(), o.id)).ok) { toast(`Ordine #${o.id} eliminato`); location.hash = '#/ordini'; }
}

function foglioModifica(o) {
  const db = getDb();
  const nomi = elencoContatti(db, o.tipo === 'A' ? 'F' : 'C').map((c) => `<option value="${esc(c.nome)}">`).join('');
  const { chiudi, radice } = apriFoglio(`<h2>Modifica ordine #${o.id}</h2>
    ${campo('Nome', `<input id="f-nome" list="l-nomi" value="${esc(o.contatto)}" autocomplete="off" autocapitalize="words"><datalist id="l-nomi">${nomi}</datalist>`)}
    ${campo('Data', `<input id="f-data" type="date" value="${esc(o.data_emissione)}">`)}
    ${campo('Numero catalogo', `<input id="f-cat" inputmode="numeric" value="${esc(o.catalogo)}" autocomplete="off">`)}
    ${campo('Note', `<textarea id="f-note">${esc(o.note)}</textarea>`)}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Salva</button></div>`);
  radice.querySelector('#ok').onclick = () => {
    const v = (s) => radice.querySelector(s).value;
    if (applica(() => modificaOrdine(db, o.id, { contatto: v('#f-nome'), data: v('#f-data'), catalogo: v('#f-cat'), note: v('#f-note') }), radice).ok) { chiudi(); ridisegna(); }
  };
}

/** Campi codice/nome/prezzo/quantità, con suggerimenti dal catalogo dei codici già noti. */
function campiProdotto({ prezzo = true } = {}) {
  return `${campo('Codice', '<input id="f-cod" list="l-cod" autocomplete="off" autocapitalize="characters" autofocus><datalist id="l-cod"></datalist>')}
    ${campo('Nome', '<input id="f-nome" autocomplete="off">')}
    ${prezzo ? campo('Prezzo di catalogo (€)', '<input id="f-prezzo" inputmode="decimal" autocomplete="off" placeholder="es. 6,50">') : ''}
    ${campo('Quantità', '<input id="f-q" type="number" min="1" max="200" value="1" inputmode="numeric">')}`;
}

function collegaSuggerimenti(radice, { prezzo = true } = {}) {
  const db = getDb();
  const cod = radice.querySelector('#f-cod');
  const nome = radice.querySelector('#f-nome');
  const dl = radice.querySelector('#l-cod');
  let trovati = [];
  const riempi = () => {
    const t = trovati.find((x) => x.codice.toLowerCase() === cod.value.trim().toLowerCase());
    if (!t) return;
    if (!nome.value) nome.value = t.nome;
    const pr = radice.querySelector('#f-prezzo');
    if (prezzo && pr && !pr.value) {
      const ultimo = scalar(db, 'SELECT prezzo FROM righe_ordine WHERE codice = ? AND omaggio = 0 ORDER BY id DESC LIMIT 1', [t.codice]);
      if (ultimo !== undefined && ultimo !== null) pr.value = String(ultimo).replace('.', ',');
    }
  };
  cod.addEventListener('input', () => {
    trovati = cercaCodici(db, cod.value);
    dl.innerHTML = trovati.map((t) => `<option value="${esc(t.codice)}" label="${esc(t.nome)}">`).join('');
    riempi();
  });
  cod.addEventListener('change', riempi);
}

function foglioProdotto(o) {
  const { chiudi, radice } = apriFoglio(`<h2>Aggiungi prodotto</h2>${campiProdotto()}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Aggiungi</button></div>`);
  collegaSuggerimenti(radice);
  radice.querySelector('#ok').onclick = () => {
    const v = (s) => radice.querySelector(s).value;
    if (applica(() => aggiungiRighe(getDb(), o.id, { codice: v('#f-cod'), nome: v('#f-nome'), prezzo: v('#f-prezzo'), quantita: v('#f-q') }), radice).ok) { chiudi(); ridisegna(); }
  };
}

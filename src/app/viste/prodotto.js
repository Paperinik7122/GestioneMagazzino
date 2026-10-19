// Fogli per i singoli prodotti in magazzino: nuovo, modifica, sposta, uscita.
import { getDb, modificato } from '../../store.js';
import { creaProdotti, modificaProdotto, segnaUscita, spostaProdotti, eliminaProdotto } from '../../domain/magazzino.js';
import { elencoPosizioni, idDaCollocare } from '../../domain/posizioni.js';
import { oggiIso, ErroreDominio } from '../../domain/errori.js';
import { MOTIVI_ENTRATA, MOTIVI_USCITA } from '../../db/schema.js';
import { esc, num, campo, icona } from '../../ui/kit.js';
import { apriFoglio, mostraErrore, conferma, toast } from '../ui.js';
import { comboProdotto } from '../campi.js';

const opzioniPosizioni = (db, scelta) => elencoPosizioni(db)
  .map((p) => `<option value="${p.id}" ${p.id === scelta ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');

const prezzoDaCampo = (v) => Number(v).toFixed(2).replace('.', ',');

/** Inserimento di prodotti nuovi (inventario, ritrovamento, regalo). dopo(codice) si chiama a salvataggio avvenuto. */
export function foglioNuovoProdotto({ codice = '', nome = '' } = {}, dopo = () => {}) {
  const db = getDb();
  const { chiudi, radice } = apriFoglio(`<h2>Nuovo prodotto in magazzino</h2>
    ${campo('Codice', `<input id="f-cod" autocomplete="off" autocapitalize="characters" value="${esc(codice)}" ${codice ? '' : 'autofocus'}>`)}
    ${campo('Nome', `<input id="f-nome" autocomplete="off" value="${esc(nome)}">`)}
    ${campo('Quantità', `<input id="f-q" type="number" min="1" max="500" value="1" inputmode="numeric" ${codice ? 'autofocus' : ''}>`)}
    ${campo('Posizione', `<select id="f-pos">${opzioniPosizioni(db, idDaCollocare(db))}</select>`)}
    ${campo('Entrato come', `<select id="f-motivo">${MOTIVI_ENTRATA.map((m) => `<option>${m}</option>`).join('')}</select>`)}
    ${campo('Data di acquisto (se la conosci)', '<input id="f-data" type="date">')}
    ${campo('Prezzo di acquisto (€)', '<input id="f-prezzo" inputmode="decimal" autocomplete="off" placeholder="es. 5,20">')}
    ${campo('Catalogo', '<input id="f-cat" autocomplete="off" autocapitalize="characters" placeholder="es. 14">')}
    ${campo('Note', '<textarea id="f-note"></textarea>')}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Aggiungi</button></div>`);
  comboProdotto(radice, { prezzo: false });
  const v = (s) => radice.querySelector(s).value;
  radice.querySelector('#ok').onclick = () => {
    try {
      const q = Number(v('#f-q'));
      creaProdotti(db, {
        codice: v('#f-cod'), nome: v('#f-nome'), quantita: q, posizioneId: Number(v('#f-pos')), motivoIn: v('#f-motivo'),
        dataAcquisto: v('#f-data'), prezzoAcquisto: v('#f-prezzo'), catalogo: v('#f-cat'), note: v('#f-note'),
      });
      modificato(); chiudi();
      toast(q === 1 ? 'Prodotto aggiunto' : `${q} prodotti aggiunti`);
      dopo(v('#f-cod'));
    } catch (e) { mostraErrore(radice, e); }
  };
}

/** Modifica di un singolo prodotto (p = riga di dettaglioCodice). */
export function foglioProdotto(p, dopo) {
  const db = getDb();
  const { chiudi, radice } = apriFoglio(`<h2>${esc(p.nome)}</h2>
    <p class="muted piccolo" style="margin:-8px 0 14px">Codice ${esc(p.codice)}</p>
    ${campo('Posizione', `<select id="f-pos">${opzioniPosizioni(db, p.posizione_id)}</select>`)}
    ${campo('Data di acquisto', `<input id="f-data" type="date" value="${esc(p.data_acquisto ?? '')}">`)}
    ${campo('Prezzo di acquisto (€)', `<input id="f-prezzo" inputmode="decimal" autocomplete="off" value="${esc(p.prezzo_acquisto === null ? '' : prezzoDaCampo(p.prezzo_acquisto))}">`)}
    ${campo('Catalogo', `<input id="f-cat" autocomplete="off" autocapitalize="characters" value="${esc(p.catalogo_acquisto)}">`)}
    ${campo('Entrato come', `<select id="f-motivo"><option value="">—</option>${MOTIVI_ENTRATA.map((m) => `<option ${m === p.motivo_in ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
    ${campo('Note', `<textarea id="f-note">${esc(p.note)}</textarea>`)}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="salva">Salva</button></div>
    <div class="barra"><button class="btn sec" id="uscita">Segna uscita…</button><button class="btn peric" id="elimina">Elimina</button></div>`);
  const v = (s) => radice.querySelector(s).value;
  radice.querySelector('#salva').onclick = () => {
    try {
      modificaProdotto(db, p.id, {
        posizioneId: Number(v('#f-pos')), dataAcquisto: v('#f-data'), prezzoAcquisto: v('#f-prezzo'),
        catalogo: v('#f-cat'), motivoIn: v('#f-motivo') || null, note: v('#f-note'),
      });
      modificato(); chiudi(); dopo(); toast('Prodotto salvato');
    } catch (e) { mostraErrore(radice, e); }
  };
  radice.querySelector('#uscita').onclick = () => {
    if (p.impegnato_in_ordine) return mostraErrore(radice, new ErroreDominio(`Il prodotto è assegnato all’ordine #${p.impegnato_in_ordine}: scollegalo prima.`));
    chiudi(); foglioUscita([p.id], dopo);
  };
  radice.querySelector('#elimina').onclick = async () => {
    try {
      if (p.impegnato_in_ordine) eliminaProdotto(db, p.id); // lancia l'errore previsto
      chiudi();
      if (!(await conferma({ titolo: 'Eliminare il prodotto?', testo: 'Sparisce del tutto dal magazzino. Per un prodotto usato o perso scegli invece “Segna uscita”.', etichetta: 'Elimina', pericolo: true }))) return;
      eliminaProdotto(db, p.id); modificato(); dopo(); toast('Prodotto eliminato');
    } catch (e) { mostraErrore(radice, e); }
  };
}

/** Scelta della posizione di destinazione per uno o più prodotti. */
export function foglioSposta(ids, dopo) {
  const db = getDb();
  const pos = elencoPosizioni(db);
  const { chiudi, radice } = apriFoglio(`<h2>Sposta ${num(ids.length, 'prodotto', 'prodotti')} in…</h2>
    ${pos.map((p) => `<button class="opz" data-p="${p.id}"><div class="r1"><span class="sx">${icona('pin', 18)} ${esc(p.nome)}</span></div>
      <div class="r2">${num(p.n_prodotti, 'prodotto', 'prodotti')} adesso</div></button>`).join('')}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button></div>`);
  radice.querySelectorAll('[data-p]').forEach((b) => {
    b.onclick = () => {
      try {
        spostaProdotti(db, ids, Number(b.dataset.p));
        modificato(); chiudi(); dopo();
        toast(`${num(ids.length, 'prodotto spostato', 'prodotti spostati')} in ${pos.find((x) => x.id === Number(b.dataset.p)).nome}`);
      } catch (e) { mostraErrore(radice, e); }
    };
  });
}

/** Uscita dal magazzino senza ordine: usato, perso, regalato, buttato. */
export function foglioUscita(ids, dopo) {
  const db = getDb();
  let motivo = MOTIVI_USCITA[0];
  const { chiudi, radice } = apriFoglio(`<h2>Uscita di ${num(ids.length, 'prodotto', 'prodotti')}</h2>
    <p class="muted piccolo" style="margin-bottom:12px">Il prodotto esce dal magazzino senza essere consegnato a un cliente. Le consegne si registrano dall’ordine.</p>
    <div class="segmenti" role="group">${MOTIVI_USCITA.map((m, i) => `<button data-m="${m}" aria-pressed="${i === 0}">${m}</button>`).join('')}</div>
    ${campo('Data', `<input id="f-data" type="date" value="${oggiIso()}">`)}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Conferma uscita</button></div>`);
  radice.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = () => { motivo = b.dataset.m; radice.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
  });
  radice.querySelector('#ok').onclick = () => {
    try {
      segnaUscita(db, ids, motivo, radice.querySelector('#f-data').value);
      modificato(); chiudi(); dopo();
      toast(`${num(ids.length, 'prodotto uscito', 'prodotti usciti')} (${motivo.toLowerCase()})`);
    } catch (e) { mostraErrore(radice, e); }
  };
}

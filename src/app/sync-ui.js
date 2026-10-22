// Interfaccia del collegamento con il server di casa: avviso offline, schermata del codice,
// schermata di scelta quando i dati sono diversi, e la scheda in Impostazioni.
import { getSync } from '../store.js';
import { icona, esc, num, campo } from '../ui/kit.js';
import { toast, conferma, apriFoglio } from './ui.js';

const $ = (id) => document.getElementById(id);
const dataOra = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : null;
};

/** L'utente sta scrivendo o ha un foglio aperto: non si cambiano i dati sotto i suoi occhi. */
const occupato = () => !!document.querySelector('#strato .velo')
  || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');

export function avviaSyncUi({ rinfresca }) {
  const sync = getSync();
  if (!sync) return;
  sync.collega({ occupato });

  let agg = sync.stato.aggiornamenti;
  let firma = '';
  const disegna = (st) => {
    disegnaBarra(sync, st);
    const nuova = `${st.modo}|${st.errore ?? ''}|${st.scelta?.server.revisione ?? ''}`;
    if (nuova !== firma) { firma = nuova; disegnaBlocco(sync, st); }
    if (st.aggiornamenti !== agg) {
      agg = st.aggiornamenti;
      rinfresca();
      if (st.unione && !st.unione.vista) {
        if (st.unione.voci.length) mostraUnione(sync, st.unione);
        else { sync.unioneLetta(); toast('Modifiche unite con quelle di un altro dispositivo'); }
      } else toast('Dati aggiornati');
    }
  };
  sync.iscrivi(disegna);
  disegna(sync.stato);
  // l'unione è avvenuta e l'app è stata chiusa prima di leggerne il report
  if (sync.stato.unione && !sync.stato.unione.vista && sync.stato.unione.voci.length) mostraUnione(sync, sync.stato.unione);

  document.addEventListener('visibilitychange', () => { if (document.hidden) sync.pushOra(); else sync.controlla(); });
  window.addEventListener('pagehide', () => { sync.pushOra(); });
  window.addEventListener('online', () => sync.controlla());
  setInterval(() => { if (!document.hidden) sync.controlla(); }, 25000);
}

// ---------------------------------------------------------------- avviso in alto

function disegnaBarra(sync, st) {
  const el = $('sync-barra');
  if (st.modo !== 'offline') { el.innerHTML = ''; return; }
  const generico = /^(Non riesco a raggiungere|Il server non risponde)/.test(st.errore ?? '');
  const testo = sync.solaLettura
    ? 'Sei offline: puoi solo consultare i dati.'
    : `Sei offline: puoi continuare a lavorare${st.sporco ? '. Le modifiche sono in attesa e partiranno al ritorno della connessione.' : '; le modifiche partiranno al ritorno della connessione.'}`;
  el.innerHTML = `<div class="sync-barra">${icona('warn', 18)}
    <span>${testo}
    ${st.errore && !generico ? `<small>${esc(st.errore)}</small>` : ''}</span>
    <button type="button">Riprova</button></div>`;
  el.querySelector('button').onclick = () => sync.controlla();
}

// ---------------------------------------------------------------- report dell'unione

/** Foglio con ciò che è successo quando le modifiche di qui e quelle di un altro dispositivo sono state unite. */
export function mostraUnione(sync, unione) {
  const voci = unione.voci ?? [];
  const attenzione = voci.filter((v) => v.tipo === 'attenzione');
  const info = voci.filter((v) => v.tipo !== 'attenzione');
  const lista = (v) => `<ul class="elenco-unione">${v.map((x) => `<li class="${x.tipo}">${esc(x.testo)}</li>`).join('')}</ul>`;
  const { chiudi, radice } = apriFoglio(`<h2>Modifiche unite</h2>
    <p class="muted">Su questo dispositivo c’erano ${num(unione.mie, 'modifica', 'modifiche')} non ancora salvate e un altro dispositivo ne aveva ${num(unione.loro, 'salvata', 'salvate')} nel frattempo.
    ${voci.length ? 'Le ho unite; ecco cosa controllare:' : 'Le ho unite senza nessun problema.'}</p>
    ${attenzione.length ? `<h3 class="sotto">Da controllare</h3>${lista(attenzione)}` : ''}
    ${info.length ? `<h3 class="sotto">Per informazione</h3>${lista(info)}` : ''}
    <div class="barra"><button class="btn" data-chiudi>Ho capito</button></div>`);
  radice.querySelector('[data-chiudi]').addEventListener('click', chiudi);
  sync.unioneLetta();
}

// ---------------------------------------------------------------- schermate che bloccano l'uso

function disegnaBlocco(sync, st) {
  const el = $('blocco');
  if (st.modo === 'accesso') return schermataCodice(el, sync, st);
  if (st.modo === 'scelta') return schermataScelta(el, sync, st);
  el.hidden = true;
  el.innerHTML = '';
  return undefined;
}

function schermataCodice(el, sync, st) {
  el.hidden = false;
  el.innerHTML = `<div class="blocco-contenuto">
    <div class="grande">${icona('lock', 32)}</div>
    <h1>Collega questo dispositivo</h1>
    <p class="muted">Inserisci il codice di accesso del server di casa. Va scritto una volta sola su ogni dispositivo.</p>
    <form id="f-codice" autocomplete="off">
      ${campo('Codice di accesso', '<input id="codice" type="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required>')}
      ${st.errore ? `<p class="errore-campo" role="alert">${esc(st.errore)}</p>` : ''}
      <button class="btn largo" type="submit">Entra</button>
    </form>
    <p class="nota" style="margin-top:14px">Non ce l’hai? Sul Raspberry si crea con il comando <b>nuovo-codice</b> (vedi server/LEGGIMI.md).</p>
  </div>`;
  const f = el.querySelector('#f-codice');
  const campoCodice = el.querySelector('#codice');
  campoCodice.focus();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const b = f.querySelector('button');
    b.disabled = true;
    b.textContent = 'Controllo…';
    await sync.inviaCodice(campoCodice.value);
    // se è andata bene la schermata si chiude da sola; se no resta, con l'errore
    if (b.isConnected) { b.disabled = false; b.textContent = 'Entra'; campoCodice.focus(); }
  };
}

function riassunto(d, etichettaData, data) {
  return `<div class="riga-info"><span>Ordini</span><b>${d.ordini}</b></div>
    <div class="riga-info"><span>Prodotti in magazzino</span><b>${d.prodotti}</b></div>
    <div class="riga-info"><span>Contatti</span><b>${d.contatti}</b></div>
    <div class="riga-info"><span>${etichettaData}</span><b>${dataOra(data) ?? 'non nota'}</b></div>`;
}

const TESTI_SCELTA = {
  'primo-collegamento': ['Questo dispositivo e il server hanno dati diversi',
    'Su questo dispositivo ci sono già dei dati e sul server ce ne sono altri. Scegli quali tenere: gli altri restano recuperabili.'],
  modificati: ['I dati sono stati modificati in due posti',
    'Mentre qui c’erano modifiche non ancora salvate, un altro dispositivo ha salvato dati nuovi sul server. Scegli quali tenere: gli altri restano recuperabili.'],
  'server-indietro': ['Il server ha dati più vecchi',
    'I dati sul server sono più vecchi di quelli di questo dispositivo. Scegli quali tenere: gli altri restano recuperabili.'],
};

function schermataScelta(el, sync, st) {
  const { motivo, server, locale } = st.scelta;
  const [titolo, testo] = TESTI_SCELTA[motivo] ?? TESTI_SCELTA['primo-collegamento'];
  el.hidden = false;
  el.innerHTML = `<div class="blocco-contenuto">
    <div class="grande">${icona('swap', 32)}</div>
    <h1>${esc(titolo)}</h1>
    <p class="muted">${esc(testo)}</p>
    <div class="card"><h2 class="titolo-card">Sul server</h2>${riassunto(server, 'Ultimo salvataggio', server.aggiornato)}
      <button class="btn largo" id="s-server" style="margin-top:12px">Tieni i dati del server</button>
      <p class="nota">I dati di questo dispositivo restano recuperabili da Impostazioni → “Torna ai dati di prima”.</p></div>
    <div class="card"><h2 class="titolo-card">Su questo dispositivo</h2>${riassunto(locale, 'Ultima modifica', locale.ultimaModifica)}
      <button class="btn sec largo" id="s-locale" style="margin-top:12px">Tieni i dati di questo dispositivo</button>
      <p class="nota">I dati attuali del server restano nello storico sul Raspberry.</p></div>
  </div>`;
  const vai = (quale) => async () => {
    el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    await sync.scegli(quale);
  };
  el.querySelector('#s-server').onclick = vai('server');
  el.querySelector('#s-locale').onclick = async () => {
    const ok = await conferma({
      titolo: 'Sostituire i dati del server?',
      testo: `Sul server ci sono ${num(server.ordini, 'ordine', 'ordini')} e ${num(server.prodotti, 'prodotto', 'prodotti')}: verranno sostituiti con quelli di questo dispositivo (${num(locale.ordini, 'ordine', 'ordini')}, ${num(locale.prodotti, 'prodotto', 'prodotti')}). Restano nello storico del server.`,
      etichetta: 'Sostituisci',
    });
    if (ok) await vai('locale')();
  };
}

// ---------------------------------------------------------------- scheda in Impostazioni

/** HTML della scheda "Server di casa" ('' se l'app non è collegata a nessun server). */
export function schedaServer() {
  const sync = getSync();
  if (!sync?.attivo) return '';
  const st = sync.stato;
  const stato = st.modo === 'ok' ? (st.sporco ? 'Collegato, salvo le ultime modifiche…' : 'Collegato')
    : (sync.solaLettura ? 'Offline (solo consultazione)' : `Offline${st.sporco ? ' (modifiche in attesa)' : ''}`);
  return `<div class="card" id="card-server">
    <h2 class="titolo-card">Server di casa</h2>
    <div class="riga-info"><span>Stato</span><b>${stato}</b></div>
    <div class="riga-info"><span>Ultimo allineamento</span><b>${dataOra(st.quando) ?? 'mai'}</b></div>
    ${st.unione ? `<div class="riga-info"><span>Ultima unione di modifiche</span><b>${dataOra(st.unione.quando) ?? ''}</b></div>` : ''}
    <p class="muted piccolo" style="margin:10px 0 12px">I dati veri stanno sul Raspberry e vengono salvati lì a ogni modifica. Su questo dispositivo c’è una copia: senza connessione puoi continuare a lavorare e le modifiche si uniscono a quelle degli altri dispositivi quando torna la rete.</p>
    <button class="btn sec largo" id="srv-controlla">Controlla ora</button>
    ${st.unione ? '<button class="btn sec largo" id="srv-unione">Rivedi l’ultima unione</button>' : ''}
    <button class="btn sec largo" id="srv-codice">Cambia codice di accesso</button>
  </div>`;
}

export function attivaSchedaServer(vista, ridisegna) {
  const sync = getSync();
  vista.querySelector('#srv-controlla')?.addEventListener('click', async () => {
    await sync.controlla();
    toast(sync.stato.modo === 'ok' ? 'Tutto allineato' : 'Il server non risponde');
    ridisegna();
  });
  vista.querySelector('#srv-unione')?.addEventListener('click', () => mostraUnione(sync, sync.stato.unione));
  vista.querySelector('#srv-codice')?.addEventListener('click', async () => {
    const ok = await conferma({
      titolo: 'Cambiare il codice di accesso?',
      testo: 'Ti verrà chiesto di scrivere il nuovo codice. I dati su questo dispositivo non vengono toccati.',
      etichetta: 'Continua',
    });
    if (ok) sync.cambiaCodice();
  });
}

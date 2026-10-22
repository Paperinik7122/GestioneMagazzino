// Impostazioni: stato dei dati, backup, ripristino e import del vecchio database.
import {
  getDb, meta, stato, preparaBackup, backupFatto, riconosciFile, preparaImportVecchio, preparaRipristino,
  sostituisciDb, esistonoDatiPrecedenti, tornaAiDatiPrecedenti, getSync,
} from '../../store.js';
import { schedaServer, attivaSchedaServer } from '../sync-ui.js';
import { descriviDb, dbVuoto, righeReport, leggiReport } from '../../db/backup.js';
import { icona, esc, num, intestazione } from '../../ui/kit.js';
import { apriFoglio, toast, conferma } from '../ui.js';
import { ErroreDominio } from '../../domain/errori.js';

const dataOra = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
};

// Database preparato ma non ancora confermato: se l'utente chiude il foglio senza scegliere, si libera al passaggio dopo.
let pendente = null;
function scarta() {
  try { pendente?.close(); } catch { /* ignora */ }
  pendente = null;
}

export async function impostazioni(vista) {
  scarta();
  const db = getDb();
  const adesso = descriviDb(db);
  const ultimo = adesso.ultimoBackup ? dataOra(adesso.ultimoBackup) : null;
  const haPrecedenti = await esistonoDatiPrecedenti();
  if (!location.hash.startsWith('#/impostazioni')) return; // nel frattempo si è cambiata schermata
  const reportSalvato = leggiReport(meta('report_migrazione'));
  const puoCondividere = typeof navigator.canShare === 'function' && typeof File === 'function'
    && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.db', { type: 'application/octet-stream' })] });

  vista.innerHTML = `${intestazione('Impostazioni', { indietro: '#/' })}
    <div class="card">
      <h2 class="titolo-card">I tuoi dati</h2>
      <div class="riga-info"><span>Ordini</span><b>${adesso.ordini}</b></div>
      <div class="riga-info"><span>Prodotti in magazzino</span><b>${adesso.prodotti}</b></div>
      <div class="riga-info"><span>Contatti</span><b>${adesso.contatti}</b></div>
      <div class="riga-info"><span>Ultimo backup</span><b>${ultimo ?? 'mai'}</b></div>
      ${stato.volatile ? `<div class="avviso rosso">${icona('warn', 20)}<span>I dati non si salvano su questo dispositivo: fai subito un backup.</span></div>` : ''}
      <p class="muted piccolo" style="margin-top:10px">${getSync()?.attivo
    ? 'I dati sono sul server di casa; qui c’è una copia per consultarli anche offline. Un backup ogni tanto, conservato altrove, resta una buona idea.'
    : `I dati stanno solo su questo dispositivo${stato.persistente ? ' (protetti dalla pulizia automatica)' : ''}. Se cambi telefono o cancelli i dati del sito, si perdono: il backup serve a questo.`}</p>
    </div>
    ${schedaServer()}

    <div class="card">
      <h2 class="titolo-card">Backup</h2>
      <p class="muted piccolo" style="margin-bottom:12px">Salva una copia di tutto in un file. Conservala in un posto sicuro (File, iCloud, Drive, il computer).</p>
      <button class="btn largo" id="backup">${icona('download', 20)} Salva backup</button>
      ${puoCondividere ? `<button class="btn sec largo" id="scarica">Scarica come file</button>` : ''}
    </div>

    <div class="card">
      <h2 class="titolo-card">Ripristina o importa</h2>
      <p class="muted piccolo" style="margin-bottom:12px">Scegli un backup di questa app oppure il database della vecchia app (<b>magazzino.db</b>). Prima di sostituire i dati ti faccio vedere cosa c’è nel file.</p>
      <button class="btn sec largo" id="scegli">${icona('upload', 20)} Scegli un file…</button>
      <input type="file" id="file" hidden>
      ${haPrecedenti ? `<button class="btn sec largo" id="precedenti">Torna ai dati di prima dell’ultima sostituzione</button>` : ''}
      ${reportSalvato ? `<button class="btn sec largo" id="report">Rivedi il report dell’ultimo import</button>` : ''}
    </div>`;

  attivaSchedaServer(vista, () => impostazioni(vista));
  vista.querySelector('#backup').onclick = () => salvaBackup(vista, !!puoCondividere);
  vista.querySelector('#scarica')?.addEventListener('click', () => salvaBackup(vista, false));
  const input = vista.querySelector('#file');
  vista.querySelector('#scegli').onclick = () => input.click();
  input.onchange = async () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) await apriFile(f);
  };
  vista.querySelector('#precedenti')?.addEventListener('click', async () => {
    const ok = await conferma({
      titolo: 'Tornare ai dati di prima?',
      testo: 'I dati attuali prendono il posto di quelli di prima (e potrai scambiarli di nuovo).',
      etichetta: 'Torna indietro',
    });
    if (!ok) return;
    try {
      await tornaAiDatiPrecedenti();
      toast('Dati di prima ripristinati');
      impostazioni(vista);
    } catch (e) { foglioErrore(e); }
  });
  vista.querySelector('#report')?.addEventListener('click', () => foglioReport(reportSalvato.report, { quando: reportSalvato.quando }));
}

// ---------------------------------------------------------------- backup

function scarica(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function salvaBackup(vista, condividi) {
  const { nome, bytes, annulla } = preparaBackup();
  const file = new File([bytes], nome, { type: 'application/octet-stream' });
  try {
    if (condividi) {
      await navigator.share({ files: [file], title: nome });
    } else {
      scarica(file);
    }
  } catch (e) {
    annulla();
    if (e?.name === 'AbortError') return; // l'utente ha chiuso il foglio di condivisione
    console.error(e);
    toast('Non sono riuscito a salvare il file. Riprova con “Scarica come file”.', { ms: 6000 });
    return;
  }
  await backupFatto();
  toast('Backup salvato');
  impostazioni(vista);
}

// ---------------------------------------------------------------- ripristino / import

function foglioErrore(e, titolo = 'Non posso usare questo file') {
  if (!(e instanceof ErroreDominio)) console.error(e);
  const testo = e instanceof ErroreDominio ? e.message : 'Qualcosa non ha funzionato. Riprova.';
  const { radice } = apriFoglio(`<h2>${esc(titolo)}</h2><p class="muted">${esc(testo)}</p>
    <div class="barra"><button class="btn" data-chiudi>Ho capito</button></div>`);
  void radice;
}

async function apriFile(file) {
  scarta();
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch (e) { foglioErrore(e, 'Non riesco a leggere il file'); return; }
  const tipo = riconosciFile(bytes);
  try {
    if (tipo === 'nuovo') proponiRipristino(bytes, file.name);
    else if (tipo === 'b4a') await proponiImport(bytes);
    else foglioErrore(new ErroreDominio('Non è un database di Gestione Magazzino né quello della vecchia app. Controlla di aver scelto il file giusto (di solito magazzino.db o un backup salvato da qui).'));
  } catch (e) { scarta(); foglioErrore(e); }
}

function avvisoSostituzione() {
  const mio = descriviDb(getDb());
  if (dbVuoto(getDb())) return '';
  return `<div class="avviso">${icona('warn', 20)}<span>I dati attuali (${num(mio.ordini, 'ordine', 'ordini')}, ${num(mio.prodotti, 'prodotto', 'prodotti')}) verranno sostituiti. Resteranno recuperabili con “Torna ai dati di prima”, ma conviene fare prima un backup.</span></div>`;
}

function proponiRipristino(bytes, nomeFile) {
  const d = preparaRipristino(bytes);
  pendente = d;
  const info = descriviDb(d);
  const quando = info.ultimoBackup ? dataOra(info.ultimoBackup) : null;
  const { chiudi, radice } = apriFoglio(`<h2>Ripristinare questo backup?</h2>
    <p class="muted piccolo" style="margin:-6px 0 12px">${esc(nomeFile)}</p>
    <div class="card">
      <div class="riga-info"><span>Ordini</span><b>${info.ordini}</b></div>
      <div class="riga-info"><span>Prodotti in magazzino</span><b>${info.prodotti}</b></div>
      <div class="riga-info"><span>Contatti</span><b>${info.contatti}</b></div>
      <div class="riga-info"><span>Backup del</span><b>${quando ?? 'data non indicata'}</b></div>
    </div>
    ${avvisoSostituzione()}
    <div class="barra"><button class="btn sec" id="annulla">Annulla</button><button class="btn" id="ok">Ripristina</button></div>`);
  radice.querySelector('#annulla').onclick = () => { chiudi(); scarta(); };
  radice.querySelector('#ok').onclick = async () => {
    chiudi();
    pendente = null;
    try {
      await sostituisciDb(d);
    } catch (e) { try { d.close(); } catch { /* ignora */ } foglioErrore(e, 'Non posso ripristinare ora'); return; }
    toast('Backup ripristinato');
    location.hash = '#/';
  };
}

function proponiImport(bytes) {
  const { nuovo, report } = preparaImportVecchio(bytes);
  pendente = nuovo;
  foglioReport(report, {
    conferma: async () => {
      pendente = null;
      try {
        await sostituisciDb(nuovo);
      } catch (e) { try { nuovo.close(); } catch { /* ignora */ } foglioErrore(e, 'Non posso importare ora'); return; }
      toast('Import completato. Controlla i dati e fai un backup.', { ms: 6000 });
      location.hash = '#/';
    },
    annulla: scarta,
  });
}

/** Mostra il report dell'import. Con conferma() è la schermata prima di sostituire; senza è solo da rileggere. */
function foglioReport(report, { conferma: sostituisci = null, annulla = null, quando = null } = {}) {
  const r = righeReport(report);
  const q = quando ? dataOra(quando) : null;
  const anom = r.anomalie.length
    ? r.anomalie.map((a) => `<details class="anom"><summary><b>${a.n}</b> ${esc(a.testo)}</summary>
        ${a.esempi.length ? `<ul>${a.esempi.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${a.n > a.esempi.length ? `<p class="muted piccolo">…e altri ${a.n - a.esempi.length}.</p>` : ''}` : ''}
      </details>`).join('')
    : `<div class="avviso ok">${icona('ok', 20)}<span>Nessuna anomalia: tutto è stato letto senza problemi.</span></div>`;
  const proposte = r.proposte.length
    ? `<h3 class="gruppo-tit">Nomi simili da controllare in Contatti</h3>
       <p class="muted piccolo" style="margin-bottom:8px">Non li ho uniti io: se sono la stessa persona usa “Unisci”.</p>
       ${r.proposte.slice(0, 12).map((g) => `<div class="prop"><div class="nome">${g.map(esc).join(' · ')}</div></div>`).join('')}
       ${r.proposte.length > 12 ? `<p class="muted piccolo">…e altri ${r.proposte.length - 12} gruppi.</p>` : ''}`
    : '';
  const { chiudi, radice } = apriFoglio(`<h2>${sostituisci ? 'Import dalla vecchia app' : 'Report dell’ultimo import'}</h2>
    <p class="muted piccolo" style="margin:-6px 0 12px">${sostituisci ? 'Ecco cosa ho letto dal file. Il file originale non viene modificato.' : `Import del ${esc(q ?? 'data non nota')}.`}</p>
    <div class="card">${r.conteggi.map((c) => `<div class="riga-info"><span>${esc(c.testo)}</span><b>${c.n}</b></div>`).join('')}</div>
    ${r.extra.map((t) => `<p class="piccolo nota-rep">${esc(t)}</p>`).join('')}
    <h3 class="gruppo-tit">Da controllare</h3>
    ${anom}
    ${proposte}
    ${sostituisci ? avvisoSostituzione() : ''}
    <div class="barra">${sostituisci
      ? '<button class="btn sec" id="annulla">Annulla</button><button class="btn" id="ok">Importa e sostituisci</button>'
      : '<button class="btn" data-chiudi>Chiudi</button>'}</div>`);
  if (!sostituisci) return;
  radice.querySelector('#annulla').onclick = () => { chiudi(); annulla?.(); };
  radice.querySelector('#ok').onclick = async () => { chiudi(); await sostituisci(); };
}

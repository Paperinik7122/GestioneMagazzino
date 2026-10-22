// Collegamento con il server di casa (tappa 1): i dati veri stanno sul Raspberry.
//
// - Ogni modifica viene inviata al server poco dopo (il database intero, con controllo della revisione:
//   se nel frattempo un altro dispositivo ha salvato, il server rifiuta e si sceglie quale versione tenere).
// - Senza connessione i dati si aprono dall'ultima copia, in SOLA LETTURA (la tappa 2 permetterà di modificare anche offline).
// - Il codice è un controller senza dipendenze dal browser: tutto ciò che serve gli viene passato (vedi creaSync).
import { decidiConnessione } from './decisione.js';
import { normalizzaCodice } from './remoto.js';

const RITARDO_INVIO = 1200;

/**
 * dep.remoto       ping / stato / scarica / carica (vedi remoto.js)
 * dep.config       { leggi(), scrivi(cfg) }
 * dep.getDb        il database di adesso
 * dep.esporta      () => Uint8Array del database di adesso
 * dep.apriBytes    (bytes) => Database controllato (lancia se il file non è valido)
 * dep.descrivi     (db) => { ordini, prodotti, contatti }
 * dep.vuoto        (db) => true se senza ordini, prodotti e contatti
 * dep.sostituisci  (db, { conserva }) => Promise: mette db al posto dei dati attuali (senza inviarli al server)
 * dep.blocca / dep.sblocca   (db) rendono il database di sola lettura / lo riaprono
 * dep.adesso       () => ms (per le prove)
 *
 * Modi (stato.modo):
 *   nessuno   nessun server: l'app funziona come prima, solo su questo dispositivo
 *   accesso   il server c'è ma serve il codice
 *   scelta    dati diversi da entrambe le parti: serve la scelta dell'utente (stato.scelta)
 *   ok        collegato e allineato (si può modificare)
 *   offline   server non raggiungibile o salvataggio non riuscito: sola lettura
 */
export function creaSync(dep) {
  const { remoto, config, getDb, esporta, apriBytes, descrivi, vuoto, sostituisci, blocca, sblocca } = dep;
  const adesso = dep.adesso ?? Date.now;
  let cfg = config.leggi();
  const stato = { modo: 'nessuno', errore: null, rev: cfg.rev, sporco: cfg.sporco, quando: cfg.quando, scelta: null, aggiornamenti: 0 };
  const ascoltatori = new Set();
  let ui = { occupato: () => false };

  let versione = 0; // cresce a ogni modifica: dice se durante un invio ne sono arrivate altre
  let timer = null;
  let inVolo = null;
  let rifare = false;
  let inConnessione = null;

  const emetti = () => ascoltatori.forEach((f) => { try { f(stato); } catch (e) { console.error(e); } });
  const iso = () => new Date(adesso()).toISOString();
  function salva(patch) {
    cfg = { ...cfg, ...patch };
    config.scrivi(cfg);
    stato.rev = cfg.rev;
    stato.sporco = cfg.sporco;
    stato.quando = cfg.quando;
  }
  const bloccato = () => ['offline', 'accesso', 'scelta'].includes(stato.modo);
  function imposta(modo, errore = null) {
    stato.modo = modo;
    stato.errore = errore;
    const d = getDb();
    if (d) (bloccato() ? blocca(d) : sblocca(d));
    emetti();
  }
  function daErrore(e) {
    if (e?.tipo === 'accesso') {
      salva({ codice: '' });
      imposta('accesso', e.message);
    } else if (e?.tipo === 'bloccato') {
      imposta('accesso', e.message);
    } else if (e?.tipo === 'rifiutato') {
      imposta('offline', `Il server ha rifiutato il salvataggio: ${e.message}`);
    } else if (e?.tipo === 'rete' || e?.tipo === 'server') {
      imposta('offline', e.message);
    } else {
      console.error(e);
      imposta('offline', 'Qualcosa non ha funzionato nel collegamento con il server.');
    }
  }

  // ------------------------------------------------------------ avvio e collegamento

  async function avvia() {
    const p = await remoto.ping();
    if (p !== 'ok') {
      if (!cfg.serverNoto) return imposta('nessuno');
      return imposta('offline', 'Non riesco a raggiungere il server.');
    }
    salva({ serverNoto: true });
    if (!cfg.codice) return imposta('accesso');
    return connetti();
  }

  /** Controlla il server e decide cosa fare (vedi decisione.js). */
  function connetti() {
    inConnessione ??= (async () => {
      let s;
      try { s = await remoto.stato(cfg.codice); } catch (e) { return daErrore(e); }
      const dec = decidiConnessione({ cfg, server: s, localeVuoto: vuoto(getDb()) });
      try {
        if (dec.azione === 'niente') {
          salva({ archivio: s.archivio, rev: s.revisione });
          imposta('ok');
        } else if (dec.azione === 'inizia-vuoto') {
          salva({ archivio: s.archivio, rev: s.revisione, sporco: false, quando: iso() });
          imposta('ok');
        } else if (dec.azione === 'scarica') {
          await scaricaESostituisci({ conserva: false });
          imposta('ok');
          stato.aggiornamenti += 1;
          emetti();
        } else if (dec.azione === 'carica') {
          salva({ archivio: s.archivio, rev: s.revisione, sporco: true });
          imposta('ok');
          await pushOra();
        } else {
          await preparaScelta(dec.motivo);
        }
      } catch (e) { daErrore(e); }
    })().finally(() => { inConnessione = null; });
    return inConnessione;
  }

  async function scaricaESostituisci({ conserva }) {
    const r = await remoto.scarica(cfg.codice);
    const nuovo = apriBytes(r.bytes);
    await sostituisci(nuovo, { conserva });
    salva({ archivio: r.archivio, rev: r.revisione, sporco: false, quando: iso() });
  }

  async function preparaScelta(motivo) {
    const r = await remoto.scarica(cfg.codice);
    const dbServer = apriBytes(r.bytes);
    let aggiornato = null;
    try { aggiornato = (await remoto.stato(cfg.codice)).aggiornato; } catch { /* la data è solo un'informazione in più */ }
    stato.scelta = {
      motivo,
      server: { ...descrivi(dbServer), revisione: r.revisione, archivio: r.archivio, aggiornato },
      locale: descrivi(getDb()),
      dbServer,
    };
    imposta('scelta');
  }

  /** L'utente ha scelto: 'server' (si tengono i dati del server) o 'locale' (si sostituiscono i dati del server). */
  async function scegli(quale) {
    const sc = stato.scelta;
    if (!sc) return;
    try {
      if (quale === 'server') {
        await sostituisci(sc.dbServer, { conserva: true });
        salva({ archivio: sc.server.archivio, rev: sc.server.revisione, sporco: false, quando: iso() });
      } else {
        const r = await remoto.carica(cfg.codice, esporta(), sc.server.revisione, { forzaStorico: true });
        salva({ archivio: r.archivio, rev: r.revisione, sporco: false, quando: iso() });
        try { sc.dbServer.close(); } catch { /* ignora */ }
      }
      stato.scelta = null;
      imposta('ok');
      stato.aggiornamenti += 1;
      emetti();
    } catch (e) {
      if (e?.tipo === 'conflitto') { stato.scelta = null; return connetti(); } // nel frattempo è cambiato ancora
      return daErrore(e);
    }
  }

  async function inviaCodice(codice) {
    salva({ codice: normalizzaCodice(codice) });
    stato.errore = null;
    return connetti();
  }

  function cambiaCodice() {
    salva({ codice: '' });
    imposta('accesso');
  }

  // ------------------------------------------------------------ salvataggio sul server

  /** Da chiamare a ogni modifica dei dati (lo fa store.modificato). */
  function modificato() {
    if (stato.modo !== 'ok') return;
    versione += 1;
    if (!cfg.sporco) { salva({ sporco: true }); emetti(); }
    clearTimeout(timer);
    timer = setTimeout(() => { pushOra(); }, RITARDO_INVIO);
    timer.unref?.();
  }

  /** Invia subito al server le modifiche in sospeso. */
  function pushOra({ forzaStorico = false } = {}) {
    clearTimeout(timer);
    if (stato.modo !== 'ok') return Promise.resolve();
    if (inVolo) { rifare = true; return inVolo; }
    if (!cfg.sporco) return Promise.resolve();
    inVolo = (async () => {
      let forza = forzaStorico;
      do {
        rifare = false;
        const v = versione;
        let r;
        try {
          r = await remoto.carica(cfg.codice, esporta(), cfg.rev, { forzaStorico: forza });
        } catch (e) {
          if (e?.tipo === 'conflitto') return preparaScelta('modificati').catch(daErrore);
          return daErrore(e);
        }
        forza = false;
        salva({ archivio: r.archivio, rev: r.revisione, sporco: versione !== v, quando: iso() });
        emetti();
      } while (cfg.sporco || rifare);
    })().finally(() => { inVolo = null; });
    return inVolo;
  }

  /** Dopo un import o un ripristino: tutto il database è cambiato, lo si invia subito (e resta nello storico del server). */
  async function sostituzioneFatta() {
    if (stato.modo !== 'ok') return;
    versione += 1;
    salva({ sporco: true });
    emetti();
    await pushOra({ forzaStorico: true });
  }

  // ------------------------------------------------------------ aggiornamento da altri dispositivi

  /**
   * Da chiamare quando si torna sull'app, ogni tanto, e quando torna la rete.
   * Offline: riprova a collegarsi. Online: se un altro dispositivo ha salvato, prende i dati nuovi e
   * aumenta stato.aggiornamenti (l'interfaccia si ridisegna). Non lo fa mentre l'utente sta scrivendo o ha
   * un foglio aperto (collega({ occupato })): aspetta la prossima occasione.
   */
  async function controlla() {
    if (stato.modo === 'offline') return connetti();
    if (stato.modo !== 'ok' || inVolo || inConnessione) return undefined;
    if (cfg.sporco) return pushOra();
    let s;
    try { s = await remoto.stato(cfg.codice); } catch (e) { return daErrore(e); }
    if (s.archivio === cfg.archivio && s.revisione === cfg.rev) return undefined;
    if (ui.occupato()) return undefined;
    return connetti();
  }

  return {
    stato,
    avvia,
    connetti,
    inviaCodice,
    cambiaCodice,
    scegli,
    modificato,
    pushOra,
    sostituzioneFatta,
    controlla,
    get attivo() { return stato.modo !== 'nessuno'; },
    get solaLettura() { return bloccato(); },
    iscrivi(f) { ascoltatori.add(f); return () => ascoltatori.delete(f); },
    collega(opzioni) { ui = { ...ui, ...opzioni }; },
  };
}

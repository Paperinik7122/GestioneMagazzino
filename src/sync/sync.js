// Collegamento con il server di casa (tappa 1): i dati veri stanno sul Raspberry.
//
// - Ogni modifica viene inviata al server poco dopo (il database intero, con controllo della revisione:
//   se nel frattempo un altro dispositivo ha salvato, il server rifiuta e si sceglie quale versione tenere).
// - Senza connessione si lavora lo stesso sulla copia di questo dispositivo (tappa 2). Al ritorno della rete, se nel
//   frattempo un altro dispositivo ha salvato, le modifiche si UNISCONO riga per riga (unione.js) usando la copia
//   dei dati dell'ultimo allineamento come punto di partenza comune ("base").
// - Il codice è un controller senza dipendenze dal browser: tutto ciò che serve gli viene passato (vedi creaSync).
import { decidiConnessione } from './decisione.js';
import { normalizzaCodice } from './remoto.js';
import { unisci } from './unione.js';

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
 * dep.leggiBase    () => Promise<{ bytes, rev, archivio } | null>: i dati dell'ultimo allineamento col server
 * dep.salvaBase     (bytes, rev, archivio) => Promise: li ricorda (se manca, in caso di modifiche in due posti decide l'utente)
 * dep.adesso       () => ms (per le prove)
 *
 * Modi (stato.modo):
 *   nessuno   nessun server: l'app funziona come prima, solo su questo dispositivo
 *   accesso   il server c'è ma serve il codice
 *   scelta    dati diversi da entrambe le parti: serve la scelta dell'utente (stato.scelta)
 *   ok        collegato e allineato (si può modificare)
 *   offline   server non raggiungibile o salvataggio non riuscito: si può modificare (sola lettura solo se questo
 *             dispositivo non è mai stato allineato); le modifiche restano "in attesa" e si uniscono al ritorno della rete
 */
export function creaSync(dep) {
  const { remoto, config, getDb, esporta, apriBytes, descrivi, vuoto, sostituisci, blocca, sblocca } = dep;
  const adesso = dep.adesso ?? Date.now;
  const leggiBase = dep.leggiBase ?? (async () => null);
  const salvaBase = dep.salvaBase ?? (async () => {});
  let cfg = config.leggi();
  const stato = { modo: 'nessuno', errore: null, rev: cfg.rev, sporco: cfg.sporco, quando: cfg.quando, scelta: null, aggiornamenti: 0, unione: cfg.unione ?? null };
  const ascoltatori = new Set();
  let ui = { occupato: () => false };

  let versione = 0; // cresce a ogni modifica: dice se durante un invio ne sono arrivate altre
  let timer = null;
  let inVolo = null;
  let rifare = false;
  let inConnessione = null;
  let ritento = null;

  const emetti = () => ascoltatori.forEach((f) => { try { f(stato); } catch (e) { console.error(e); } });
  const iso = () => new Date(adesso()).toISOString();
  function salva(patch) {
    cfg = { ...cfg, ...patch };
    config.scrivi(cfg);
    stato.rev = cfg.rev;
    stato.sporco = cfg.sporco;
    stato.quando = cfg.quando;
  }
  // Offline si modifica solo se questo dispositivo è già stato allineato col server almeno una volta.
  const bloccato = () => ['accesso', 'scelta'].includes(stato.modo) || (stato.modo === 'offline' && !cfg.archivio);
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
      const haBase = !!(await baseValida());
      const dec = decidiConnessione({ cfg, server: s, localeVuoto: vuoto(getDb()), haBase });
      try {
        if (dec.azione === 'niente') {
          salva({ archivio: s.archivio, rev: s.revisione });
          if (!haBase) await ricordaBase(esporta()); // primo avvio dopo l'aggiornamento dell'app: i dati sono allineati, sono la base
          imposta('ok');
        } else if (dec.azione === 'inizia-vuoto') {
          salva({ archivio: s.archivio, rev: s.revisione, sporco: false, quando: iso() });
          await ricordaBase(esporta());
          imposta('ok');
        } else if (dec.azione === 'unisci') {
          imposta('ok');
          await unisciOra();
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
    await ricordaBase(r.bytes);
  }

  // ------------------------------------------------------------ la base: i dati dell'ultimo allineamento

  /** Ricorda i dati così come sono (o come erano) sul server alla revisione attuale di questo dispositivo. */
  async function ricordaBase(bytes) {
    try { await salvaBase(bytes, cfg.rev, cfg.archivio); } catch (e) { console.warn('Base non salvata', e); }
  }
  /** La base si usa solo se corrisponde esattamente all'ultimo allineamento (altrimenti non si può unire in sicurezza). */
  async function baseValida() {
    let b = null;
    try { b = await leggiBase(); } catch { /* senza base: sceglie l'utente */ }
    return b && b.rev === cfg.rev && b.archivio === cfg.archivio && cfg.archivio ? b : null;
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
      bytes: r.bytes,
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
        await ricordaBase(sc.bytes);
      } else {
        const inviati = esporta();
        const r = await remoto.carica(cfg.codice, inviati, sc.server.revisione, { forzaStorico: true });
        salva({ archivio: r.archivio, rev: r.revisione, sporco: false, quando: iso() });
        await ricordaBase(inviati);
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
    const offlineModificabile = stato.modo === 'offline' && !!cfg.archivio;
    if (stato.modo !== 'ok' && !offlineModificabile) return;
    versione += 1;
    if (!cfg.sporco) { salva({ sporco: true }); emetti(); }
    if (offlineModificabile) return; // le modifiche restano in attesa: partono al ritorno della rete
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
    inVolo = cicloInvio(forzaStorico).finally(() => { inVolo = null; });
    return inVolo;
  }

  /** Invia finché non resta nulla in sospeso; se nel frattempo un altro dispositivo ha salvato, prima unisce. */
  async function cicloInvio(forzaStorico) {
    let forza = forzaStorico;
    let giri = 0;
    do {
      rifare = false;
      giri += 1;
      if (giri > 8) { imposta('offline', 'Il server cambia di continuo: riprovo tra poco.'); return undefined; }
      const v = versione;
      const inviati = esporta();
      let r;
      try {
        r = await remoto.carica(cfg.codice, inviati, cfg.rev, { forzaStorico: forza });
      } catch (e) {
        if (e?.tipo === 'conflitto') {
          const esito = await unisciInterno().catch((err) => { daErrore(err); return 'errore'; });
          if (esito === 'fatto') { rifare = true; continue; }
          return undefined;
        }
        return daErrore(e);
      }
      forza = false;
      salva({ archivio: r.archivio, rev: r.revisione, sporco: versione !== v, quando: iso() });
      await ricordaBase(inviati);
      emetti();
    } while (cfg.sporco || rifare);
    return undefined;
  }

  /** Dopo un import o un ripristino: tutto il database è cambiato, lo si invia subito (e resta nello storico del server). */
  async function sostituzioneFatta() {
    if (stato.modo !== 'ok') return;
    versione += 1;
    salva({ sporco: true });
    emetti();
    await pushOra({ forzaStorico: true });
  }

  // ------------------------------------------------------------ unione delle modifiche

  /** Unisce le modifiche di questo dispositivo con quelle già sul server e poi le invia. */
  function unisciOra() {
    if (inVolo) { rifare = true; return inVolo; }
    inVolo = (async () => {
      const esito = await unisciInterno().catch((e) => { daErrore(e); return 'errore'; });
      if (esito === 'fatto') await cicloInvio(false);
    })().finally(() => { inVolo = null; });
    return inVolo;
  }

  function riprovaTraPoco() {
    clearTimeout(ritento);
    ritento = setTimeout(() => { controlla(); }, 4000);
    ritento.unref?.();
  }

  /**
   * Scarica i dati del server, ci unisce le modifiche di questo dispositivo, mette il risultato al posto dei dati
   * di qui e si segna che adesso si parte dalla revisione del server (da lì in poi basta inviare).
   * Restituisce 'fatto', 'rimandato' (l'utente sta scrivendo) o 'scelta' (non si può unire: decide l'utente).
   */
  async function unisciInterno() {
    if (ui.occupato()) { riprovaTraPoco(); return 'rimandato'; }
    const base = await baseValida();
    if (!base) { await preparaScelta('modificati'); return 'scelta'; }
    const r = await remoto.scarica(cfg.codice);
    if (ui.occupato()) { riprovaTraPoco(); return 'rimandato'; }
    let dbBase = null; let dbLoro = null; let esito;
    try {
      dbBase = apriBytes(base.bytes);
      dbLoro = apriBytes(r.bytes);
      esito = unisci({ base: dbBase, mio: getDb(), loro: dbLoro });
    } catch (e) {
      console.error('Unione non riuscita', e);
      try { dbLoro?.close(); } catch { /* ignora */ }
      await preparaScelta('modificati');
      return 'scelta';
    } finally { try { dbBase?.close(); } catch { /* ignora */ } }
    // da qui in poi niente attese tra la lettura dei dati di qui e la loro sostituzione, a parte la sostituzione stessa
    await sostituisci(esito.db, { conserva: true });
    versione += 1;
    salva({ archivio: r.archivio, rev: r.revisione, sporco: true, unione: riassuntoUnione(esito.report) });
    await ricordaBase(r.bytes);
    stato.unione = cfg.unione;
    stato.aggiornamenti += 1;
    imposta('ok');
    return 'fatto';
  }

  function riassuntoUnione(report) {
    return { quando: iso(), mie: report.mie, loro: report.loro, voci: report.voci.slice(0, 40), vista: false };
  }

  /** L'utente ha letto il report dell'ultima unione. */
  function unioneLetta() {
    if (!cfg.unione) return;
    salva({ unione: { ...cfg.unione, vista: true } });
    stato.unione = cfg.unione;
    emetti();
  }

  // ------------------------------------------------------------ aggiornamento da altri dispositivi

  /**
   * Da chiamare quando si torna sull'app, ogni tanto, e quando torna la rete.
   * Offline: riprova a collegarsi. Online: se un altro dispositivo ha salvato, prende i dati nuovi (o li unisce alle
   * modifiche di qui) e aumenta stato.aggiornamenti (l'interfaccia si ridisegna). Non lo fa mentre l'utente sta
   * scrivendo o ha un foglio aperto (collega({ occupato })): aspetta la prossima occasione.
   */
  async function controlla() {
    if (stato.modo === 'offline') return connetti();
    if (stato.modo !== 'ok' || inVolo || inConnessione) return undefined;
    let s;
    try { s = await remoto.stato(cfg.codice); } catch (e) { return daErrore(e); }
    const uguale = s.archivio === cfg.archivio && s.revisione === cfg.rev;
    if (cfg.sporco && uguale) return pushOra();
    if (uguale) return undefined;
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
    unioneLetta,
    get attivo() { return stato.modo !== 'nessuno'; },
    get solaLettura() { return bloccato(); },
    iscrivi(f) { ascoltatori.add(f); return () => ascoltatori.delete(f); },
    collega(opzioni) { ui = { ...ui, ...opzioni }; },
  };
}

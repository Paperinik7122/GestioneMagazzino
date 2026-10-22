// Database nel browser: SQLite (sql.js) salvato in IndexedDB dopo ogni modifica.
import { creaSchema, SCHEMA_VERSION } from './db/schema.js';
import { migraDaB4A } from './db/migrate-b4a.js';
import { run, scalar } from './db/util.js';
import { riconosciFile as riconosci, controllaDbNuovo, serializzaReport, nomeFileBackup, descriviDb, dbVuoto, ultimaModificaDb } from './db/backup.js';
import { ErroreDominio } from './domain/errori.js';
import { creaSync } from './sync/sync.js';
import { creaRemoto } from './sync/remoto.js';
import { creaConfig } from './sync/config.js';
import { bloccaScrittura, sbloccaScrittura } from './sync/sola-lettura.js';

const IDB_NOME = 'magazzino-ordini';
const IDB_STORE = 'file';
const CHIAVE = 'db';
const CHIAVE_PRECEDENTE = 'db_precedente'; // copia dei dati com'erano prima dell'ultima sostituzione

let SQL = null;
let db = null;
let timer = null;
let sync = null;
export const stato = { volatile: false, persistente: false, ultimoSalvataggio: 0 };

function apriIdb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB non disponibile'));
    const rq = indexedDB.open(IDB_NOME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(IDB_STORE);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbLeggi(chiave = CHIAVE) {
  const idb = await apriIdb();
  return new Promise((resolve, reject) => {
    const rq = idb.transaction(IDB_STORE).objectStore(IDB_STORE).get(chiave);
    rq.onsuccess = () => resolve(rq.result ?? null);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbScrivi(bytes, chiave = CHIAVE) {
  const idb = await apriIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, chiave);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getDb() { return db; }

/** Il collegamento con il server di casa (vedi src/sync/). Esiste dopo avvia(). */
export function getSync() { return sync; }

const messaggioBlocco = () => (sync?.stato.modo === 'offline'
  ? 'Sei offline: per ora puoi solo consultare i dati. Quando torna la connessione potrai modificarli.'
  : 'Prima completa il collegamento con il server: per ora i dati sono solo da consultare.');

export async function avvia() {
  SQL = await globalThis.initSqlJs({ locateFile: (f) => `./${f}` });
  let bytes = null;
  try { bytes = await idbLeggi(); } catch { stato.volatile = true; }
  if (bytes) {
    db = new SQL.Database(bytes);
    aggiornaSchema();
  } else {
    db = new SQL.Database();
    creaSchema(db);
    await salvaOra();
  }
  try { stato.persistente = !!(await navigator.storage?.persist?.()); } catch { /* ignora */ }
  sync = creaSync({
    remoto: creaRemoto(),
    config: creaConfig(),
    getDb: () => db,
    esporta: () => db.export(),
    apriBytes: preparaRipristino,
    descrivi: (d) => ({ ...descriviDb(d), ultimaModifica: ultimaModificaDb(d) }),
    vuoto: dbVuoto,
    sostituisci: (nuovo, opzioni) => sostituisciDb(nuovo, { ...opzioni, interno: true }),
    blocca: (d) => bloccaScrittura(d, messaggioBlocco),
    sblocca: sbloccaScrittura,
  });
  await sync.avvia();
  return db;
}

/** Punto unico per futuri aggiornamenti dello schema. */
function aggiornaSchema() {
  const v = Number(scalar(db, "SELECT valore FROM meta WHERE chiave = 'schema_version'") ?? 0);
  if (v > SCHEMA_VERSION) throw new Error('Questo database è stato creato da una versione più recente dell’app.');
}

export async function salvaOra() {
  clearTimeout(timer);
  timer = null;
  if (!db) return;
  try {
    await idbScrivi(db.export());
    stato.ultimoSalvataggio = Date.now();
  } catch (e) {
    stato.volatile = true;
    console.error('Salvataggio non riuscito', e);
  }
}

/** Da chiamare dopo ogni modifica: salva poco dopo, senza bloccare l'interfaccia. */
export function modificato() {
  sync?.modificato();
  if (timer) return;
  timer = setTimeout(salvaOra, 400);
}

export function meta(chiave) {
  return scalar(db, 'SELECT valore FROM meta WHERE chiave = ?', [chiave]);
}
export function setMeta(chiave, valore) {
  db.run('INSERT INTO meta(chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore', [chiave, String(valore)]);
  modificato();
}

export function esportaBytes() { return db.export(); }

/**
 * Nome del file e contenuto del backup di adesso. La data del backup viene scritta dentro il file;
 * se poi il salvataggio viene annullato, annulla() rimette la data di prima.
 */
export function preparaBackup() {
  if (db.__bloccato) { // offline: il backup si fa lo stesso, ma non si può scrivere la data dentro il database
    return { nome: nomeFileBackup(), bytes: db.export(), annulla: () => {} };
  }
  const prima = meta('ultimo_backup') ?? '';
  setMeta('ultimo_backup', new Date().toISOString());
  return { nome: nomeFileBackup(), bytes: db.export(), annulla: () => setMeta('ultimo_backup', prima) };
}

/** Da chiamare solo quando il file di backup è stato davvero salvato o condiviso. */
export async function backupFatto() {
  await salvaOra();
}

/** Riconosce il tipo di file: 'nuovo' (questa app), 'b4a' (vecchia app) o null. */
export function riconosciFile(bytes) { return riconosci(SQL, bytes); }

/** Prepara la migrazione dal vecchio DB senza toccare quello attuale. */
export function preparaImportVecchio(bytes) {
  const vecchio = new SQL.Database(bytes);
  const nuovo = new SQL.Database();
  try {
    const report = migraDaB4A(vecchio, nuovo);
    run(nuovo, "INSERT OR REPLACE INTO meta(chiave, valore) VALUES ('report_migrazione', ?)", [serializzaReport(report)]);
    return { nuovo, report };
  } catch (e) {
    nuovo.close();
    throw e;
  } finally { vecchio.close(); }
}

/** Apre un backup di questa app e lo controlla, senza toccare quello attuale. */
export function preparaRipristino(bytes) {
  const d = new SQL.Database(bytes);
  try {
    controllaDbNuovo(d);
    return d;
  } catch (e) { d.close(); throw e; }
}

/**
 * Mette al posto dei dati attuali un altro database; i dati di prima restano recuperabili una volta.
 * Con il server collegato, i dati nuovi vengono inviati subito (a meno che non vengano proprio dal server: interno).
 * conserva: tenere comunque i dati di prima (predefinito: solo se non erano vuoti).
 */
export async function sostituisciDb(nuovoDb, { conserva = null, interno = false } = {}) {
  if (!interno && sync?.solaLettura) {
    throw new ErroreDominio('Sei offline: per sostituire i dati serve il collegamento con il server.');
  }
  const vecchio = db;
  if (conserva ?? (vecchio && !dbVuoto(vecchio))) {
    try { await idbScrivi(vecchio.export(), CHIAVE_PRECEDENTE); } catch { /* senza copia si prosegue lo stesso */ }
  }
  db = nuovoDb;
  await salvaOra();
  try { vecchio?.close(); } catch { /* ignora */ }
  if (!interno) await sync?.sostituzioneFatta();
}

export async function esistonoDatiPrecedenti() {
  try { return !!(await idbLeggi(CHIAVE_PRECEDENTE)); } catch { return false; }
}

/** Torna ai dati di prima dell'ultima sostituzione (e quelli attuali diventano "precedenti"). */
export async function tornaAiDatiPrecedenti() {
  const bytes = await idbLeggi(CHIAVE_PRECEDENTE);
  if (!bytes) return false;
  const d = new SQL.Database(bytes);
  try { controllaDbNuovo(d); } catch (e) { d.close(); throw e; }
  await sostituisciDb(d);
  return true;
}

export function contaDati() {
  return {
    ordini: scalar(db, 'SELECT COUNT(*) FROM ordini'),
    prodotti: scalar(db, 'SELECT COUNT(*) FROM magazzino WHERE in_magazzino = 1'),
  };
}

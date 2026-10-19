// Database nel browser: SQLite (sql.js) salvato in IndexedDB dopo ogni modifica.
import { creaSchema, SCHEMA_VERSION } from './db/schema.js';
import { migraDaB4A } from './db/migrate-b4a.js';
import { all, scalar } from './db/util.js';

const IDB_NOME = 'magazzino-ordini';
const IDB_STORE = 'file';
const CHIAVE = 'db';

let SQL = null;
let db = null;
let timer = null;
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
async function idbLeggi() {
  const idb = await apriIdb();
  return new Promise((resolve, reject) => {
    const rq = idb.transaction(IDB_STORE).objectStore(IDB_STORE).get(CHIAVE);
    rq.onsuccess = () => resolve(rq.result ?? null);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbScrivi(bytes) {
  const idb = await apriIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, CHIAVE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getDb() { return db; }

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

/** Riconosce il tipo di file: 'nuovo' (questa app), 'b4a' (vecchia app) o null. */
export function riconosciFile(bytes) {
  let prova;
  try { prova = new SQL.Database(bytes); } catch { return null; }
  try {
    const tabelle = all(prova, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    if (tabelle.includes('righe_ordine') && tabelle.includes('meta')) return 'nuovo';
    if (tabelle.includes('TabMagazzino') && tabelle.includes('TabOrdini')) return 'b4a';
    return null;
  } finally { prova.close(); }
}

/** Prepara la migrazione dal vecchio DB senza toccare quello attuale. */
export function preparaImportVecchio(bytes) {
  const vecchio = new SQL.Database(bytes);
  const nuovo = new SQL.Database();
  try {
    const report = migraDaB4A(vecchio, nuovo);
    return { nuovo, report };
  } finally { vecchio.close(); }
}

export function preparaRipristino(bytes) {
  const d = new SQL.Database(bytes);
  const v = Number(scalar(d, "SELECT valore FROM meta WHERE chiave = 'schema_version'") ?? 0);
  if (v > SCHEMA_VERSION) { d.close(); throw new Error('Il file è di una versione più recente dell’app.'); }
  return d;
}

export async function sostituisciDb(nuovoDb) {
  const vecchio = db;
  db = nuovoDb;
  await salvaOra();
  try { vecchio?.close(); } catch { /* ignora */ }
}

export function contaDati() {
  return {
    ordini: scalar(db, 'SELECT COUNT(*) FROM ordini'),
    prodotti: scalar(db, 'SELECT COUNT(*) FROM magazzino WHERE in_magazzino = 1'),
  };
}

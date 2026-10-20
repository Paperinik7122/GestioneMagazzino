// Backup, ripristino e import: parti pure, senza browser (si provano anche in Node).
import { all, scalar } from './util.js';
import { SCHEMA_VERSION } from './schema.js';
import { ErroreDominio } from '../domain/errori.js';

const TABELLE_NUOVO = ['meta', 'contatti', 'posizioni', 'prodotti', 'codici', 'ordini', 'magazzino', 'righe_ordine'];

/** "magazzino-2026-10-20-1102.db" */
export function nomeFileBackup(adesso = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `magazzino-${adesso.getFullYear()}-${p(adesso.getMonth() + 1)}-${p(adesso.getDate())}-${p(adesso.getHours())}${p(adesso.getMinutes())}.db`;
}

/** Riconosce il tipo di file: 'nuovo' (questa app), 'b4a' (vecchia app) o null. */
export function riconosciFile(SQL, bytes) {
  let prova;
  try {
    prova = new SQL.Database(bytes);
    const tabelle = all(prova, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    if (tabelle.includes('righe_ordine') && tabelle.includes('meta')) return 'nuovo';
    if (tabelle.includes('TabMagazzino') && tabelle.includes('TabOrdini')) return 'b4a';
    return null;
  } catch {
    return null; // non è un database SQLite
  } finally {
    try { prova?.close(); } catch { /* ignora */ }
  }
}

/** Controlla che un database "nuovo" sia completo e non più recente dell'app. */
export function controllaDbNuovo(db) {
  const tabelle = new Set(all(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name));
  const mancanti = TABELLE_NUOVO.filter((t) => !tabelle.has(t));
  if (mancanti.length) throw new ErroreDominio(`Il file è incompleto (mancano: ${mancanti.join(', ')}).`);
  const v = Number(scalar(db, "SELECT valore FROM meta WHERE chiave = 'schema_version'") ?? 0);
  if (v > SCHEMA_VERSION) throw new ErroreDominio('Il file è stato creato da una versione più recente dell’app: aggiorna l’app e riprova.');
  if (!scalar(db, 'SELECT COUNT(*) FROM posizioni WHERE speciale = 1')) {
    throw new ErroreDominio('Il file è incompleto (manca la posizione “Da collocare”).');
  }
}

/** Numeri principali di un database "nuovo", per mostrarli prima di sostituire i dati. */
export function descriviDb(db) {
  return {
    ordini: scalar(db, 'SELECT COUNT(*) FROM ordini'),
    prodotti: scalar(db, 'SELECT COUNT(*) FROM magazzino WHERE in_magazzino = 1'),
    contatti: scalar(db, 'SELECT COUNT(*) FROM contatti'),
    ultimoBackup: scalar(db, "SELECT valore FROM meta WHERE chiave = 'ultimo_backup'") || null,
  };
}

/** Un database senza ordini né prodotti né contatti è "vuoto": sostituirlo non fa perdere nulla. */
export function dbVuoto(db) {
  const d = descriviDb(db);
  const mag = scalar(db, 'SELECT COUNT(*) FROM magazzino');
  return d.ordini === 0 && mag === 0 && d.contatti === 0;
}

const ETICHETTE_CONTEGGI = [
  ['ordini', 'ordini', 'ordine'],
  ['righeOrdine', 'righe d’ordine', 'riga d’ordine'],
  ['magazzino', 'prodotti in archivio', 'prodotto in archivio'],
  ['inMagazzino', 'prodotti ancora in magazzino', 'prodotto ancora in magazzino'],
  ['contatti', 'contatti', 'contatto'],
  ['codici', 'codici', 'codice'],
  ['posizioni', 'posizioni', 'posizione'],
];

/** Riga per riga, in italiano, cosa ha trovato la migrazione (per la schermata del report). */
export function righeReport(report) {
  const c = report.conteggi ?? {};
  const conteggi = ETICHETTE_CONTEGGI
    .filter(([k]) => c[k] !== undefined)
    .map(([k, molti, uno]) => ({ n: c[k], testo: c[k] === 1 ? uno : molti }));
  const extra = [];
  if (c.contattiInRubrica > 0) {
    extra.push(`${c.contattiInRubrica} contatti letti dalla rubrica (con telefono, note e alias).`);
  }
  if (!c.contattiInRubrica && c.contattiOriginali > c.contatti) {
    extra.push(`${c.contattiOriginali} scritture di nomi contatto unite in ${c.contatti} (stesso nome a meno di maiuscole e spazi).`);
  }
  if (c.prodottiEquivalenti !== undefined && c.codici > c.prodottiEquivalenti) {
    extra.push(`${c.codici} codici raggruppati in ${c.prodottiEquivalenti} prodotti equivalenti.`);
  }
  if (c.prodottiSenzaDataAcquisto) {
    extra.push(`${c.prodottiSenzaDataAcquisto} prodotti senza data di acquisto: completali dal dettaglio del prodotto.`);
  }
  return {
    conteggi,
    extra,
    anomalie: (report.anomalie ?? []).map((a) => ({ testo: a.tipo, n: a.n, esempi: a.esempi ?? [] })),
    proposte: report.proposteUnioneContatti ?? [],
  };
}

/** Il report si conserva dentro il database, per rivederlo dopo (testo JSON). */
export function serializzaReport(report) {
  return JSON.stringify({ quando: new Date().toISOString(), report });
}
export function leggiReport(testo) {
  if (!testo) return null;
  try {
    const o = JSON.parse(testo);
    return o?.report ? o : null;
  } catch { return null; }
}

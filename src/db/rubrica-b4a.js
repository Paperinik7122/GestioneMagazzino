// Rubrica (TabContatti) del vecchio DB B4A: popolarla dai nomi scritti negli ordini e rileggerla in fase di import.
//
// Colonne: Nome, Telefono, Indirizzo, Email (già presenti nella vecchia app, ma mai usate) più
//   Tipo  = C cliente / F fornitore
//   Note  = note libere
//   Alias = altre scritture dello stesso contatto, separate da "|" (es. "Mamma|mamma rita"):
//           chi sistema il DB a mano sposta lì i nomi doppi invece di unirli dopo nell'app.

import { all, run } from './util.js';
import { norm, chiave } from './normalizza.js';

const COLONNE_AGGIUNTE = [['Tipo', "TEXT DEFAULT 'C'"], ['Note', "TEXT DEFAULT ''"], ['Alias', "TEXT DEFAULT ''"]];

/** Variante più frequente di un insieme di scritture (a parità, la prima incontrata). */
export function piuFrequente(valori) {
  const conta = new Map();
  for (const v of valori) conta.set(v, (conta.get(v) ?? 0) + 1);
  let best = null;
  let bestN = -1;
  for (const [v, n] of conta) if (n > bestN) { best = v; bestN = n; }
  return best;
}

export const tipoContatto = (t) => (/^f/i.test(norm(t)) ? 'F' : 'C');

/** Elenco di alias da un testo "a|b|c" (anche con ; o a capo). */
export const elencoAlias = (testo) => norm(String(testo ?? '').replace(/[|;\n]+/g, '|')).split('|').map(norm).filter(Boolean);

/**
 * Contatti ricavati dagli ordini: scritture che differiscono solo per maiuscole e spazi sono lo stesso
 * contatto. Restituisce Map chiave -> { nome, tipo, scritture[], misto }.
 */
export function contattiDaOrdini(ordini) {
  const per = new Map();
  for (const o of ordini) {
    const k = chiave(o.Contatto);
    if (!k) continue;
    if (!per.has(k)) per.set(k, { scritture: [], tipi: new Set() });
    const v = per.get(k);
    v.scritture.push(norm(o.Contatto));
    v.tipi.add(o.Verso === 'A' ? 'F' : 'C');
  }
  const out = new Map();
  for (const [k, v] of per) {
    out.set(k, { nome: piuFrequente(v.scritture), tipo: v.tipi.has('C') ? 'C' : 'F', scritture: v.scritture, misto: v.tipi.size > 1 });
  }
  return out;
}

const esisteTabella = (db, nome) => all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [nome]).length > 0;
const colonne = (db) => new Set(all(db, 'PRAGMA table_info(TabContatti)').map((c) => c.name));

/** Righe della rubrica, già pulite (senza nomi vuoti). Vuoto se la tabella non c'è o non ha righe. */
export function leggiRubrica(db) {
  if (!esisteTabella(db, 'TabContatti')) return [];
  const col = colonne(db);
  const sel = ['Nome', 'Telefono', 'Indirizzo', 'Email', 'Tipo', 'Note', 'Alias'].map((c) => (col.has(c) ? c : `'' AS ${c}`));
  return all(db, `SELECT rowid AS rid, ${sel.join(', ')} FROM TabContatti ORDER BY rowid`)
    .map((r) => ({
      nome: norm(r.Nome), tipo: tipoContatto(r.Tipo), telefono: norm(r.Telefono), indirizzo: norm(r.Indirizzo),
      email: norm(r.Email), note: norm(r.Note), alias: elencoAlias(r.Alias),
    }))
    .filter((r) => r.nome);
}

/**
 * Riempie TabContatti con i nomi degli ordini (modifica `db`, che deve essere una COPIA del vecchio DB).
 * Non unisce nomi diversi: lo fa chi sistema il DB (colonna Alias) o l'utente nell'app (Unisci).
 * Rifiuta di toccare una rubrica che ha già dei dati, per non cancellare il lavoro fatto a mano.
 */
export function popolaRubrica(db) {
  if (!esisteTabella(db, 'TabContatti')) {
    db.run('CREATE TABLE TabContatti (Nome TEXT, Telefono TEXT, Indirizzo TEXT, Email TEXT)');
  }
  const esistenti = all(db, 'SELECT COUNT(*) AS n FROM TabContatti')[0].n;
  if (esistenti > 0) throw new Error(`TabContatti contiene già ${esistenti} righe: non la sovrascrivo.`);
  const col = colonne(db);
  for (const [nome, def] of COLONNE_AGGIUNTE) if (!col.has(nome)) db.run(`ALTER TABLE TabContatti ADD COLUMN ${nome} ${def}`);

  const ordini = all(db, 'SELECT Contatto, Verso FROM TabOrdini ORDER BY Numero');
  const contatti = [...contattiDaOrdini(ordini).values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
  db.run('BEGIN');
  try {
    for (const c of contatti) {
      const alias = [...new Set(c.scritture.filter((s) => s !== c.nome))];
      run(db, "INSERT INTO TabContatti(Nome, Telefono, Indirizzo, Email, Tipo, Note, Alias) VALUES (?, '', '', '', ?, '', ?)",
        [c.nome, c.tipo, alias.join('|')]);
    }
    db.run('COMMIT');
  } catch (e) { db.run('ROLLBACK'); throw e; }
  return { contatti: contatti.length, misti: contatti.filter((c) => c.misto).map((c) => c.nome) };
}

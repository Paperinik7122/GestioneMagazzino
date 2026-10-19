// Piccoli helper sopra sql.js (funzionano sia in Node che nel browser).

/** Esegue una SELECT e restituisce un array di oggetti. */
export function all(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

/** Prima riga della SELECT, oppure undefined. */
export function get(db, sql, params = []) {
  return all(db, sql, params)[0];
}

/** Primo valore della prima riga (es. COUNT(*)). */
export function scalar(db, sql, params = []) {
  const row = all(db, sql, params)[0];
  return row ? Object.values(row)[0] : undefined;
}

/** INSERT/UPDATE/DELETE. Restituisce { changes, lastId }. */
export function run(db, sql, params = []) {
  db.run(sql, params);
  return {
    changes: db.getRowsModified(),
    lastId: scalar(db, 'SELECT last_insert_rowid()'),
  };
}

const profondita = new WeakMap();

/**
 * Esegue fn dentro una transazione; annulla tutto se lancia un errore.
 * Si può annidare: conta solo la transazione più esterna.
 */
export function transaction(db, fn) {
  const livello = profondita.get(db) ?? 0;
  if (livello > 0) return fn();
  db.run('BEGIN');
  profondita.set(db, 1);
  try {
    const out = fn();
    db.run('COMMIT');
    return out;
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  } finally {
    profondita.set(db, 0);
  }
}

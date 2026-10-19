import { all, get, run } from '../db/util.js';
import { norm } from '../db/normalizza.js';
import { richiedi } from './errori.js';

/** Trova il contatto (senza badare a maiuscole/spazi) o lo crea. */
export function assicuraContatto(db, nome, tipo = 'C') {
  const n = norm(nome);
  richiedi(n, 'Scrivi il nome del contatto.');
  const c = get(db, 'SELECT * FROM contatti WHERE nome = ? COLLATE NOCASE', [n]);
  if (c) return c;
  const id = run(db, 'INSERT INTO contatti(nome, tipo) VALUES (?, ?)', [n, tipo === 'F' ? 'F' : 'C']).lastId;
  return get(db, 'SELECT * FROM contatti WHERE id = ?', [id]);
}

export function elencoContatti(db, tipo = null) {
  return all(db, `SELECT c.*, (SELECT COUNT(*) FROM ordini o WHERE o.contatto_id = c.id) AS n_ordini
    FROM contatti c ${tipo ? 'WHERE c.tipo = ?' : ''} ORDER BY c.nome COLLATE NOCASE`, tipo ? [tipo] : []);
}

/** Unisce due contatti (es. "paola" e "paola suocera"): gli ordini passano al primo. */
export function unisciContatti(db, tieniId, eliminaId) {
  richiedi(tieniId !== eliminaId, 'Scegli due contatti diversi.');
  run(db, 'UPDATE ordini SET contatto_id = ? WHERE contatto_id = ?', [tieniId, eliminaId]);
  run(db, 'DELETE FROM contatti WHERE id = ?', [eliminaId]);
}

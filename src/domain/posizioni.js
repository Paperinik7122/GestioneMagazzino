// Elenco chiuso delle posizioni di magazzino (si sceglie da lista, non si scrive a mano).
import { all, get, run, scalar, transaction } from '../db/util.js';
import { norm } from '../db/normalizza.js';
import { ErroreDominio, richiedi } from './errori.js';

export function elencoPosizioni(db) {
  return all(db, `SELECT p.id, p.nome, p.speciale,
      (SELECT COUNT(*) FROM magazzino m WHERE m.posizione_id = p.id AND m.in_magazzino = 1) AS n_prodotti
    FROM posizioni p ORDER BY p.speciale DESC, p.ordine, p.nome COLLATE NOCASE`);
}

export function creaPosizione(db, nome) {
  const n = norm(nome);
  richiedi(n, 'Scrivi il nome della posizione.');
  richiedi(!get(db, 'SELECT 1 FROM posizioni WHERE nome = ? COLLATE NOCASE', [n]),
    `La posizione “${n}” esiste già.`);
  const ordine = (scalar(db, 'SELECT MAX(ordine) FROM posizioni') ?? 0) + 1;
  return run(db, 'INSERT INTO posizioni(nome, ordine) VALUES (?, ?)', [n, ordine]).lastId;
}

export function rinominaPosizione(db, id, nome) {
  const n = norm(nome);
  richiedi(n, 'Scrivi il nome della posizione.');
  const p = get(db, 'SELECT * FROM posizioni WHERE id = ?', [id]);
  richiedi(p, 'Posizione non trovata.');
  richiedi(!p.speciale, '“Da collocare” non si può rinominare.');
  richiedi(!get(db, 'SELECT 1 FROM posizioni WHERE nome = ? COLLATE NOCASE AND id <> ?', [n, id]),
    `La posizione “${n}” esiste già.`);
  run(db, 'UPDATE posizioni SET nome = ? WHERE id = ?', [n, id]);
}

/** Elimina solo se non ci sono prodotti in magazzino; i prodotti già usciti perdono il riferimento. */
export function eliminaPosizione(db, id) {
  const p = get(db, 'SELECT * FROM posizioni WHERE id = ?', [id]);
  richiedi(p, 'Posizione non trovata.');
  richiedi(!p.speciale, '“Da collocare” non si può eliminare.');
  const n = scalar(db, 'SELECT COUNT(*) FROM magazzino WHERE posizione_id = ? AND in_magazzino = 1', [id]);
  if (n > 0) throw new ErroreDominio(`In “${p.nome}” ci sono ancora ${n} prodotti: spostali prima.`);
  transaction(db, () => {
    run(db, 'UPDATE magazzino SET posizione_id = NULL WHERE posizione_id = ?', [id]);
    run(db, 'DELETE FROM posizioni WHERE id = ?', [id]);
  });
}

/** Sposta tutti i prodotti da una posizione a un'altra (es. unire “Scatola 0” in “Scatola 1”). */
export function unisciPosizioni(db, daId, aId) {
  richiedi(daId !== aId, 'Scegli due posizioni diverse.');
  const da = get(db, 'SELECT * FROM posizioni WHERE id = ?', [daId]);
  const a = get(db, 'SELECT * FROM posizioni WHERE id = ?', [aId]);
  richiedi(da && a, 'Posizione non trovata.');
  richiedi(!da.speciale, '“Da collocare” non si può unire a un’altra posizione.');
  transaction(db, () => {
    run(db, 'UPDATE magazzino SET posizione_id = ? WHERE posizione_id = ?', [aId, daId]);
    run(db, 'DELETE FROM posizioni WHERE id = ?', [daId]);
  });
}

export function idDaCollocare(db) {
  return scalar(db, 'SELECT id FROM posizioni WHERE speciale = 1');
}

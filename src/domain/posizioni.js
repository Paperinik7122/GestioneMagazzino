// Elenco chiuso delle posizioni di magazzino (si sceglie da lista, non si scrive a mano).
import { all, get, run, scalar, transaction } from '../db/util.js';
import { norm, compatta } from '../db/normalizza.js';
import { ErroreDominio, richiedi } from './errori.js';

export function elencoPosizioni(db) {
  return all(db, `SELECT p.id, p.nome, p.speciale,
      (SELECT COUNT(*) FROM magazzino m WHERE m.posizione_id = p.id AND m.in_magazzino = 1) AS n_prodotti
    FROM posizioni p ORDER BY p.speciale DESC, p.ordine, p.nome COLLATE NOCASE`);
}

/** Posizione già esistente con lo stesso nome a meno di maiuscole, spazi e punteggiatura ("scatola-1" = "Scatola 1"). */
function posizioneUguale(db, nome, escludiId = null) {
  const k = compatta(nome);
  return all(db, 'SELECT id, nome FROM posizioni').find((p) => p.id !== escludiId && compatta(p.nome) === k) ?? null;
}

export function creaPosizione(db, nome) {
  const n = norm(nome);
  richiedi(n, 'Scrivi il nome della posizione.');
  const uguale = posizioneUguale(db, n);
  richiedi(!uguale, `Esiste già la posizione “${uguale?.nome}”.`);
  const ordine = (scalar(db, 'SELECT MAX(ordine) FROM posizioni') ?? 0) + 1;
  return run(db, 'INSERT INTO posizioni(nome, ordine) VALUES (?, ?)', [n, ordine]).lastId;
}

export function rinominaPosizione(db, id, nome) {
  const n = norm(nome);
  richiedi(n, 'Scrivi il nome della posizione.');
  const p = get(db, 'SELECT * FROM posizioni WHERE id = ?', [id]);
  richiedi(p, 'Posizione non trovata.');
  richiedi(!p.speciale, '“Da collocare” non si può rinominare.');
  const uguale = posizioneUguale(db, n, id);
  richiedi(!uguale, `Esiste già la posizione “${uguale?.nome}”.`);
  run(db, 'UPDATE posizioni SET nome = ? WHERE id = ?', [n, id]);
}

/** Elimina solo se non ci sono prodotti in magazzino; i prodotti già usciti perdono il riferimento. */
export function eliminaPosizione(db, id) {
  const p = get(db, 'SELECT * FROM posizioni WHERE id = ?', [id]);
  richiedi(p, 'Posizione non trovata.');
  richiedi(!p.speciale, '“Da collocare” non si può eliminare.');
  const n = scalar(db, 'SELECT COUNT(*) FROM magazzino WHERE posizione_id = ? AND in_magazzino = 1', [id]);
  if (n > 0) throw new ErroreDominio((n === 1 ? `In “${p.nome}” c’è ancora 1 prodotto: spostalo prima.` : `In “${p.nome}” ci sono ancora ${n} prodotti: spostali prima.`));
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

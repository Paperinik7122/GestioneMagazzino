// Prodotti in magazzino: elenco, dettaglio, inserimento (inventario), uscite.
import { all, get, run, scalar, transaction } from '../db/util.js';
import { norm, parole, compatta } from '../db/normalizza.js';
import { MOTIVI_ENTRATA, MOTIVI_USCITA } from '../db/schema.js';
import { ErroreDominio, richiedi } from './errori.js';
import { assicuraCodice } from './codici.js';
import { idDaCollocare } from './posizioni.js';
import { leggiPrezzo } from './numeri.js';

/**
 * Elenco raggruppato per codice, solo prodotti ancora in magazzino.
 * posizioneId: numero, 'da_collocare' oppure null (tutte).
 */
export function elencoMagazzino(db, { testo = '', posizioneId = null } = {}) {
  const params = [];
  let where = 'm.in_magazzino = 1';
  if (posizioneId === 'da_collocare') where += ' AND p.speciale = 1';
  else if (posizioneId) { where += ' AND m.posizione_id = ?'; params.push(posizioneId); }
  let righe = all(db, `
    SELECT m.codice, MAX(m.nome) AS nome, COUNT(*) AS quantita,
           GROUP_CONCAT(DISTINCT p.nome) AS posizioni,
           SUM(CASE WHEN p.speciale = 1 THEN 1 ELSE 0 END) AS da_collocare,
           SUM(EXISTS(SELECT 1 FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
                      WHERE r.magazzino_id = m.id AND o.evaso = 0)) AS impegnati
    FROM magazzino m LEFT JOIN posizioni p ON p.id = m.posizione_id
    WHERE ${where}
    GROUP BY m.codice
    ORDER BY nome COLLATE NOCASE`, params);
  // ricerca per parole in qualsiasi ordine (senza badare ad accenti e punteggiatura) nel nome, oppure cifre del codice
  const w = parole(testo);
  if (w.length) {
    const k = compatta(testo);
    righe = righe.filter((r) => {
      const wn = parole(r.nome);
      return compatta(r.codice).includes(k) || w.every((x) => wn.some((y) => y.includes(x)));
    });
  }
  return righe;
}

export function riepilogoMagazzino(db) {
  return {
    prodotti: scalar(db, 'SELECT COUNT(*) FROM magazzino WHERE in_magazzino = 1'),
    codici: scalar(db, 'SELECT COUNT(DISTINCT codice) FROM magazzino WHERE in_magazzino = 1'),
    daCollocare: scalar(db, `SELECT COUNT(*) FROM magazzino m JOIN posizioni p ON p.id = m.posizione_id
      WHERE m.in_magazzino = 1 AND p.speciale = 1`),
    senzaDataAcquisto: scalar(db, 'SELECT COUNT(*) FROM magazzino WHERE in_magazzino = 1 AND data_acquisto IS NULL'),
  };
}

/** Dettaglio di un codice: ogni prodotto con posizione, data, prezzo, stato (libero/impegnato). */
export function dettaglioCodice(db, codice) {
  const prodotti = all(db, `
    SELECT m.id, m.codice, m.nome, m.prezzo_acquisto, m.data_acquisto, m.catalogo_acquisto,
           m.ordine_in, m.motivo_in, m.note, m.posizione_id,
           p.nome AS posizione, COALESCE(p.speciale, 0) AS da_collocare,
           (SELECT r.ordine_id FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
             WHERE r.magazzino_id = m.id AND o.evaso = 0 LIMIT 1) AS impegnato_in_ordine
    FROM magazzino m LEFT JOIN posizioni p ON p.id = m.posizione_id
    WHERE m.in_magazzino = 1 AND m.codice = ?
    ORDER BY COALESCE(p.speciale, 0) DESC, p.ordine, m.data_acquisto, m.prezzo_acquisto, m.id`, [norm(codice)]);
  const nome = prodotti[0]?.nome ?? get(db, 'SELECT nome FROM codici WHERE codice = ?', [norm(codice)])?.nome ?? '';
  const prezzi = prodotti.map((p) => p.prezzo_acquisto).filter((x) => x !== null);
  return {
    codice: norm(codice), nome, prodotti,
    prezzoMin: prezzi.length ? Math.min(...prezzi) : null,
    prezzoMax: prezzi.length ? Math.max(...prezzi) : null,
    senzaData: prodotti.filter((p) => !p.data_acquisto).length,
  };
}

/**
 * Inserisce N prodotti nuovi (inventario, ritrovamento, regalo).
 * La posizione è obbligatoria e deve esistere: se manca va in "Da collocare".
 */
export function creaProdotti(db, d) {
  const quantita = Number(d.quantita ?? 1);
  richiedi(Number.isInteger(quantita) && quantita >= 1 && quantita <= 500, 'La quantità deve essere un numero da 1 a 500.');
  const motivo = d.motivoIn ?? 'Inventario';
  richiedi(MOTIVI_ENTRATA.includes(motivo), 'Motivo di entrata non valido.');
  const cod = assicuraCodice(db, d.codice, d.nome);
  const posId = d.posizioneId ?? idDaCollocare(db);
  richiedi(get(db, 'SELECT 1 FROM posizioni WHERE id = ?', [posId]), 'Scegli una posizione dall’elenco.');
  const prezzo = leggiPrezzo(d.prezzoAcquisto);
  richiedi(prezzo === null || (Number.isFinite(prezzo) && prezzo >= 0), 'Il prezzo di acquisto non è valido.');
  const ids = [];
  transaction(db, () => {
    for (let i = 0; i < quantita; i++) {
      ids.push(run(db, `INSERT INTO magazzino(codice, nome, posizione_id, data_acquisto, prezzo_acquisto,
          catalogo_acquisto, motivo_in, note) VALUES (?,?,?,?,?,?,?,?)`,
      [cod.codice, norm(d.nome) || cod.nome, posId, d.dataAcquisto || null, prezzo,
        norm(d.catalogo).toUpperCase(), motivo, norm(d.note)]).lastId);
    }
  });
  return ids;
}

export function modificaProdotto(db, id, d) {
  const m = get(db, 'SELECT * FROM magazzino WHERE id = ?', [id]);
  richiedi(m, 'Prodotto non trovato.');
  const campi = [];
  const val = [];
  const imposta = (col, v) => { campi.push(`${col} = ?`); val.push(v); };
  if ('posizioneId' in d) {
    richiedi(get(db, 'SELECT 1 FROM posizioni WHERE id = ?', [d.posizioneId]), 'Scegli una posizione dall’elenco.');
    imposta('posizione_id', d.posizioneId);
  }
  if ('dataAcquisto' in d) imposta('data_acquisto', d.dataAcquisto || null);
  if ('prezzoAcquisto' in d) {
    const p = leggiPrezzo(d.prezzoAcquisto);
    richiedi(p === null || (Number.isFinite(p) && p >= 0), 'Il prezzo di acquisto non è valido.');
    imposta('prezzo_acquisto', p);
  }
  if ('catalogo' in d) imposta('catalogo_acquisto', norm(d.catalogo).toUpperCase());
  if ('note' in d) imposta('note', norm(d.note));
  if ('motivoIn' in d) {
    richiedi(d.motivoIn === null || MOTIVI_ENTRATA.includes(d.motivoIn), 'Motivo di entrata non valido.');
    imposta('motivo_in', d.motivoIn);
  }
  if (!campi.length) return;
  run(db, `UPDATE magazzino SET ${campi.join(', ')} WHERE id = ?`, [...val, id]);
}

export function spostaProdotti(db, ids, posizioneId) {
  richiedi(get(db, 'SELECT 1 FROM posizioni WHERE id = ?', [posizioneId]), 'Scegli una posizione dall’elenco.');
  transaction(db, () => {
    for (const id of ids) run(db, 'UPDATE magazzino SET posizione_id = ? WHERE id = ? AND in_magazzino = 1', [posizioneId, id]);
  });
}

/** Uscita senza ordine (usato, perso, regalato, buttato). Un prodotto impegnato non può uscire così. */
export function segnaUscita(db, ids, motivo, data) {
  richiedi(MOTIVI_USCITA.includes(motivo), 'Motivo di uscita non valido.');
  transaction(db, () => {
    for (const id of ids) {
      const impegnato = get(db, `SELECT r.ordine_id FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
        WHERE r.magazzino_id = ? AND o.evaso = 0 LIMIT 1`, [id]);
      if (impegnato) {
        throw new ErroreDominio(`Un prodotto è assegnato all’ordine #${impegnato.ordine_id}: scollegalo prima.`);
      }
      run(db, `UPDATE magazzino SET in_magazzino = 0, motivo_out = ?, data_uscita = ?, ordine_out = NULL
        WHERE id = ? AND in_magazzino = 1`, [motivo, data || null, id]);
    }
  });
}

export function eliminaProdotto(db, id) {
  const impegnato = get(db, `SELECT r.ordine_id FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
    WHERE r.magazzino_id = ? AND o.evaso = 0 LIMIT 1`, [id]);
  if (impegnato) throw new ErroreDominio(`Il prodotto è assegnato all’ordine #${impegnato.ordine_id}: scollegalo prima.`);
  transaction(db, () => {
    run(db, 'UPDATE righe_ordine SET magazzino_id = NULL WHERE magazzino_id = ?', [id]);
    run(db, 'DELETE FROM magazzino WHERE id = ?', [id]);
  });
}

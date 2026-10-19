// Codici prodotto e prodotti equivalenti ("simili").
import { all, get, run } from '../db/util.js';
import { norm, chiaveEquivalenza } from '../db/normalizza.js';
import { richiedi } from './errori.js';

/** Restituisce il codice; se è nuovo lo crea e lo mette nel gruppo di equivalenza giusto. */
export function assicuraCodice(db, codice, nome) {
  const cod = norm(codice);
  const nm = norm(nome);
  richiedi(cod, 'Serve il codice del prodotto.');
  richiedi(nm, 'Serve il nome del prodotto.');
  const esistente = get(db, 'SELECT * FROM codici WHERE codice = ?', [cod]);
  if (esistente) return esistente;
  const k = chiaveEquivalenza(nm);
  let prodottoId = null;
  if (k) {
    for (const p of all(db, 'SELECT id, nome FROM prodotti')) {
      if (chiaveEquivalenza(p.nome) === k) { prodottoId = p.id; break; }
    }
  }
  if (!prodottoId) prodottoId = run(db, 'INSERT INTO prodotti(nome) VALUES (?)', [nm]).lastId;
  run(db, 'INSERT INTO codici(codice, nome, prodotto_id) VALUES (?,?,?)', [cod, nm, prodottoId]);
  return { codice: cod, nome: nm, prodotto_id: prodottoId };
}

const SQL_DISPONIBILI = `
  SELECT m.id, m.codice, m.nome, m.prezzo_acquisto, m.data_acquisto, m.catalogo_acquisto,
         m.motivo_in, m.ordine_in, p.nome AS posizione, COALESCE(p.speciale, 0) AS da_collocare
  FROM magazzino m LEFT JOIN posizioni p ON p.id = m.posizione_id
  WHERE m.in_magazzino = 1 AND m.codice = ?
    AND NOT EXISTS (SELECT 1 FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
                    WHERE r.magazzino_id = m.id AND o.evaso = 0)
  ORDER BY (m.data_acquisto IS NULL), m.data_acquisto, m.prezzo_acquisto, m.id`;

/** Prodotti liberi (non collegati a un ordine aperto) con questo codice. */
export function prodottiDisponibili(db, codice) {
  return all(db, SQL_DISPONIBILI, [norm(codice)]);
}

/** Quanti prodotti con questo codice sono in magazzino ma già assegnati a un ordine aperto. */
export function contaImpegnati(db, codice) {
  return get(db, `SELECT COUNT(*) AS n FROM magazzino m
    WHERE m.in_magazzino = 1 AND m.codice = ?
      AND EXISTS (SELECT 1 FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
                  WHERE r.magazzino_id = m.id AND o.evaso = 0)`, [norm(codice)]).n;
}

/** Altri codici dello stesso prodotto (equivalenti), con i loro prodotti liberi. */
export function codiciSimili(db, codice) {
  const altri = all(db, `SELECT c2.codice, c2.nome FROM codici c1
      JOIN codici c2 ON c2.prodotto_id = c1.prodotto_id AND c2.codice <> c1.codice
      WHERE c1.codice = ? ORDER BY c2.codice`, [norm(codice)]);
  return altri
    .map((c) => ({ ...c, prodotti: prodottiDisponibili(db, c.codice) }))
    .filter((c) => c.prodotti.length > 0);
}

/**
 * Disponibilità per la scelta del collegamento: stesso codice e codici simili.
 * Non decide nulla: l'utente sceglie quale collegare.
 */
export function disponibilita(db, codice) {
  const stesso = prodottiDisponibili(db, codice);
  const simili = codiciSimili(db, codice);
  return {
    codice: norm(codice),
    stessoCodice: stesso,
    simili,
    nStesso: stesso.length,
    nSimili: simili.reduce((n, c) => n + c.prodotti.length, 0),
    nImpegnati: contaImpegnati(db, codice),
  };
}

const escLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Suggerimenti per i campi "codice o nome". */
export function cercaCodici(db, testo, limite = 8) {
  const t = norm(testo);
  if (!t) return [];
  const like = `%${escLike(t)}%`;
  return all(db, `SELECT c.codice, c.nome,
      (SELECT COUNT(*) FROM magazzino m WHERE m.codice = c.codice AND m.in_magazzino = 1) AS in_magazzino
    FROM codici c
    WHERE c.codice LIKE ? ESCAPE '\\' OR c.nome LIKE ? ESCAPE '\\'
    ORDER BY (c.codice = ?) DESC, (c.codice LIKE ? ESCAPE '\\') DESC, c.nome
    LIMIT ?`, [like, like, t, `${escLike(t)}%`, limite]);
}

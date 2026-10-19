// Codici prodotto e prodotti equivalenti ("simili").
import { all, get, run } from '../db/util.js';
import { norm, chiaveEquivalenza, parole, compatta } from '../db/normalizza.js';
import { richiedi } from './errori.js';

/** Restituisce il codice; se è nuovo lo crea e lo mette nel gruppo di equivalenza giusto. */
export function assicuraCodice(db, codice, nome) {
  const cod = norm(codice);
  const nm = norm(nome);
  richiedi(cod, 'Serve il codice del prodotto.');
  const esistente = get(db, 'SELECT * FROM codici WHERE codice = ?', [cod])
    // "25 689" o "25-689" sono il codice 25689
    ?? all(db, 'SELECT * FROM codici').find((c) => compatta(c.codice) === compatta(cod));
  if (esistente) return esistente;
  richiedi(nm, 'Serve il nome del prodotto.');
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

/**
 * Suggerimenti per i campi "codice" e "nome". Si confrontano le parole senza badare a
 * maiuscole, accenti, punteggiatura e spazi. `campo`: 'codice' cerca solo nei codici,
 * 'nome' solo nei nomi, altrimenti in entrambi. Ogni risultato è un codice col suo nome:
 * scelto uno, si compilano entrambi i campi.
 */
export function cercaCodici(db, testo, limite = 8, campo = null) {
  const w = parole(testo);
  if (!w.length) return [];
  const k = compatta(testo);
  const righe = all(db, `SELECT c.codice, c.nome,
      (SELECT COUNT(*) FROM magazzino m WHERE m.codice = c.codice AND m.in_magazzino = 1) AS in_magazzino,
      (SELECT r.prezzo FROM righe_ordine r WHERE r.codice = c.codice AND r.omaggio = 0 ORDER BY r.id DESC LIMIT 1) AS ultimo_prezzo
    FROM codici c`);
  const out = [];
  for (const r of righe) {
    const kc = compatta(r.codice);
    const wn = parole(r.nome);
    const inCodice = kc.includes(k);
    const inNome = w.every((x) => wn.some((y) => y.includes(x)));
    if (campo === 'codice' ? !inCodice : campo === 'nome' ? !inNome : !(inCodice || inNome)) continue;
    let p;
    if (campo === 'nome') p = compatta(r.nome) === k ? 0 : wn[0]?.startsWith(w[0]) ? 1 : 2;
    else p = kc === k ? 0 : kc.startsWith(k) ? 1 : inCodice ? 2 : 3;
    out.push({ ...r, _p: p });
  }
  return out
    .sort((a, b) => a._p - b._p || b.in_magazzino - a.in_magazzino || a.nome.localeCompare(b.nome, 'it') || a.codice.localeCompare(b.codice))
    .slice(0, limite)
    .map(({ _p, ...r }) => r);
}

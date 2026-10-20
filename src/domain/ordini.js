// Ordini cliente (V) e fornitore (A): creazione, righe, collegamento ai prodotti, consegna.
import { all, get, run, scalar, transaction } from '../db/util.js';
import { norm } from '../db/normalizza.js';
import { ErroreDominio, richiedi } from './errori.js';
import { assicuraCodice, disponibilita } from './codici.js';
import { assicuraContatto } from './contatti.js';
import { leggiPrezzo } from './numeri.js';

const arrotonda = (n) => Math.round(n * 100) / 100;

function ordineAperto(db, id) {
  const o = get(db, 'SELECT * FROM ordini WHERE id = ?', [id]);
  richiedi(o, 'Ordine non trovato.');
  richiedi(!o.evaso, `L’ordine #${id} è già chiuso e non si può modificare.`);
  return o;
}

export function creaOrdine(db, { tipo, contatto, data, catalogo = '', note = '' }) {
  richiedi(tipo === 'V' || tipo === 'A', 'Scegli se è un ordine cliente o fornitore.');
  richiedi(/^\d{4}-\d{2}-\d{2}$/.test(data ?? ''), 'La data dell’ordine non è valida.');
  const c = assicuraContatto(db, contatto, tipo === 'A' ? 'F' : 'C');
  const id = (scalar(db, 'SELECT MAX(id) FROM ordini') ?? 0) + 1;
  run(db, `INSERT INTO ordini(id, tipo, data_emissione, contatto_id, catalogo, note) VALUES (?,?,?,?,?,?)`,
    [id, tipo, data, c.id, norm(catalogo).toUpperCase(), norm(note)]);
  return id;
}

export function modificaOrdine(db, id, { contatto, data, catalogo, note }) {
  const o = ordineAperto(db, id);
  const c = assicuraContatto(db, contatto ?? get(db, 'SELECT nome FROM contatti WHERE id = ?', [o.contatto_id]).nome,
    o.tipo === 'A' ? 'F' : 'C');
  run(db, 'UPDATE ordini SET contatto_id = ?, data_emissione = ?, catalogo = ?, note = ? WHERE id = ?',
    [c.id, data ?? o.data_emissione, norm(catalogo ?? o.catalogo).toUpperCase(), norm(note ?? o.note), id]);
}

/** Un ordine aperto si può eliminare (e libera i prodotti collegati). */
export function eliminaOrdine(db, id) {
  ordineAperto(db, id);
  transaction(db, () => {
    run(db, 'DELETE FROM righe_ordine WHERE ordine_id = ?', [id]);
    run(db, 'DELETE FROM ordini WHERE id = ?', [id]);
  });
}

/** Aggiunge N righe (una per prodotto richiesto). */
export function aggiungiRighe(db, ordineId, { codice, nome, prezzo, quantita = 1 }) {
  const o = ordineAperto(db, ordineId);
  const q = Number(quantita);
  richiedi(Number.isInteger(q) && q >= 1 && q <= 200, 'La quantità deve essere un numero da 1 a 200.');
  const p = leggiPrezzo(prezzo);
  richiedi(p !== null && Number.isFinite(p) && p >= 0, 'Inserisci il prezzo del prodotto.');
  const cod = assicuraCodice(db, codice, nome);
  const ids = [];
  transaction(db, () => {
    for (let i = 0; i < q; i++) {
      ids.push(run(db, 'INSERT INTO righe_ordine(ordine_id, codice, nome, prezzo) VALUES (?,?,?,?)',
        [o.id, cod.codice, norm(nome) || cod.nome, p]).lastId);
    }
  });
  return ids;
}

export function eliminaRiga(db, rigaId) {
  const r = get(db, 'SELECT * FROM righe_ordine WHERE id = ?', [rigaId]);
  richiedi(r, 'Riga non trovata.');
  ordineAperto(db, r.ordine_id);
  run(db, 'DELETE FROM righe_ordine WHERE id = ?', [rigaId]);
}

/**
 * Collega a mano una riga d'ordine cliente a un prodotto in magazzino.
 * Il prodotto può avere lo stesso codice o un codice equivalente: lo sceglie l'utente.
 */
export function collegaRiga(db, rigaId, magazzinoId) {
  const r = get(db, 'SELECT * FROM righe_ordine WHERE id = ?', [rigaId]);
  richiedi(r, 'Riga non trovata.');
  const o = ordineAperto(db, r.ordine_id);
  richiedi(o.tipo === 'V', 'Solo le righe di un ordine cliente si collegano al magazzino.');
  const m = get(db, 'SELECT * FROM magazzino WHERE id = ?', [magazzinoId]);
  richiedi(m && m.in_magazzino, 'Il prodotto scelto non è più in magazzino.');
  const altro = get(db, `SELECT r2.ordine_id FROM righe_ordine r2 JOIN ordini o2 ON o2.id = r2.ordine_id
    WHERE r2.magazzino_id = ? AND o2.evaso = 0 AND r2.id <> ?`, [magazzinoId, rigaId]);
  if (altro) throw new ErroreDominio(`Quel prodotto è già assegnato all’ordine #${altro.ordine_id}.`);
  const disp = disponibilita(db, r.codice);
  const ammessi = new Set([
    ...disp.stessoCodice.map((p) => p.id),
    ...disp.simili.flatMap((c) => c.prodotti.map((p) => p.id)),
  ]);
  // la riga può essere già collegata a questo stesso prodotto
  richiedi(ammessi.has(magazzinoId) || r.magazzino_id === magazzinoId,
    'Il prodotto scelto non ha lo stesso codice né un codice simile.');
  run(db, 'UPDATE righe_ordine SET magazzino_id = ? WHERE id = ?', [magazzinoId, rigaId]);
}

export function scollegaRiga(db, rigaId) {
  const r = get(db, 'SELECT * FROM righe_ordine WHERE id = ?', [rigaId]);
  richiedi(r, 'Riga non trovata.');
  ordineAperto(db, r.ordine_id);
  run(db, 'UPDATE righe_ordine SET magazzino_id = NULL WHERE id = ?', [rigaId]);
}

/** Chiude un ordine cliente: i prodotti collegati escono dal magazzino. */
export function consegnaOrdine(db, ordineId, data) {
  const o = ordineAperto(db, ordineId);
  richiedi(o.tipo === 'V', 'Questo è un ordine fornitore: si chiude dalla ricezione.');
  const righe = all(db, 'SELECT * FROM righe_ordine WHERE ordine_id = ? ORDER BY id', [ordineId]);
  richiedi(righe.length > 0, 'L’ordine è vuoto.');
  const scollegate = righe.filter((r) => !r.magazzino_id);
  if (scollegate.length) {
    throw new ErroreDominio(`${scollegate.length} prodotti non sono collegati al magazzino: collegali o eliminali.`);
  }
  let totale = 0;
  transaction(db, () => {
    for (const r of righe) {
      totale += r.prezzo;
      const n = run(db, `UPDATE magazzino SET in_magazzino = 0, ordine_out = ?, prezzo_out = ?, data_uscita = ?,
          motivo_out = NULL WHERE id = ? AND in_magazzino = 1`, [ordineId, r.prezzo, data, r.magazzino_id]).changes;
      if (!n) throw new ErroreDominio('Un prodotto collegato non è più in magazzino: ricollegalo.');
    }
    run(db, 'UPDATE ordini SET evaso = 1, data_evasione = ?, totale = ? WHERE id = ?',
      [data, arrotonda(totale), ordineId]);
  });
  return arrotonda(totale);
}

/** Elenco con i dati per le etichette ("2 pronte", "10 da ordinare", ...). */
export function elencoOrdini(db, { tipi = ['V', 'A'], conEvasi = false, testo = '', contattoId = null } = {}) {
  const cond = [`o.tipo IN (${tipi.map(() => '?').join(',')})`];
  const params = [...tipi];
  if (contattoId !== null) { cond.push('o.contatto_id = ?'); params.push(contattoId); }
  if (!conEvasi) cond.push('o.evaso = 0');
  const t = norm(testo);
  if (t) {
    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    cond.push("(CAST(o.id AS TEXT) LIKE ? ESCAPE '\\' OR c.nome LIKE ? ESCAPE '\\' OR o.catalogo LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const ordini = all(db, `SELECT o.*, c.nome AS contatto
    FROM ordini o JOIN contatti c ON c.id = o.contatto_id
    WHERE ${cond.join(' AND ')} ORDER BY o.evaso, o.id DESC`, params);
  const disp = new Map(all(db, `SELECT m.codice, COUNT(*) AS n FROM magazzino m
    WHERE m.in_magazzino = 1 AND NOT EXISTS (SELECT 1 FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
      WHERE r.magazzino_id = m.id AND o.evaso = 0) GROUP BY m.codice`).map((r) => [r.codice, r.n]));
  return ordini.map((o) => {
    const righe = all(db, 'SELECT codice, prezzo, magazzino_id, ricevuta FROM righe_ordine WHERE ordine_id = ?', [o.id]);
    const out = {
      ...o, nRighe: righe.length,
      totaleCorrente: o.evaso ? o.totale : arrotonda(righe.reduce((s, r) => s + r.prezzo, 0)),
    };
    if (o.tipo === 'V') {
      const perCodice = new Map();
      for (const r of righe) if (!r.magazzino_id) perCodice.set(r.codice, (perCodice.get(r.codice) ?? 0) + 1);
      out.collegate = righe.filter((r) => r.magazzino_id).length;
      out.disponibili = 0;
      out.daOrdinare = 0;
      for (const [cod, need] of perCodice) {
        const av = disp.get(cod) ?? 0;
        out.disponibili += Math.min(need, av);
        out.daOrdinare += Math.max(0, need - av);
      }
    } else {
      out.ricevute = righe.filter((r) => r.ricevuta).length;
    }
    return out;
  });
}

/** Dettaglio completo per la schermata dell'ordine. */
export function dettaglioOrdine(db, id) {
  const o = get(db, `SELECT o.*, c.nome AS contatto FROM ordini o JOIN contatti c ON c.id = o.contatto_id WHERE o.id = ?`, [id]);
  richiedi(o, 'Ordine non trovato.');
  const righe = all(db, `SELECT r.*, m.posizione_id, p.nome AS posizione, m.data_acquisto AS collegato_data,
      m.prezzo_acquisto AS collegato_prezzo, m.codice AS collegato_codice
    FROM righe_ordine r LEFT JOIN magazzino m ON m.id = r.magazzino_id LEFT JOIN posizioni p ON p.id = m.posizione_id
    WHERE r.ordine_id = ? ORDER BY r.id`, [id]);
  const cache = new Map();
  const dispDi = (codice) => {
    if (!cache.has(codice)) {
      const d = disponibilita(db, codice);
      cache.set(codice, { nStesso: d.nStesso, nSimili: d.nSimili, nImpegnati: d.nImpegnati });
    }
    return cache.get(codice);
  };
  const righeOut = righe.map((r) => ({
    ...r,
    disp: o.tipo === 'V' && !o.evaso && !r.magazzino_id ? dispDi(r.codice) : null,
  }));
  const totale = o.evaso ? o.totale : arrotonda(righe.reduce((s, r) => s + r.prezzo, 0));
  const gruppi = [];
  if (o.tipo === 'A') {
    const perChiave = new Map();
    for (const r of righe) {
      const k = `${r.codice}|${r.omaggio}`;
      if (!perChiave.has(k)) {
        const g = { codice: r.codice, nome: r.nome, prezzo: r.prezzo, omaggio: !!r.omaggio, quantita: 0, ricevute: 0, righe: [] };
        perChiave.set(k, g);
        gruppi.push(g);
      }
      const g = perChiave.get(k);
      g.quantita++;
      g.ricevute += r.ricevuta ? 1 : 0;
      g.righe.push(r.id);
    }
  }
  return {
    ordine: o, righe: righeOut, gruppi, totale,
    puoConsegnare: o.tipo === 'V' && !o.evaso && righe.length > 0 && righe.every((r) => r.magazzino_id),
    nDaCollegare: righe.filter((r) => !r.magazzino_id).length,
  };
}

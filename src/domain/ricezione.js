// Ordine fornitore: ricezione (anche parziale, con omaggi) e autocompilazione.
import { all, get, run, scalar, transaction } from '../db/util.js';
import { norm } from '../db/normalizza.js';
import { ErroreDominio, richiedi } from './errori.js';
import { assicuraCodice, codiciSimili, prodottiDisponibili } from './codici.js';
import { idDaCollocare } from './posizioni.js';
import { aggiungiRighe } from './ordini.js';

const arrotonda = (n) => Math.round(n * 100) / 100;

function ordineFornitoreAperto(db, id) {
  const o = get(db, 'SELECT * FROM ordini WHERE id = ?', [id]);
  richiedi(o, 'Ordine non trovato.');
  richiedi(o.tipo === 'A', 'Questa funzione vale solo per gli ordini fornitore.');
  richiedi(!o.evaso, `L’ordine #${id} è già chiuso.`);
  return o;
}

/**
 * Imposta quanti prodotti di quel codice sono arrivati (ricezione parziale).
 * Le righe in eccesso restano "non arrivate" e verranno stralciate alla chiusura.
 */
export function impostaQuantitaRicevuta(db, ordineId, codice, quantita, { omaggio = false } = {}) {
  ordineFornitoreAperto(db, ordineId);
  const righe = all(db, `SELECT id FROM righe_ordine WHERE ordine_id = ? AND codice = ? AND omaggio = ? ORDER BY id`,
    [ordineId, norm(codice), omaggio ? 1 : 0]);
  richiedi(righe.length > 0, 'Prodotto non presente nell’ordine.');
  const q = Number(quantita);
  richiedi(Number.isInteger(q) && q >= 0 && q <= righe.length, `La quantità arrivata va da 0 a ${righe.length}.`);
  transaction(db, () => {
    righe.forEach((r, i) => run(db, 'UPDATE righe_ordine SET ricevuta = ? WHERE id = ?', [i < q ? 1 : 0, r.id]));
  });
}

/** Aggiunge in ricezione prodotti non ordinati (promozione, regalo del fornitore). */
export function aggiungiOmaggio(db, ordineId, { codice, nome, quantita = 1 }) {
  ordineFornitoreAperto(db, ordineId);
  const q = Number(quantita);
  richiedi(Number.isInteger(q) && q >= 1 && q <= 100, 'La quantità deve essere un numero da 1 a 100.');
  const cod = assicuraCodice(db, codice, nome);
  transaction(db, () => {
    for (let i = 0; i < q; i++) {
      run(db, `INSERT INTO righe_ordine(ordine_id, codice, nome, prezzo, ricevuta, omaggio) VALUES (?,?,?,0,1,1)`,
        [ordineId, cod.codice, norm(nome) || cod.nome]);
    }
  });
}

/**
 * Chiude la ricezione: i prodotti arrivati entrano in magazzino in "Da collocare"
 * con la data di oggi, quelli non arrivati vengono stralciati dall'ordine.
 */
export function chiudiRicezione(db, ordineId, data) {
  const o = ordineFornitoreAperto(db, ordineId);
  const righe = all(db, 'SELECT * FROM righe_ordine WHERE ordine_id = ? ORDER BY id', [ordineId]);
  const arrivate = righe.filter((r) => r.ricevuta);
  const mancanti = righe.filter((r) => !r.ricevuta);
  if (!arrivate.length) {
    throw new ErroreDominio('Nessun prodotto risulta arrivato. Se l’ordine non è arrivato, eliminalo.');
  }
  const posId = idDaCollocare(db);
  let totale = 0;
  transaction(db, () => {
    for (const r of arrivate) {
      totale += r.prezzo;
      run(db, `INSERT INTO magazzino(codice, nome, posizione_id, data_acquisto, prezzo_acquisto, catalogo_acquisto, ordine_in)
        VALUES (?,?,?,?,?,?,?)`, [r.codice, r.nome, posId, data, r.prezzo, o.catalogo, ordineId]);
    }
    let note = o.note;
    if (mancanti.length) {
      const perNome = new Map();
      for (const r of mancanti) perNome.set(r.nome, (perNome.get(r.nome) ?? 0) + 1);
      const elenco = [...perNome].map(([n, q]) => `${q} × ${n}`).join(', ');
      note = norm(`${note} Non arrivati: ${elenco}.`);
      run(db, 'DELETE FROM righe_ordine WHERE ordine_id = ? AND ricevuta = 0', [ordineId]);
    }
    run(db, 'UPDATE ordini SET evaso = 1, data_evasione = ?, totale = ?, note = ? WHERE id = ?',
      [data, arrotonda(totale), note, ordineId]);
  });
  return { arrivati: arrivate.length, stralciati: mancanti.length, totale: arrotonda(totale) };
}

/**
 * Proposta di autocompilazione: per ogni codice richiesto dagli ordini cliente aperti
 * e non collegato, quanti ne mancano rispetto al magazzino e a quanto è già in ordine
 * ai fornitori. NON modifica nulla: i codici simili con pezzi liberi vengono solo segnalati.
 */
export function proposteAutocompila(db, ordineId) {
  const o = ordineFornitoreAperto(db, ordineId);
  const richieste = all(db, `SELECT r.id, r.codice, r.nome, r.prezzo, r.ordine_id, ord.catalogo
    FROM righe_ordine r JOIN ordini ord ON ord.id = r.ordine_id
    WHERE ord.tipo = 'V' AND ord.evaso = 0 AND r.magazzino_id IS NULL ORDER BY r.id`);
  const perCodice = new Map();
  for (const r of richieste) {
    if (!perCodice.has(r.codice)) perCodice.set(r.codice, { codice: r.codice, righe: [] });
    perCodice.get(r.codice).righe.push(r);
  }
  const proposte = [];
  for (const { codice, righe } of perCodice.values()) {
    const richiesti = righe.length;
    const liberi = prodottiDisponibili(db, codice).length;
    const giaOrdinati = scalar(db, `SELECT COUNT(*) FROM righe_ordine r JOIN ordini ord ON ord.id = r.ordine_id
      WHERE ord.tipo = 'A' AND ord.evaso = 0 AND r.codice = ? AND r.omaggio = 0`, [codice]);
    const mancanti = richiesti - liberi - giaOrdinati;
    if (mancanti <= 0) continue;
    const ultima = righe[righe.length - 1];
    const cataloghi = [...new Set(righe.map((r) => r.catalogo).filter(Boolean))];
    const simili = codiciSimili(db, codice);
    proposte.push({
      codice, nome: ultima.nome, prezzo: ultima.prezzo,
      richiesti, liberi, giaOrdinati, mancanti,
      ordiniCliente: [...new Set(righe.map((r) => r.ordine_id))],
      cataloghi,
      cataloghiDiversi: cataloghi.some((c) => c !== o.catalogo),
      simili: simili.map((c) => ({ codice: c.codice, nome: c.nome, disponibili: c.prodotti.length })),
    });
  }
  return proposte.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

/** Aggiunge all'ordine fornitore le quantità confermate dall'utente. */
export function applicaAutocompila(db, ordineId, scelte) {
  ordineFornitoreAperto(db, ordineId);
  const proposte = new Map(proposteAutocompila(db, ordineId).map((p) => [p.codice, p]));
  let aggiunte = 0;
  transaction(db, () => {
    for (const s of scelte) {
      const q = Number(s.quantita);
      if (!q) continue;
      const p = proposte.get(s.codice);
      richiedi(p, `Il codice ${s.codice} non risulta più mancante.`);
      aggiungiRighe(db, ordineId, { codice: p.codice, nome: p.nome, prezzo: p.prezzo, quantita: q });
      aggiunte += q;
    }
  });
  return aggiunte;
}

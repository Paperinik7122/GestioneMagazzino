import { all, get, run } from '../db/util.js';
import { norm, parole, compatta, distanza } from '../db/normalizza.js';
import { richiedi } from './errori.js';

/** Il contatto con questo nome, anche se scritto con spazi, punteggiatura o accenti diversi. */
export function trovaContatto(db, nome) {
  const n = norm(nome);
  if (!n) return undefined;
  const c = get(db, 'SELECT * FROM contatti WHERE nome = ? COLLATE NOCASE', [n]);
  if (c) return c;
  const k = compatta(n);
  return k ? all(db, 'SELECT * FROM contatti').find((x) => compatta(x.nome) === k) : undefined;
}

/** Trova il contatto (senza badare a maiuscole/spazi) o lo crea. */
export function assicuraContatto(db, nome, tipo = 'C') {
  const n = norm(nome);
  richiedi(n, 'Scrivi il nome del contatto.');
  const c = trovaContatto(db, n);
  if (c) return c;
  const id = run(db, 'INSERT INTO contatti(nome, tipo) VALUES (?, ?)', [n, tipo === 'F' ? 'F' : 'C']).lastId;
  return get(db, 'SELECT * FROM contatti WHERE id = ?', [id]);
}

export function elencoContatti(db, tipo = null) {
  return all(db, `SELECT c.*, (SELECT COUNT(*) FROM ordini o WHERE o.contatto_id = c.id) AS n_ordini
    FROM contatti c ${tipo ? 'WHERE c.tipo = ?' : ''} ORDER BY c.nome COLLATE NOCASE`, tipo ? [tipo] : []);
}

/** Suggerimenti mentre si scrive: tutte le parole digitate devono comparire nel nome. */
export function cercaContatti(db, testo, tipo = null, limite = 8) {
  const w = parole(testo);
  if (!w.length) return [];
  const k = compatta(testo);
  return elencoContatti(db, tipo)
    .map((c) => ({ c, nome: parole(c.nome) }))
    .filter(({ nome }) => w.every((x) => nome.some((y) => y.includes(x))))
    .map(({ c, nome }) => ({
      ...c,
      _p: (compatta(c.nome) === k ? 0 : compatta(c.nome).startsWith(k) ? 1 : nome[0]?.startsWith(w[0]) ? 2 : 3),
    }))
    .sort((a, b) => a._p - b._p || a.nome.localeCompare(b.nome, 'it'))
    .slice(0, limite)
    .map(({ _p, ...c }) => c);
}

/**
 * Contatti che potrebbero essere la stessa persona di un nome appena scritto
 * (refusi, parti del nome, parole in più). Non include chi ha già lo stesso nome.
 */
export function contattiSimili(db, nome, { tipo = null, escludiId = null } = {}) {
  const k = compatta(nome);
  const w = parole(nome);
  if (k.length < 3) return [];
  return elencoContatti(db, tipo).filter((c) => {
    if (c.id === escludiId) return false;
    const kc = compatta(c.nome);
    if (kc === k) return false;
    if (distanza(k, kc) <= (k.length >= 8 ? 2 : 1)) return true;
    const wc = parole(c.nome);
    // "Paola" vs "Paola Rossi": tutte le parole di uno sono nell'altro
    return w.length && wc.length && (w.every((x) => wc.includes(x)) || wc.every((x) => w.includes(x)));
  });
}

/** Unisce due contatti (es. "paola" e "paola suocera"): gli ordini passano al primo. */
export function unisciContatti(db, tieniId, eliminaId) {
  richiedi(tieniId !== eliminaId, 'Scegli due contatti diversi.');
  run(db, 'UPDATE ordini SET contatto_id = ? WHERE contatto_id = ?', [tieniId, eliminaId]);
  run(db, 'DELETE FROM contatti WHERE id = ?', [eliminaId]);
}

/** Modifica anagrafica di un contatto (il nome resta unico, senza badare alle maiuscole). */
export function salvaContatto(db, id, { nome, tipo, telefono = '', indirizzo = '', email = '', note = '' }) {
  const c = get(db, 'SELECT * FROM contatti WHERE id = ?', [id]);
  richiedi(c, 'Contatto non trovato.');
  const n = norm(nome);
  richiedi(n, 'Scrivi il nome del contatto.');
  richiedi(tipo === 'C' || tipo === 'F', 'Scegli se è un cliente o un fornitore.');
  const k = compatta(n);
  const doppio = all(db, 'SELECT id, nome FROM contatti WHERE id <> ?', [id]).find((x) => compatta(x.nome) === k);
  richiedi(!doppio, 'Esiste già un contatto con questo nome: usa “Unisci” se sono la stessa persona.');
  run(db, 'UPDATE contatti SET nome = ?, tipo = ?, telefono = ?, indirizzo = ?, email = ?, note = ? WHERE id = ?',
    [n, tipo, norm(telefono), norm(indirizzo), norm(email), norm(note), id]);
}

/** Si può eliminare solo un contatto senza ordini. */
export function eliminaContatto(db, id) {
  const n = get(db, 'SELECT COUNT(*) AS n FROM ordini WHERE contatto_id = ?', [id]).n;
  richiedi(n === 0, `Il contatto ha ${n} ordini: non si può eliminare (puoi unirlo a un altro).`);
  run(db, 'DELETE FROM contatti WHERE id = ?', [id]);
}

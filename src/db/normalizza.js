// Normalizzazioni condivise da migrazione e logica dell'app.

/** Spazi multipli -> uno solo, niente spazi ai bordi. */
export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Chiave per confrontare scritture che differiscono solo per maiuscole/spazi. */
export const chiave = (s) => norm(s).toLowerCase();

const PAROLE_IGNORATE = new Set(['nuovo', 'nuova', 'nuovi', 'nuove', 'new', 'n']);

/**
 * Chiave di equivalenza tra nomi di prodotto: ignora maiuscole, accenti,
 * punteggiatura, la parola "nuovo" e lo spazio tra numero e unità
 * ("1000 ml" = "1000ml"). Serve solo a PROPORRE prodotti simili: la scelta
 * finale resta sempre all'utente.
 */
export function chiaveEquivalenza(nome) {
  const t = norm(nome)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d)\s+(ml|cl|l|g|gr|kg|pz)\b/g, '$1$2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return t.split(' ').filter((w) => w && !PAROLE_IGNORATE.has(w)).join(' ');
}

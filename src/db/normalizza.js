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

const senzaAccenti = (s) => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Parole di una ricerca: minuscole, senza accenti né punteggiatura ("Paola  R." -> ["paola", "r"]). */
export const parole = (s) => senzaAccenti(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Chiave "compatta" per riconoscere la stessa cosa scritta in modo diverso:
 * "Paola Rossi", "paola  rossi.", "PAOLA-ROSSI" e "25 689"/"25689" danno la stessa chiave.
 */
export const compatta = (s) => parole(s).join('');

/** Distanza di modifica (quanti caratteri cambiare per passare da a a b). */
export function distanza(a, b) {
  if (a === b) return 0;
  let prec = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prec[j] + 1, cur[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prec = cur;
  }
  return prec[b.length];
}

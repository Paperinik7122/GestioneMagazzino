// Sola lettura: quando non si può salvare sul server (offline, accesso in corso) i dati si possono guardare ma non cambiare.
import { ErroreDominio } from '../domain/errori.js';

/** Ogni scrittura (db.run) lancia un errore con un messaggio in italiano; in più SQLite stesso rifiuta di scrivere. */
export function bloccaScrittura(db, messaggio) {
  if (db.__bloccato) return;
  db.__bloccato = true;
  try { db.run('PRAGMA query_only = ON'); } catch { /* rete di sicurezza in più, non indispensabile */ }
  db.run = () => { throw new ErroreDominio(typeof messaggio === 'function' ? messaggio() : messaggio); };
}

export function sbloccaScrittura(db) {
  if (!db.__bloccato) return;
  delete db.run; // torna il metodo vero
  db.__bloccato = false;
  try { db.run('PRAGMA query_only = OFF'); } catch { /* ignora */ }
}

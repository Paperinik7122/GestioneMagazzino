/** Errore "previsto": il messaggio è in italiano ed è pensato per essere mostrato all'utente. */
export class ErroreDominio extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreDominio';
  }
}

export function richiedi(condizione, messaggio) {
  if (!condizione) throw new ErroreDominio(messaggio);
}

/** Data di oggi (fuso del dispositivo) come "AAAA-MM-GG". */
export function oggiIso(adesso = new Date()) {
  const a = adesso.getFullYear();
  const m = String(adesso.getMonth() + 1).padStart(2, '0');
  const g = String(adesso.getDate()).padStart(2, '0');
  return `${a}-${m}-${g}`;
}

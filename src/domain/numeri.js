/** Prezzo scritto dall'utente ("6,5" o "6.50") -> numero; null se vuoto; NaN se non valido. */
export function leggiPrezzo(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const t = String(v).replace(/[€\s]/g, '').replace(',', '.');
  return t === '' ? null : Number(t);
}

// Cosa fare quando questo dispositivo si collega al server. Funzione pura: si prova con dei numeri.

/**
 * cfg: { archivio, rev, sporco } ricordati da questo dispositivo
 * server: { archivio, revisione }
 * localeVuoto: i dati di questo dispositivo non hanno ordini, prodotti né contatti
 *
 * Restituisce { azione, motivo? } con azione in:
 *  'niente'       già allineati
 *  'inizia-vuoto' server e dispositivo sono vuoti: si parte
 *  'scarica'      si prendono i dati del server (non si perde nulla di locale)
 *  'carica'       si inviano al server i dati di questo dispositivo
 *  'scegli'       i dati sono diversi da entrambe le parti: decide l'utente
 */
export function decidiConnessione({ cfg, server, localeVuoto }) {
  const collegato = !!cfg.archivio && cfg.archivio === server.archivio;
  // Dati locali spariti (es. pulizia del browser) ma il server li ha: si riprendono da lì.
  if (localeVuoto && server.revisione > 0) return { azione: 'scarica' };
  if (!collegato) {
    if (server.revisione === 0) return { azione: localeVuoto ? 'inizia-vuoto' : 'carica' };
    return { azione: 'scegli', motivo: 'primo-collegamento' };
  }
  if (server.revisione === cfg.rev) return { azione: cfg.sporco ? 'carica' : 'niente' };
  if (server.revisione > cfg.rev) return cfg.sporco ? { azione: 'scegli', motivo: 'modificati' } : { azione: 'scarica' };
  return { azione: 'scegli', motivo: 'server-indietro' };
}

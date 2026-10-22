// Cosa ricorda questo dispositivo del collegamento con il server (codice, ultima revisione, modifiche da inviare).
const CHIAVE = 'magazzino.sync';
const VUOTA = { codice: '', archivio: '', rev: 0, sporco: false, serverNoto: false, quando: null };

export function creaConfig(storage = globalThis.localStorage) {
  return {
    leggi() {
      try { return { ...VUOTA, ...JSON.parse(storage.getItem(CHIAVE) ?? '{}') }; } catch { return { ...VUOTA }; }
    },
    scrivi(cfg) {
      try { storage.setItem(CHIAVE, JSON.stringify(cfg)); } catch { /* ignora: senza memoria si riparte da "primo collegamento" */ }
    },
  };
}

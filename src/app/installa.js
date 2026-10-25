// Installazione dell'app sul dispositivo (Chrome/Android) e diagnostica: perché Chrome la propone o no.
let proposta = null; // evento beforeinstallprompt: c'è solo se Chrome considera l'app installabile
const ascoltatori = new Set();

export function iniziaAscoltoInstallazione() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    proposta = e;
    ascoltatori.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => { proposta = null; ascoltatori.forEach((f) => f()); });
}

export const suInstallazione = (f) => { ascoltatori.add(f); return () => ascoltatori.delete(f); };
export const puoInstallare = () => !!proposta;
export const inModalitaApp = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export async function installa() {
  if (!proposta) return null;
  proposta.prompt();
  const { outcome } = await proposta.userChoice;
  proposta = null;
  return outcome; // 'accepted' | 'dismissed'
}

/** Elenco di controlli { ok, titolo, dettaglio } sulle condizioni richieste da Chrome per installare l'app. */
export async function diagnostica() {
  const r = [];
  const aggiungi = (ok, titolo, dettaglio = '') => r.push({ ok, titolo, dettaglio });
  aggiungi(window.isSecureContext, 'Connessione sicura (HTTPS valido)',
    window.isSecureContext ? location.origin : `Chrome non considera sicuro ${location.origin}: senza questo non si installa e il service worker non parte`);
  aggiungi(inModalitaApp(), 'Aperta come app (a schermo intero)', inModalitaApp() ? '' : 'Ora è aperta in una scheda del browser');

  let reg = null;
  try { reg = await navigator.serviceWorker?.getRegistration(); } catch { /* ignora */ }
  aggiungi(!!reg?.active, 'Service worker attivo', reg ? `${reg.active ? 'attivo' : 'non ancora attivo'} · ambito ${reg.scope}` : 'non registrato');
  aggiungi(!!navigator.serviceWorker?.controller, 'Pagina controllata dal service worker', navigator.serviceWorker?.controller ? '' : 'Ricarica la pagina una volta');

  const link = document.querySelector('link[rel="manifest"]')?.href;
  let m = null;
  if (!link) aggiungi(false, 'Manifest collegato', 'manca nella pagina');
  else {
    try {
      const resp = await fetch(link, { cache: 'no-store' });
      const tipo = resp.headers.get('content-type') ?? '';
      m = resp.ok ? await resp.json() : null;
      aggiungi(!!m, 'Manifest raggiungibile', `${resp.status} · ${tipo || 'tipo non indicato'}`);
    } catch (e) { aggiungi(false, 'Manifest raggiungibile', String(e.message ?? e)); }
  }
  if (m) {
    aggiungi(m.display === 'standalone' || m.display === 'fullscreen', 'Schermo intero nel manifest', `display: ${m.display}`);
    for (const dim of ['192x192', '512x512']) {
      const ic = (m.icons ?? []).find((i) => i.sizes === dim && (!i.purpose || i.purpose.includes('any')));
      if (!ic) { aggiungi(false, `Icona ${dim}`, 'non dichiarata'); continue; }
      try {
        const resp = await fetch(new URL(ic.src, link), { cache: 'no-store' });
        aggiungi(resp.ok && (resp.headers.get('content-type') ?? '').startsWith('image/'), `Icona ${dim}`, `${resp.status} · ${resp.headers.get('content-type') ?? ''}`);
      } catch (e) { aggiungi(false, `Icona ${dim}`, String(e.message ?? e)); }
    }
  }
  aggiungi(puoInstallare() || inModalitaApp(), 'Chrome offre l’installazione',
    puoInstallare() ? 'sì: usa il pulsante “Installa app”' : inModalitaApp() ? 'già installata' : 'no (a volte compare dopo qualche secondo di uso)');
  return r;
}

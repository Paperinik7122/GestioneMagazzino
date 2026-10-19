// Avvio dell'app: database, barra in basso, router a indirizzi "#/...", service worker.
import { avvia, getDb, stato } from '../store.js';
import { elencoOrdini } from '../domain/ordini.js';
import { icona, esc } from '../ui/kit.js';
import { toast } from './ui.js';
import { home } from './viste/home.js';
import { ordini } from './viste/ordini.js';
import { ordine } from './viste/ordine.js';
import { contatti } from './viste/contatti.js';
import { magazzino } from './viste/magazzino.js';
import { codice } from './viste/codice.js';
import { nonTrovata } from './viste/segnaposto.js';

const SEZIONI = [
  ['home', '#/', 'home', 'Home'],
  ['ordini', '#/ordini', 'orders', 'Ordini'],
  ['magazzino', '#/magazzino', 'box', 'Magazzino'],
  ['contatti', '#/contatti', 'users', 'Contatti'],
];

const ROTTE = {
  '': ['home', home],
  ordini: ['ordini', ordini],
  ordine: ['ordini', ordine],
  magazzino: ['magazzino', magazzino],
  codice: ['magazzino', codice],
  contatti: ['contatti', contatti],
};

function barra(attiva) {
  const daOrdinare = elencoOrdini(getDb(), { tipi: ['V'] }).reduce((s, o) => s + o.daOrdinare, 0);
  document.getElementById('tabbar').innerHTML = SEZIONI.map(([k, href, ic, et]) => `
    <a class="tab" href="${href}" ${k === attiva ? 'aria-current="page"' : ''}>${icona(ic, 24, k === attiva ? 2.3 : 2)}<span>${et}</span>
    ${k === 'ordini' && daOrdinare ? `<span class="badge">${daOrdinare}</span>` : ''}</a>`).join('');
}

function disegna() {
  const vista = document.getElementById('vista');
  const [percorso, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [radice, ...resto] = percorso.split('/');
  const [sezione, funzione] = ROTTE[radice] ?? ['', nonTrovata];
  document.getElementById('strato').innerHTML = '';
  try {
    funzione(vista, new URLSearchParams(qs), ...resto);
  } catch (e) {
    console.error(e);
    vista.innerHTML = `<div class="vuoto"><b>Qualcosa non ha funzionato</b><span>${esc(e.message)}</span></div>`;
  }
  barra(sezione);
  if (!history.state?.mantieni) window.scrollTo(0, 0);
}

async function registraServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const avvisa = (sw) => toast('È disponibile una versione nuova', { azione: 'Aggiorna', ms: 15000, onAzione: () => sw.postMessage('attiva') });
    if (reg.waiting && navigator.serviceWorker.controller) avvisa(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) avvisa(sw); });
    });
    let ricaricato = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!ricaricato) { ricaricato = true; location.reload(); } });
  } catch (e) { console.warn('Service worker non attivo', e); }
}

async function avviaApp() {
  const vista = document.getElementById('vista');
  vista.innerHTML = '<div class="caricamento"><div><div class="spin"></div>Apro il magazzino…</div></div>';
  try {
    await avvia();
  } catch (e) {
    vista.innerHTML = `<div class="vuoto"><b>Non riesco ad aprire i dati</b><span>${esc(e.message)}</span></div>`;
    return;
  }
  window.addEventListener('hashchange', disegna);
  disegna();
  if (stato.volatile) toast('Attenzione: i dati non vengono salvati su questo dispositivo', { ms: 8000 });
  registraServiceWorker();
}

avviaApp();

// Foglio dal basso, avvisi (toast) e gestione degli errori.
import { esc } from '../ui/kit.js';
import { ErroreDominio } from '../domain/errori.js';

const $ = (id) => document.getElementById(id);

/** Apre un foglio con il contenuto dato. Restituisce { chiudi, radice }. */
export function apriFoglio(html) {
  const strato = $('strato');
  $('toast').classList.remove('su');
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.innerHTML = `<div class="foglio" role="dialog" aria-modal="true">${html}</div>`;
  const chiudi = () => { velo.remove(); };
  velo.addEventListener('click', (e) => { if (e.target === velo) chiudi(); });
  velo.querySelectorAll('[data-chiudi]').forEach((b) => b.addEventListener('click', chiudi));
  strato.appendChild(velo);
  const primo = velo.querySelector('[autofocus]');
  if (primo) primo.focus();
  return { chiudi, radice: velo.firstElementChild };
}

export const chiudiTutto = () => { $('strato').innerHTML = ''; };

let tToast = null;
export function toast(testo, { azione = null, onAzione = null, ms = 3500 } = {}) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(testo)}</span>${azione ? `<button type="button">${esc(azione)}</button>` : ''}`;
  el.querySelector('button')?.addEventListener('click', () => { el.classList.remove('su'); onAzione?.(); });
  el.classList.add('su');
  clearTimeout(tToast);
  tToast = setTimeout(() => el.classList.remove('su'), ms);
}

/** Mostra un errore previsto sotto il campo; gli altri errori sono guasti veri. */
export function mostraErrore(radice, e) {
  if (!(e instanceof ErroreDominio)) { console.error(e); toast('Qualcosa non ha funzionato. Riprova.'); return; }
  let box = radice.querySelector('.errore-campo');
  if (!box) {
    box = document.createElement('p');
    box.className = 'errore-campo';
    box.setAttribute('role', 'alert');
    radice.querySelector('.barra').before(box);
  }
  box.textContent = e.message;
}

/** Conferma semplice dentro un foglio. */
export function conferma({ titolo, testo, etichetta = 'Conferma', pericolo = false }) {
  return new Promise((resolve) => {
    const { chiudi, radice } = apriFoglio(`<h2>${esc(titolo)}</h2><p class="muted">${esc(testo)}</p>
      <div class="barra"><button class="btn sec" data-no>Annulla</button>
      <button class="btn ${pericolo ? 'peric' : ''}" data-si>${esc(etichetta)}</button></div>`);
    radice.querySelector('[data-no]').onclick = () => { chiudi(); resolve(false); };
    radice.querySelector('[data-si]').onclick = () => { chiudi(); resolve(true); };
  });
}

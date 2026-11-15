// Campo con suggerimenti (al posto del <datalist>, che sull'iPad funziona male).
import { esc } from '../ui/kit.js';

/**
 * Collega un <input> a un elenco di suggerimenti.
 * trova(testo) -> [{ titolo, sotto?, chip?, dati }]; alScelta(dati) si chiama quando l'utente tocca un suggerimento.
 * Il campo deve stare dentro un elemento con position: relative (.campo lo è).
 *
 * L'elenco sta sotto il campo, ma se lì non c'è abbastanza spazio visibile (tastiera aperta, pulsanti
 * del foglio) passa sopra il campo e si accorcia: così non finisce mai dietro la tastiera.
 */
export function combo(input, { trova, alScelta, minimo = 1 }) {
  const box = document.createElement('div');
  box.className = 'sugg';
  box.hidden = true;
  box.setAttribute('role', 'listbox');
  input.parentElement.appendChild(box);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  let voci = [];
  let sel = -1;
  const vv = window.visualViewport;
  const foglio = input.closest('.foglio');
  let ascolto = false;

  /** Mette l'elenco dove si vede: sotto il campo se c'è posto, altrimenti sopra. */
  const posiziona = () => {
    if (box.hidden) return;
    if (!input.isConnected) { smetti(); return; }
    const c = input.parentElement.getBoundingClientRect();
    const i = input.getBoundingClientRect();
    let basso = vv ? vv.offsetTop + vv.height : window.innerHeight; // il bordo visibile sopra la tastiera
    let alto = vv ? vv.offsetTop : 0;
    if (foglio) {
      const f = foglio.getBoundingClientRect();
      basso = Math.min(basso, f.bottom);
      alto = Math.max(alto, f.top);
      const barra = foglio.querySelector(':scope > .barra');
      if (barra) basso = Math.min(basso, barra.getBoundingClientRect().top + 16);
    }
    const sotto = basso - i.bottom - 6;
    const sopra = i.top - alto - 6;
    const su = sotto < 150 && sopra > sotto;
    box.style.maxHeight = `${Math.round(Math.max(96, Math.min(260, su ? sopra : sotto)))}px`;
    if (su) {
      box.style.top = 'auto';
      box.style.bottom = `${Math.round(c.bottom - i.top + 4)}px`;
    } else {
      box.style.top = '';
      box.style.bottom = '';
    }
  };
  const ascolta = () => {
    if (ascolto) return;
    ascolto = true;
    vv?.addEventListener('resize', posiziona);
    vv?.addEventListener('scroll', posiziona);
    window.addEventListener('resize', posiziona);
    foglio?.addEventListener('scroll', posiziona, { passive: true });
  };
  function smetti() {
    if (!ascolto) return;
    ascolto = false;
    vv?.removeEventListener('resize', posiziona);
    vv?.removeEventListener('scroll', posiziona);
    window.removeEventListener('resize', posiziona);
    foglio?.removeEventListener('scroll', posiziona);
  }

  const chiudi = () => { box.hidden = true; sel = -1; smetti(); };
  const scegli = (i) => {
    const v = voci[i];
    if (!v) return;
    chiudi();
    alScelta(v.dati);
  };
  const evidenzia = () => box.querySelectorAll('.voce').forEach((el, i) => el.classList.toggle('sel', i === sel));
  const apri = () => {
    const t = input.value.trim();
    voci = t.length >= minimo ? trova(input.value) : [];
    if (!voci.length) { chiudi(); return; }
    box.innerHTML = voci.map((v, i) => `<button type="button" class="voce" role="option" data-i="${i}">
      <span class="tit">${esc(v.titolo)}</span>${v.chip ? `<span class="ch">${esc(v.chip)}</span>` : ''}
      ${v.sotto ? `<span class="sot">${esc(v.sotto)}</span>` : ''}</button>`).join('');
    box.hidden = false;
    box.scrollTop = 0;
    sel = -1;
    posiziona();
    ascolta();
  };
  // pointerdown + preventDefault: il campo non perde il focus prima del tocco.
  // Si sceglie al rilascio e solo se il dito non si è mosso, così l'elenco si può anche scorrere.
  let giu = null;
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.voce');
    if (!b) return;
    e.preventDefault();
    giu = { i: Number(b.dataset.i), x: e.clientX, y: e.clientY };
  });
  box.addEventListener('pointerup', (e) => {
    const g = giu;
    giu = null;
    if (!g || Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) return;
    const b = e.target.closest('.voce');
    if (b && Number(b.dataset.i) === g.i) scegli(g.i);
  });
  box.addEventListener('pointercancel', () => { giu = null; });
  input.addEventListener('input', apri);
  input.addEventListener('focus', apri);
  input.addEventListener('blur', () => setTimeout(chiudi, 120));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { sel = Math.min(voci.length - 1, sel + 1); evidenzia(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); evidenzia(); e.preventDefault(); }
    else if (e.key === 'Enter' && sel >= 0) { scegli(sel); e.preventDefault(); }
    else if (e.key === 'Escape') { chiudi(); e.stopPropagation(); }
  });
  return { chiudi };
}

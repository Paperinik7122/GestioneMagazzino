// Campo con suggerimenti (al posto del <datalist>, che sull'iPad funziona male).
import { esc } from '../ui/kit.js';

/**
 * Collega un <input> a un elenco di suggerimenti.
 * trova(testo) -> [{ titolo, sotto?, chip?, dati }]; alScelta(dati) si chiama quando l'utente tocca un suggerimento.
 * Il campo deve stare dentro un elemento con position: relative (.campo lo è).
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

  const chiudi = () => { box.hidden = true; sel = -1; };
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
    sel = -1;
  };
  // pointerdown + preventDefault: il campo non perde il focus prima del tocco
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.voce');
    if (!b) return;
    e.preventDefault();
    scegli(Number(b.dataset.i));
  });
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

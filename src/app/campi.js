// Campi con suggerimenti condivisi: contatti (clienti/fornitori) e prodotti (codice + nome).
import { getDb } from '../store.js';
import { cercaContatti, contattiSimili, trovaContatto } from '../domain/contatti.js';
import { cercaCodici } from '../domain/codici.js';
import { norm } from '../db/normalizza.js';
import { esc, euro, num } from '../ui/kit.js';
import { combo } from './combo.js';
import { apriFoglio } from './ui.js';

/** Suggerisce i contatti già esistenti mentre si scrive il nome. tipo: 'C', 'F' o funzione che lo restituisce. */
export function comboContatto(input, tipo) {
  const t = () => (typeof tipo === 'function' ? tipo() : tipo);
  return combo(input, {
    trova: (testo) => cercaContatti(getDb(), testo, t()).map((c) => ({
      titolo: c.nome, chip: num(c.n_ordini, 'ordine', 'ordini'), dati: c.nome,
    })),
    alScelta: (nome) => { input.value = nome; },
  });
}

/**
 * Prima di creare un contatto nuovo: se il nome somiglia a uno esistente (refuso, solo il nome
 * di battesimo, parola in più) chiede all'utente. Restituisce il nome da usare, o null se annulla.
 */
export function chiediContatto(nome, tipo) {
  const db = getDb();
  const n = norm(nome);
  if (!n || trovaContatto(db, n)) return Promise.resolve(n);
  const simili = contattiSimili(db, n, { tipo });
  if (!simili.length) return Promise.resolve(n);
  return new Promise((resolve) => {
    const { chiudi, radice } = apriFoglio(`<h2>Intendevi uno di questi?</h2>
      <p class="muted piccolo" style="margin-bottom:12px">Hai scritto “${esc(n)}”, ma esistono contatti con un nome simile. Scegli quello giusto per non creare doppioni.</p>
      ${simili.map((c, i) => `<button class="simile" data-i="${i}">${esc(c.nome)}<small>${num(c.n_ordini, 'ordine', 'ordini')}${c.telefono ? ` · ${esc(c.telefono)}` : ''}</small></button>`).join('')}
      <button class="simile" data-nuovo>No, è un contatto nuovo<small>crea “${esc(n)}”</small></button>
      <div class="barra"><button class="btn sec" data-annulla>Annulla</button></div>`);
    radice.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { chiudi(); resolve(simili[Number(b.dataset.i)].nome); }; });
    radice.querySelector('[data-nuovo]').onclick = () => { chiudi(); resolve(n); };
    radice.querySelector('[data-annulla]').onclick = () => { chiudi(); resolve(null); };
  });
}

/**
 * Codice e nome del prodotto con suggerimenti incrociati: scrivendo il codice si propongono i codici
 * che contengono quelle cifre, scrivendo il nome i prodotti con quelle parole; scelto un suggerimento
 * si compilano codice, nome e (se c'è il campo vuoto) l'ultimo prezzo usato.
 */
export function comboProdotto(radice, { prezzo = true } = {}) {
  const cod = radice.querySelector('#f-cod');
  const nome = radice.querySelector('#f-nome');
  const pr = radice.querySelector('#f-prezzo');
  const q = radice.querySelector('#f-q');
  const voce = (campo) => (r) => ({
    titolo: campo === 'codice' ? r.codice : r.nome,
    sotto: `${campo === 'codice' ? r.nome : `codice ${r.codice}`}${r.ultimo_prezzo !== null && prezzo ? ` · ${euro(r.ultimo_prezzo)}` : ''}`,
    chip: r.in_magazzino ? `${r.in_magazzino} in magazzino` : '',
    dati: r,
  });
  const scelto = (r) => {
    cod.value = r.codice;
    nome.value = r.nome;
    if (prezzo && pr && !pr.value && r.ultimo_prezzo !== null && r.ultimo_prezzo !== undefined) pr.value = String(r.ultimo_prezzo).replace('.', ',');
    (prezzo && pr && !pr.value ? pr : q)?.focus();
  };
  combo(cod, { trova: (t) => cercaCodici(getDb(), t, 8, 'codice').map(voce('codice')), alScelta: scelto });
  combo(nome, { trova: (t) => cercaCodici(getDb(), t, 8, 'nome').map(voce('nome')), alScelta: scelto, minimo: 2 });
  // codice scritto per intero e già noto: completa il nome senza dover toccare il suggerimento
  cod.addEventListener('change', () => {
    const t = cercaCodici(getDb(), cod.value, 1, 'codice')[0];
    if (t && t.codice === cod.value.trim() && !nome.value) scelto(t);
  });
}

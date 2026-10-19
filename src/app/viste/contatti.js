import { getDb, modificato } from '../../store.js';
import { elencoContatti, assicuraContatto, salvaContatto, eliminaContatto, unisciContatti } from '../../domain/contatti.js';
import { icona, esc, num, intestazione, campo } from '../../ui/kit.js';
import { apriFoglio, mostraErrore, conferma, toast } from '../ui.js';
import { chiediContatto } from '../campi.js';

const filtro = { tipo: 'T', testo: '' };
const iniziali = (n) => n.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

export function contatti(vista) {
  vista.innerHTML = `${intestazione('Contatti', { destra: `<button class="icon-btn pieno" id="nuovo" aria-label="Nuovo contatto">${icona('plus', 24, 2.4)}</button>` })}
    <div class="ricerca">${icona('search', 20)}<input id="cerca" type="search" placeholder="Cerca per nome o telefono" value="${esc(filtro.testo)}" autocomplete="off"></div>
    <div class="segmenti" role="group">
      ${[['T', 'Tutti'], ['C', 'Clienti'], ['F', 'Fornitori']].map(([k, t]) => `<button data-t="${k}" aria-pressed="${filtro.tipo === k}">${t}</button>`).join('')}
    </div>
    <div class="lista" id="lista"></div>`;
  const lista = vista.querySelector('#lista');

  const disegna = () => {
    const t = filtro.testo.trim().toLowerCase();
    const righe = elencoContatti(getDb(), filtro.tipo === 'T' ? null : filtro.tipo)
      .filter((c) => !t || c.nome.toLowerCase().includes(t) || c.telefono.toLowerCase().includes(t));
    if (!righe.length) {
      lista.innerHTML = `<div class="vuoto"><span class="ic">${icona('users', 30)}</span><b>${t ? 'Nessun contatto trovato' : 'Nessun contatto'}</b>
        <span>${t ? 'Prova con un altro nome.' : 'I contatti si creano da soli con gli ordini, oppure con il pulsante +.'}</span></div>`;
      return;
    }
    let html = '';
    let lett = '';
    for (const c of righe) {
      const l = c.nome[0].toUpperCase();
      if (l !== lett) { lett = l; html += `<div class="lettera">${esc(l)}</div>`; }
      html += `<button class="contatto" data-id="${c.id}"><span class="avatar ${c.tipo}">${esc(iniziali(c.nome))}</span>
        <span class="corpo"><div class="nome">${esc(c.nome)}</div>
        <div class="sub">${c.tipo === 'F' ? 'Fornitore' : 'Cliente'} · ${num(c.n_ordini, 'ordine', 'ordini')}${c.telefono ? ` · ${esc(c.telefono)}` : ''}</div></span>${icona('chevron', 20)}</button>`;
    }
    lista.innerHTML = html;
    lista.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => foglioContatto(Number(b.dataset.id), disegna); });
  };
  disegna();
  vista.querySelector('#cerca').oninput = (e) => { filtro.testo = e.target.value; disegna(); };
  vista.querySelectorAll('[data-t]').forEach((b) => {
    b.onclick = () => {
      filtro.tipo = b.dataset.t;
      vista.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      disegna();
    };
  });
  vista.querySelector('#nuovo').onclick = () => foglioNuovo(disegna);
}

function foglioNuovo(dopo) {
  const { chiudi, radice } = apriFoglio(`<h2>Nuovo contatto</h2>
    <div class="segmenti" role="group"><button data-tp="C" aria-pressed="true">Cliente</button><button data-tp="F" aria-pressed="false">Fornitore</button></div>
    ${campo('Nome', '<input id="f-nome" autocomplete="off" autocapitalize="words" autofocus>')}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Crea</button></div>`);
  let tipo = 'C';
  radice.querySelectorAll('[data-tp]').forEach((b) => {
    b.onclick = () => { tipo = b.dataset.tp; radice.querySelectorAll('[data-tp]').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
  });
  radice.querySelector('#ok').onclick = async () => {
    try {
      const nome = await chiediContatto(radice.querySelector('#f-nome').value, tipo);
      if (nome === null) return;
      const c = assicuraContatto(getDb(), nome, tipo);
      modificato(); chiudi(); dopo();
      foglioContatto(c.id, dopo);
    } catch (e) { mostraErrore(radice, e); }
  };
}

function foglioContatto(id, dopo) {
  const db = getDb();
  const c = elencoContatti(db).find((x) => x.id === id);
  if (!c) return;
  const { chiudi, radice } = apriFoglio(`<h2>${esc(c.nome)}</h2>
    <div class="segmenti" role="group"><button data-tp="C" aria-pressed="${c.tipo === 'C'}">Cliente</button><button data-tp="F" aria-pressed="${c.tipo === 'F'}">Fornitore</button></div>
    ${campo('Nome', `<input id="f-nome" value="${esc(c.nome)}" autocomplete="off" autocapitalize="words">`)}
    ${campo('Telefono', `<input id="f-tel" type="tel" value="${esc(c.telefono)}">`)}
    ${campo('Indirizzo', `<input id="f-ind" value="${esc(c.indirizzo)}">`)}
    ${campo('Email', `<input id="f-mail" type="email" value="${esc(c.email)}">`)}
    ${campo('Note', `<textarea id="f-note">${esc(c.note)}</textarea>`)}
    <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="salva">Salva</button></div>
    <div class="barra"><button class="btn sec" id="unisci">Unisci a…</button><button class="btn peric" id="elimina">Elimina</button></div>`);
  let tipo = c.tipo;
  radice.querySelectorAll('[data-tp]').forEach((b) => {
    b.onclick = () => { tipo = b.dataset.tp; radice.querySelectorAll('[data-tp]').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
  });
  const v = (s) => radice.querySelector(s).value;
  radice.querySelector('#salva').onclick = () => {
    try {
      salvaContatto(db, id, { nome: v('#f-nome'), tipo, telefono: v('#f-tel'), indirizzo: v('#f-ind'), email: v('#f-mail'), note: v('#f-note') });
      modificato(); chiudi(); dopo(); toast('Contatto salvato');
    } catch (e) { mostraErrore(radice, e); }
  };
  radice.querySelector('#elimina').onclick = async () => {
    try {
      if (c.n_ordini) eliminaContatto(db, id); // lancia l'errore previsto
      chiudi();
      if (!(await conferma({ titolo: 'Eliminare il contatto?', testo: c.nome, etichetta: 'Elimina', pericolo: true }))) return;
      eliminaContatto(db, id); modificato(); dopo(); toast('Contatto eliminato');
    } catch (e) { mostraErrore(radice, e); }
  };
  radice.querySelector('#unisci').onclick = () => {
    const altri = elencoContatti(db).filter((x) => x.id !== id);
    if (!altri.length) return toast('Non ci sono altri contatti');
    chiudi();
    const f = apriFoglio(`<h2>Unisci “${esc(c.nome)}” a…</h2>
      <p class="muted piccolo" style="margin-bottom:12px">Gli ordini passano al contatto scelto e “${esc(c.nome)}” viene eliminato.</p>
      ${campo('Contatto da tenere', `<select id="f-dest">${altri.map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select>`)}
      <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Unisci</button></div>`);
    f.radice.querySelector('#ok').onclick = () => {
      try {
        unisciContatti(db, Number(f.radice.querySelector('#f-dest').value), id);
        modificato(); f.chiudi(); dopo(); toast('Contatti uniti');
      } catch (e) { mostraErrore(f.radice, e); }
    };
  };
}

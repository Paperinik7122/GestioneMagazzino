import { getDb, modificato } from '../../store.js';
import { elencoContatti, assicuraContatto, salvaContatto, eliminaContatto, unisciContatti, cercaContatti, contattiSimili, trovaContatto } from '../../domain/contatti.js';
import { icona, esc, num, intestazione, campo } from '../../ui/kit.js';
import { apriFoglio, mostraErrore, conferma, toast } from '../ui.js';
import { chiediContatto } from '../campi.js';
import { ErroreDominio } from '../../domain/errori.js';
import { combo } from '../combo.js';

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
    const t = filtro.testo.trim();
    const tipo = filtro.tipo === 'T' ? null : filtro.tipo;
    // con una ricerca: elenco per pertinenza (parole in qualsiasi ordine, senza badare ad accenti e punteggiatura)
    const righe = t ? cercaContatti(getDb(), t, tipo, Infinity) : elencoContatti(getDb(), tipo);
    if (!righe.length) {
      lista.innerHTML = `<div class="vuoto"><span class="ic">${icona('users', 30)}</span><b>${t ? 'Nessun contatto trovato' : 'Nessun contatto'}</b>
        <span>${t ? 'Prova con un altro nome.' : 'I contatti si creano da soli con gli ordini, oppure con il pulsante +.'}</span></div>`;
      return;
    }
    let html = '';
    let lett = '';
    for (const c of righe) {
      const l = c.nome[0].toUpperCase();
      if (!t && l !== lett) { lett = l; html += `<div class="lettera">${esc(l)}</div>`; }
      html += `<div class="contatto"><a class="contatto-vai" href="#/contatto/${c.id}"><span class="avatar ${c.tipo}">${esc(iniziali(c.nome))}</span>
        <span class="corpo"><div class="nome">${esc(c.nome)}</div>
        <div class="sub">${c.tipo === 'F' ? 'Fornitore' : 'Cliente'} · ${num(c.n_ordini, 'ordine', 'ordini')}${c.telefono ? ` · ${esc(c.telefono)}` : ''}</div></span></a>
        <button class="icon-btn" data-mod="${c.id}" aria-label="Modifica ${esc(c.nome)}">${icona('edit', 22)}</button></div>`;
    }
    lista.innerHTML = html;
    lista.querySelectorAll('[data-mod]').forEach((b) => { b.onclick = () => foglioContatto(Number(b.dataset.mod), disegna); });
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
  // mentre scrivi mostra i contatti già esistenti (di qualsiasi tipo): toccandone uno si apre quello
  combo(radice.querySelector('#f-nome'), {
    trova: (t) => cercaContatti(getDb(), t, null).map((c) => ({
      titolo: c.nome, sotto: c.tipo === 'F' ? 'Fornitore, esiste già: tocca per aprirlo' : 'Cliente, esiste già: tocca per aprirlo', dati: c.id,
    })),
    alScelta: (id) => { chiudi(); foglioContatto(id, dopo); },
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

export function foglioContatto(id, dopo) {
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
  radice.querySelector('#salva').onclick = async () => {
    try {
      // nome cambiato e simile a un altro contatto: chiede se sono la stessa persona
      const cambiato = v('#f-nome').trim() !== c.nome;
      const simili = cambiato && !trovaContatto(db, v('#f-nome')) ? contattiSimili(db, v('#f-nome'), { escludiId: id }) : [];
      if (simili.length) {
        const scelta = await chiediUnione(v('#f-nome'), simili);
        if (scelta === null) return;
        if (scelta !== 'nuovo') {
          unisciContatti(db, scelta, id);
          modificato(); chiudi(); dopo(); toast('Contatti uniti');
          return;
        }
      }
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
      ${campo('Contatto da tenere', '<input id="f-dest" autocomplete="off" autocapitalize="words" placeholder="Scrivi per cercare" autofocus>')}
      <div class="barra"><button class="btn sec" data-chiudi>Annulla</button><button class="btn" id="ok">Unisci</button></div>`);
    const campoDest = f.radice.querySelector('#f-dest');
    let destId = null;
    campoDest.addEventListener('input', () => { destId = null; });
    combo(campoDest, {
      trova: (t) => cercaContatti(db, t, null).filter((x) => x.id !== id).map((x) => ({ titolo: x.nome, chip: num(x.n_ordini, 'ordine', 'ordini'), dati: x })),
      alScelta: (x) => { campoDest.value = x.nome; destId = x.id; },
    });
    f.radice.querySelector('#ok').onclick = () => {
      try {
        const dest = destId ?? trovaContatto(db, campoDest.value)?.id;
        if (!dest || dest === id) throw new ErroreDominio('Scegli dall’elenco il contatto da tenere.');
        unisciContatti(db, dest, id);
        modificato(); f.chiudi(); dopo(); toast('Contatti uniti');
      } catch (e) { mostraErrore(f.radice, e); }
    };
  };
}

/** Il nome scritto somiglia a contatti esistenti: unire a uno di essi, tenerlo separato o annullare. */
function chiediUnione(nome, simili) {
  return new Promise((resolve) => {
    const { chiudi, radice } = apriFoglio(`<h2>È la stessa persona?</h2>
      <p class="muted piccolo" style="margin-bottom:12px">“${esc(nome)}” somiglia a contatti già presenti. Se sono la stessa persona, unisci: gli ordini passano al contatto scelto.</p>
      ${simili.map((x, i) => `<button class="simile" data-i="${i}">Unisci a ${esc(x.nome)}<small>${num(x.n_ordini, 'ordine', 'ordini')}</small></button>`).join('')}
      <button class="simile" data-nuovo>No, sono persone diverse<small>salva il nome “${esc(nome)}”</small></button>
      <div class="barra"><button class="btn sec" data-annulla>Annulla</button></div>`);
    radice.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { chiudi(); resolve(simili[Number(b.dataset.i)].id); }; });
    radice.querySelector('[data-nuovo]').onclick = () => { chiudi(); resolve('nuovo'); };
    radice.querySelector('[data-annulla]').onclick = () => { chiudi(); resolve(null); };
  });
}

// Piccoli attrezzi per costruire l'interfaccia con template HTML.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const euro = (n) => (n === null || n === undefined || n === ''
  ? '—'
  : `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

/** "2026-01-13" -> "13.01.2026" */
export const dataIt = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
};

const P = {
  back: 'M15 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M6 12h12',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4',
  ok: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 12.5l2.6 2.6L16 9.5',
  empty: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  part: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8.5 12h7',
  lock: 'M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM8 11V8a4 4 0 0 1 8 0v3',
  cart: 'M3 4h2.2l1.6 10h10.6l1.6-7H6.2M9.5 18.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM16.5 18.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM12 8.2v3.6M10.2 10h3.6',
  swap: 'M7 7h11M15 4l3 3-3 3M17 17H6M9 14l-3 3 3 3',
  gift: 'M4 10h16v10H4ZM3 7h18v3H3ZM12 7v13M12 7C10 7 8 6.2 8 4.8 8 3.6 9.2 3 10.3 3.4 11.4 3.8 12 7 12 7ZM12 7c2 0 4-.8 4-2.2 0-1.2-1.2-1.8-2.3-1.4C12.6 3.8 12 7 12 7Z',
  pin: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11ZM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  hourglass: 'M7 3h10M7 21h10M8 3c0 5 4 5 4 9s-4 4-4 9M16 3c0 5-4 5-4 9s4 4 4 9',
  box: 'M12 3l8 4v10l-8 4-8-4V7l8-4ZM4 7l8 4 8-4M12 11v10',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c0-3.3 2.8-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.2a3.5 3.5 0 0 1 0 6.6M18 14.8c2.1.7 3.5 2.4 3.5 5.2',
  truck: 'M3 6h11v10H3ZM14 9h4l3 3.5V16h-7M7.5 14.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM17.5 14.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  wand: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z',
  download: 'M12 4v10M8 10l4 4 4-4M5 20h14',
  upload: 'M12 20V10M8 14l4-4 4 4M5 4h14',
  home: 'M4 11l8-7 8 7M6 10v10h12V10M10 20v-5h4v5',
  orders: 'M9 4h6v3H9ZM7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M8.5 12h7M8.5 16h5',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4 10h16M8 3v4M16 3v4',
  warn: 'M12 4l9 16H3ZM12 10v4M12 17.2v.1',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
};

export function icona(nome, w = 22, sw = 2) {
  return `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[nome] ?? ''}"/></svg>`;
}

/** Etichetta tonda colorata: tono = verde|ambra|rosso|blu|viola|grigio|rosa|navy */
export const chip = (tono, testo, ic = null) =>
  `<span class="chip t-${tono}">${ic ? icona(ic, 15) : ''}${esc(testo)}</span>`;

export const tagTipo = (tipo) => (tipo === 'A'
  ? chip('viola', 'Fornitore', 'truck')
  : chip('blu', 'Cliente', 'user'));

export function intestazione(titolo, { indietro = null, destra = '' } = {}) {
  return `<header class="top">
    ${indietro ? `<a class="icon-btn" href="${indietro}" aria-label="Indietro">${icona('back', 26, 2.2)}</a>` : ''}
    <h1>${titolo}</h1>${destra}</header>`;
}

export function campo(etichetta, controllo, extra = '') {
  return `<label class="campo ${extra}"><span class="lab">${esc(etichetta)}</span>${controllo}</label>`;
}

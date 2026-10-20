// Scheda di un contatto: ordini aperti, quanto ha speso, prodotti più acquistati e storico.
import { getDb } from '../../store.js';
import { schedaContatto } from '../../domain/scheda-contatto.js';
import { icona, esc, euro, dataIt, num, intestazione } from '../../ui/kit.js';
import { schedaOrdine } from './ordini.js';
import { foglioContatto } from './contatti.js';
import { foglioNuovoOrdine } from './ordini.js';

const iniziali = (n) => n.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

function quandoFa(giorni) {
  if (giorni === null) return '';
  if (giorni <= 0) return 'oggi';
  if (giorni === 1) return 'ieri';
  if (giorni < 31) return `${giorni} giorni fa`;
  if (giorni < 365) { const m = Math.max(1, Math.round(giorni / 30)); return m === 1 ? '1 mese fa' : `${m} mesi fa`; }
  const a = Math.floor(giorni / 365);
  return `${a} ${a === 1 ? 'anno' : 'anni'} fa`;
}

const tessera = (n, et, sub = '') => `<div class="stat"><div class="n">${n}</div><div class="et">${esc(et)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;

export function contatto(vista, _query, idUrl) {
  const id = Number(idUrl);

  const disegna = () => {
    const s = schedaContatto(getDb(), id);
    if (!s) { location.hash = '#/contatti'; return; } // eliminato o unito a un altro
    const c = s.contatto;
    const forn = s.tipoOrdini === 'A';
    const verbo = forn ? 'ordinato' : 'speso';
    const y = window.scrollY;

    const recapiti = [
      c.telefono && `<a class="recapito" href="tel:${esc(c.telefono.replace(/[^\d+]/g, ''))}">${icona('phone', 18)}<span>${esc(c.telefono)}</span></a>`,
      c.email && `<a class="recapito" href="mailto:${esc(c.email)}">${icona('mail', 18)}<span>${esc(c.email)}</span></a>`,
      c.indirizzo && `<a class="recapito" href="https://maps.google.com/?q=${encodeURIComponent(c.indirizzo)}" target="_blank" rel="noopener">${icona('pin', 18)}<span>${esc(c.indirizzo)}</span></a>`,
    ].filter(Boolean).join('');

    // ---- in evidenza: cosa c'è da fare per questo contatto ----
    let evidenza = '';
    if (s.aperti.length) {
      const dettagli = [];
      if (!forn && s.prodottiDaOrdinare) dettagli.push(`${num(s.prodottiDaOrdinare, 'prodotto', 'prodotti')} da ordinare`);
      if (!forn && s.prontiDaConsegnare) dettagli.push(`${num(s.prontiDaConsegnare, 'ordine pronto', 'ordini pronti')} da consegnare`);
      evidenza = `<div class="avviso ok" style="margin-top:12px">${icona('orders', 20)}<span><b>${num(s.aperti.length, 'ordine aperto', 'ordini aperti')}</b>, ${euro(s.totaleAperti)}${dettagli.length ? ` · ${dettagli.join(' · ')}` : ''}</span></div>`;
    }

    // ---- numeri ----
    const nessunOrdine = !s.nChiusi;
    const numeri = nessunOrdine
      ? `<div class="vuoto" style="padding:24px 12px"><span class="ic">${icona('chart', 28)}</span><b>Nessun ordine ${forn ? 'ricevuto' : 'consegnato'} finora</b>
          <span>Le statistiche compaiono quando un ordine viene chiuso.</span></div>`
      : `<div class="stats">
          ${tessera(euro(s.speso), `Totale ${verbo}`, num(s.nChiusi, 'ordine chiuso', 'ordini chiusi'))}
          ${tessera(euro(s.media), 'Media per ordine', num(s.nProdotti, 'prodotto', 'prodotti') + ' in tutto')}
          ${tessera(euro(s.spesoUltimoAnno), 'Ultimi 12 mesi')}
          ${tessera(s.ultimo ? dataIt(s.ultimo) : '—', 'Ultimo ordine', quandoFa(s.giorniDallUltimo))}
        </div>
        <p class="muted piccolo abitudini">${[
          s.giorniMedi !== null ? `Ordina in media ogni ${s.giorniMedi} giorni` : null,
          s.primo ? `Primo ordine: ${dataIt(s.primo)}` : null,
          s.catalogoFrequente ? `Catalogo più usato: ${esc(s.catalogoFrequente)}` : null,
        ].filter(Boolean).join(' · ')}</p>`;

    // ---- prodotti più acquistati ----
    const prodotti = s.prodotti.length
      ? `<div class="sezione"><h2>Prodotti più ${forn ? 'ordinati' : 'acquistati'}</h2></div>
         <div class="lista">${s.prodotti.map((p, i) => `<a class="riga link" href="#/codice/${encodeURIComponent(p.codice)}">
           <div class="r1"><span class="pos">${i + 1}</span><div class="nome">${esc(p.nome)}<div class="cod">codice ${esc(p.codice)} · ultimo ${dataIt(p.ultima)}</div></div>
           <div class="prezzo">${p.quantita}×<div class="cod" style="text-align:right">${euro(p.totale)}</div></div></div></a>`).join('')}</div>`
      : '';

    // ---- ordini ----
    const aperti = s.aperti.length
      ? `<div class="sezione"><h2>Ordini aperti</h2></div><div class="lista">${s.aperti.map(schedaOrdine).join('')}</div>`
      : '';
    const chiusi = s.chiusi.length
      ? `<div class="sezione"><h2>Storico ordini</h2><span class="muted piccolo">${s.chiusi.length}</span></div>
         <div class="lista">${s.chiusi.slice(0, 10).map(schedaOrdine).join('')}</div>
         ${s.chiusi.length > 10 ? `<a class="btn sec largo" style="margin-top:10px" href="#/ordini?q=${encodeURIComponent(c.nome)}&chiusi=1">Vedi tutti i ${s.chiusi.length} ordini</a>` : ''}`
      : '';

    vista.innerHTML = `${intestazione(esc(c.nome), {
      indietro: '#/contatti',
      destra: `<button class="icon-btn" id="modifica" aria-label="Modifica contatto">${icona('edit', 24)}</button>`,
    })}
      <div class="intesta-contatto">
        <span class="avatar grande ${c.tipo}">${esc(iniziali(c.nome))}</span>
        <div><div class="chi">${forn ? 'Fornitore' : 'Cliente'}</div>${recapiti ? `<div class="recapiti">${recapiti}</div>` : '<div class="muted piccolo">Nessun recapito: aggiungilo con la matita</div>'}</div>
      </div>
      ${c.note ? `<p class="note-contatto">${esc(c.note)}</p>` : ''}
      ${evidenza}
      <div class="sezione"><h2>${forn ? 'Acquisti' : 'Spesa'}</h2></div>
      ${numeri}
      ${prodotti}
      ${aperti}
      ${chiusi}
      <div class="barra-fissa"><button class="btn" id="nuovo-ordine">${icona('plus', 20, 2.4)} Nuovo ordine ${forn ? 'fornitore' : 'cliente'}</button></div>`;

    vista.querySelector('#modifica').onclick = () => foglioContatto(id, disegna);
    vista.querySelector('#nuovo-ordine').onclick = () => foglioNuovoOrdine(s.tipoOrdini, { contatto: c.nome });
    window.scrollTo(0, y);
  };
  disegna();
}

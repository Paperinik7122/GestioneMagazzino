// Dettaglio di un codice: ogni prodotto in magazzino con posizione, data, prezzo; spostamenti e uscite.
import { getDb } from '../../store.js';
import { dettaglioCodice } from '../../domain/magazzino.js';
import { icona, chip, esc, euro, dataIt, num, intestazione } from '../../ui/kit.js';
import { foglioNuovoProdotto, foglioProdotto, foglioSposta, foglioUscita } from './prodotto.js';

export function codice(vista, _query, codiceUrl) {
  const cod = decodeURIComponent(codiceUrl ?? '');
  let selezione = null; // null = modalità normale; Set di id = modalità selezione

  const disegna = () => {
    const d = dettaglioCodice(getDb(), cod);
    const y = window.scrollY;
    if (!d.prodotti.length) {
      vista.innerHTML = `${intestazione(esc(d.nome || cod), { indietro: '#/magazzino' })}
        <div class="vuoto"><span class="ic">${icona('box', 30)}</span><b>Nessun prodotto in magazzino</b>
        <span>Del codice ${esc(d.codice)} non ci sono prodotti disponibili.</span>
        <button class="btn" id="aggiungi">${icona('plus', 20, 2.4)} Aggiungi prodotti</button></div>`;
      vista.querySelector('#aggiungi').onclick = () => foglioNuovoProdotto({ codice: d.codice, nome: d.nome }, disegna);
      return;
    }
    const liberi = d.prodotti.filter((p) => !p.impegnato_in_ordine).length;
    const prezzi = d.prezzoMin === null ? '' : d.prezzoMin === d.prezzoMax ? ` · acquistati a ${euro(d.prezzoMin)}` : ` · acquistati da ${euro(d.prezzoMin)} a ${euro(d.prezzoMax)}`;
    const inSel = selezione !== null;

    vista.innerHTML = `${intestazione(esc(d.nome), { indietro: '#/magazzino' })}
      <div class="riepilogo A" style="border-color:var(--verde);background:#eef7f1">
        <div class="r1"><span class="chi">Codice ${esc(d.codice)}</span><span class="tot">${d.prodotti.length}</span></div>
        <div class="meta">${num(d.prodotti.length, 'prodotto', 'prodotti')} in magazzino · ${liberi} ${liberi === 1 ? 'libero' : 'liberi'}${prezzi}</div>
        ${d.senzaData ? `<div class="meta">${num(d.senzaData, 'prodotto', 'prodotti')} senza data di acquisto</div>` : ''}
      </div>
      <div class="barra-fissa" style="margin:12px 0">
        <button class="btn sec" id="seleziona">${inSel ? 'Fine selezione' : 'Seleziona…'}</button>
        <button class="btn" id="aggiungi">${icona('plus', 20, 2.4)} Aggiungi</button>
      </div>
      ${inSel ? `<div class="barra-fissa" style="margin:0 0 12px">
        <button class="btn mini sec" id="sel-tutti">Tutti</button>
        <button class="btn mini sec" id="sel-dc">Solo da collocare</button>
        <button class="btn mini sec" id="sel-lib">Solo liberi</button></div>` : ''}
      <div class="lista" id="lista" ${inSel ? 'style="padding-bottom:84px"' : ''}>${d.prodotti.map((p) => riga(p, inSel, selezione)).join('')}</div>
      ${inSel ? `<div class="barra-sel"><span><b>${selezione.size}</b> ${selezione.size === 1 ? 'selezionato' : 'selezionati'}</span>
        <button class="btn mini" id="sposta" ${selezione.size ? '' : 'disabled'}>Sposta in…</button>
        <button class="btn mini sec" id="uscita" ${selezione.size ? '' : 'disabled'}>Uscita…</button></div>` : ''}`;
    window.scrollTo(0, y);

    vista.querySelector('#aggiungi').onclick = () => foglioNuovoProdotto({ codice: d.codice, nome: d.nome }, disegna);
    vista.querySelector('#seleziona').onclick = () => { selezione = inSel ? null : new Set(); disegna(); };
    if (!inSel) {
      vista.querySelectorAll('[data-id]').forEach((el) => {
        el.onclick = (e) => { if (e.target.closest('a')) return; foglioProdotto(d.prodotti.find((p) => p.id === Number(el.dataset.id)), disegna); };
      });
      return;
    }
    const imposta = (filtroFn) => { selezione = new Set(d.prodotti.filter(filtroFn).map((p) => p.id)); disegna(); };
    vista.querySelector('#sel-tutti').onclick = () => imposta(() => true);
    vista.querySelector('#sel-dc').onclick = () => imposta((p) => p.da_collocare);
    vista.querySelector('#sel-lib').onclick = () => imposta((p) => !p.impegnato_in_ordine);
    vista.querySelectorAll('[data-id]').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest('a')) return;
        const id = Number(el.dataset.id);
        if (selezione.has(id)) selezione.delete(id); else selezione.add(id);
        disegna();
      };
    });
    const dopoAzione = () => { selezione = null; disegna(); };
    vista.querySelector('#sposta').onclick = () => foglioSposta([...selezione], dopoAzione);
    vista.querySelector('#uscita').onclick = () => foglioUscita([...selezione], dopoAzione);
  };
  disegna();
}

function riga(p, inSel, selezione) {
  const dett = [
    p.data_acquisto ? `acquistato il ${dataIt(p.data_acquisto)}` : 'senza data di acquisto',
    p.catalogo_acquisto ? `catalogo ${esc(p.catalogo_acquisto)}` : '',
    p.motivo_in && p.motivo_in !== 'Inventario' ? esc(p.motivo_in.toLowerCase()) : '',
  ].filter(Boolean).join(' · ');
  const on = inSel && selezione.has(p.id);
  return `<div class="riga prod ${on ? 'scelta' : ''}" data-id="${p.id}" role="button" tabindex="0">
    <div class="r1">${inSel ? `<span class="spunta ${on ? 'on' : ''}">${on ? icona('ok', 22, 2.2) : icona('empty', 22, 1.8)}</span>` : ''}
      <div class="nome">${p.da_collocare ? chip('ambra', 'Da collocare', 'pin') : chip('grigio', p.posizione ?? 'Senza posizione', 'pin')}</div>
      <span class="prezzo">${p.prezzo_acquisto === null ? '—' : euro(p.prezzo_acquisto)}</span></div>
    <div class="r2">${p.impegnato_in_ordine ? `<a href="#/ordine/${p.impegnato_in_ordine}" style="text-decoration:none">${chip('blu', `Assegnato all’ordine #${p.impegnato_in_ordine}`, 'link')}</a>` : chip('verde', 'Libero', 'ok')}</div>
    <div class="dett">${dett}</div></div>`;
}

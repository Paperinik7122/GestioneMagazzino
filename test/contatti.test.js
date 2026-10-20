import test from 'node:test';
import assert from 'node:assert/strict';
import { nuovoVuoto } from './helpers.js';
import { creaSchema } from '../src/db/schema.js';
import { creaOrdine } from '../src/domain/ordini.js';
import { assicuraContatto, salvaContatto, eliminaContatto, elencoContatti } from '../src/domain/contatti.js';

test('contatti: modifica, nome unico, eliminazione solo se senza ordini', async () => {
  const db = await nuovoVuoto();
  creaSchema(db);
  const a = assicuraContatto(db, 'Paola', 'C');
  const b = assicuraContatto(db, 'Marta', 'C');
  salvaContatto(db, a.id, { nome: 'Paola Rossi', tipo: 'C', telefono: ' 333 1234 ' });
  assert.equal(elencoContatti(db).find((c) => c.id === a.id).telefono, '333 1234');
  assert.throws(() => salvaContatto(db, b.id, { nome: 'paola rossi', tipo: 'C' }), /Esiste già/);
  creaOrdine(db, { tipo: 'V', contatto: 'Paola Rossi', data: '2026-10-01' });
  assert.throws(() => eliminaContatto(db, a.id), /1 ordini/);
  eliminaContatto(db, b.id);
  assert.equal(elencoContatti(db).length, 1);
});

test('scheda contatto: spesa, prodotti più acquistati, ordini aperti, abitudini', async () => {
  const { schedaContatto } = await import('../src/domain/scheda-contatto.js');
  const { aggiungiRighe, collegaRiga, consegnaOrdine } = await import('../src/domain/ordini.js');
  const { creaProdotti } = await import('../src/domain/magazzino.js');
  const { idDaCollocare } = await import('../src/domain/posizioni.js');
  const db = await nuovoVuoto();
  creaSchema(db);
  const paola = assicuraContatto(db, 'Paola', 'C');
  assert.equal(schedaContatto(db, 999), null);
  let s = schedaContatto(db, paola.id, '2026-10-20');
  assert.equal(s.nChiusi, 0);
  assert.equal(s.speso, 0);
  assert.equal(s.media, null);
  assert.deepEqual(s.prodotti, []);

  // due ordini consegnati: Degreaser x3 (10 €) e Soap x1 (5 €)
  const consegna = (data, righe) => {
    const o = creaOrdine(db, { tipo: 'V', contatto: 'Paola', data, catalogo: 'C10' });
    for (const r of righe) {
      const ids = aggiungiRighe(db, o, r);
      const pezzi = creaProdotti(db, { codice: r.codice, nome: r.nome, quantita: r.quantita, prezzo: r.prezzo, posizioneId: idDaCollocare(db), motivo: 'Inventario', data });
      ids.forEach((rid, i) => collegaRiga(db, rid, pezzi[i]));
    }
    consegnaOrdine(db, o, data);
    return o;
  };
  consegna('2026-08-01', [{ codice: '100', nome: 'Degreaser', prezzo: 10, quantita: 3 }]);
  consegna('2026-10-01', [{ codice: '200', nome: 'Soap', prezzo: 5, quantita: 1 }, { codice: '100', nome: 'Degreaser', prezzo: 10, quantita: 1 }]);
  // un ordine ancora aperto e uno di un'altra persona (non deve contare)
  const aperto = creaOrdine(db, { tipo: 'V', contatto: 'Paola', data: '2026-10-15' });
  aggiungiRighe(db, aperto, { codice: '300', nome: 'Wash', prezzo: 7, quantita: 2 });
  const altro = creaOrdine(db, { tipo: 'V', contatto: 'Marta', data: '2026-10-02' });
  aggiungiRighe(db, altro, { codice: '100', nome: 'Degreaser', prezzo: 10, quantita: 9 });

  s = schedaContatto(db, paola.id, '2026-10-20');
  assert.equal(s.tipoOrdini, 'V');
  assert.equal(s.nChiusi, 2);
  assert.equal(s.speso, 45); // 30 + 15
  assert.equal(s.media, 22.5);
  assert.equal(s.nProdotti, 5);
  assert.equal(s.primo, '2026-08-01');
  assert.equal(s.ultimo, '2026-10-01');
  assert.equal(s.giorniDallUltimo, 19);
  assert.equal(s.giorniMedi, 61);
  assert.equal(s.spesoUltimoAnno, 45);
  assert.equal(s.catalogoFrequente, 'C10');
  assert.equal(s.aperti.length, 1);
  assert.equal(s.aperti[0].id, aperto);
  assert.equal(s.totaleAperti, 14);
  assert.equal(s.prodottiDaOrdinare, 2);
  assert.equal(s.prontiDaConsegnare, 0);
  assert.deepEqual(s.prodotti.map((p) => [p.codice, p.quantita, p.totale]), [['100', 4, 40], ['200', 1, 5]]);
  // un anno dopo non rientra più negli "ultimi 12 mesi"
  assert.equal(schedaContatto(db, paola.id, '2027-10-20').spesoUltimoAnno, 0);
});

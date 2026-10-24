import test from 'node:test';
import assert from 'node:assert/strict';
import { nuovoVuoto } from './helpers.js';
import { creaSchema } from '../src/db/schema.js';
import { creaProdotti, elencoMagazzino, spostaProdotti, dettaglioCodice, modificaProdotto } from '../src/domain/magazzino.js';
import { creaPosizione, rinominaPosizione, eliminaPosizione, elencoPosizioni, idDaCollocare } from '../src/domain/posizioni.js';

test('magazzino: ricerca per parole senza badare ad accenti, punteggiatura e ordine; filtro posizione', async () => {
  const db = await nuovoVuoto();
  creaSchema(db);
  creaProdotti(db, { codice: '25689', nome: 'Detersivo piatti limone', quantita: 2 });
  creaProdotti(db, { codice: '11200', nome: 'Crema mani', quantita: 1 });
  assert.equal(elencoMagazzino(db, { testo: 'LIMONE piatti' }).length, 1);
  assert.equal(elencoMagazzino(db, { testo: '25 689' }).length, 1);
  assert.equal(elencoMagazzino(db, { testo: 'zzz' }).length, 0);
  const sc = creaPosizione(db, 'Scatola 1');
  spostaProdotti(db, [dettaglioCodice(db, '11200').prodotti[0].id], sc);
  assert.equal(elencoMagazzino(db, { posizioneId: sc })[0].codice, '11200');
  assert.equal(elencoMagazzino(db, { posizioneId: 'da_collocare' }).length, 1);
});

test('posizioni: nomi uguali a meno di spazi/punteggiatura sono la stessa posizione', async () => {
  const db = await nuovoVuoto();
  creaSchema(db);
  const a = creaPosizione(db, 'Scatola 1');
  assert.throws(() => creaPosizione(db, 'scatola-1'), /Esiste già la posizione “Scatola 1”/);
  const b = creaPosizione(db, 'Scatola 2');
  assert.throws(() => rinominaPosizione(db, b, 'SCATOLA  1.'), /Esiste già/);
  rinominaPosizione(db, a, 'Scatola 1 bis');
  assert.throws(() => eliminaPosizione(db, idDaCollocare(db)), /non si può eliminare/);
  creaProdotti(db, { codice: '1', nome: 'X', posizioneId: b });
  assert.throws(() => eliminaPosizione(db, b), /c’è ancora 1 prodotto/);
  assert.equal(elencoPosizioni(db).length, 3);
});

test('magazzino: si può correggere codice e nome di un prodotto (anche se era senza codice)', async () => {
  const db = await nuovoVuoto();
  creaSchema(db);
  creaProdotti(db, { codice: '25689', nome: 'Detersivo piatti limone' });
  // prodotto importato dal vecchio DB senza codice
  db.run("INSERT INTO magazzino(codice, nome, posizione_id) VALUES ('', 'Windows glove rosso', ?)", [idDaCollocare(db)]);
  const id = dettaglioCodice(db, '').prodotti[0].id;
  assert.throws(() => modificaProdotto(db, id, { codice: '' }), /Serve il codice/);
  modificaProdotto(db, id, { codice: '31450', nome: 'Windows glove' });
  assert.equal(dettaglioCodice(db, '').prodotti.length, 0);
  assert.equal(dettaglioCodice(db, '31450').prodotti[0].nome, 'Windows glove');
  // un codice già esistente (scritto con lo spazio) viene riusato
  modificaProdotto(db, id, { codice: '25 689' });
  assert.equal(dettaglioCodice(db, '25689').prodotti.length, 2);
});

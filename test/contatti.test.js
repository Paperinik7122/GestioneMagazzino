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

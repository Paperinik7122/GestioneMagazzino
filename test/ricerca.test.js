import test from 'node:test';
import assert from 'node:assert/strict';
import { nuovoVuoto } from './helpers.js';
import { creaSchema } from '../src/db/schema.js';
import { assicuraContatto, cercaContatti, contattiSimili, salvaContatto } from '../src/domain/contatti.js';
import { assicuraCodice, cercaCodici } from '../src/domain/codici.js';

async function db() { const d = await nuovoVuoto(); creaSchema(d); return d; }

test('contatti: stessa scrittura con spazi, punteggiatura o accenti = stesso contatto', async () => {
  const d = await db();
  const a = assicuraContatto(d, 'Paola Rossi', 'C');
  for (const v of ['paola  rossi', 'Paola-Rossi', 'PAOLA ROSSI.', ' Paola Rossi ']) assert.equal(assicuraContatto(d, v, 'C').id, a.id);
  const j = assicuraContatto(d, 'José Müller', 'C');
  assert.equal(assicuraContatto(d, 'Jose Muller', 'C').id, j.id);
  const b = assicuraContatto(d, 'Marta', 'C');
  assert.throws(() => salvaContatto(d, b.id, { nome: 'paola-rossi', tipo: 'C' }), /Esiste già/);
});

test('contatti: suggerimenti mentre si scrive e nomi simili', async () => {
  const d = await db();
  ['Paola Rossi', 'Paola Verdi', 'Marco Bianchi', 'Stanhome'].forEach((n, i) => assicuraContatto(d, n, i === 3 ? 'F' : 'C'));
  assert.deepEqual(cercaContatti(d, 'pao ro', 'C').map((c) => c.nome), ['Paola Rossi']);
  assert.deepEqual(cercaContatti(d, 'rossi paola', 'C').map((c) => c.nome), ['Paola Rossi']);
  assert.deepEqual(cercaContatti(d, 'stan', 'C'), []);
  assert.equal(cercaContatti(d, 'stan', 'F').length, 1);
  assert.deepEqual(cercaContatti(d, "%'--"), []);
  assert.deepEqual(contattiSimili(d, 'Paola Rosi', { tipo: 'C' }).map((c) => c.nome), ['Paola Rossi']);
  assert.deepEqual(contattiSimili(d, 'Paola', { tipo: 'C' }).map((c) => c.nome).sort(), ['Paola Rossi', 'Paola Verdi']);
  assert.deepEqual(contattiSimili(d, 'Paola Rossi', { tipo: 'C' }), []); // identico: non è "simile"
  assert.deepEqual(contattiSimili(d, 'Luca', { tipo: 'C' }), []);
});

test('codici: suggerimenti per codice e per nome, con codice e nome insieme', async () => {
  const d = await db();
  assicuraCodice(d, '25689', 'Detersivo piatti limone');
  assicuraCodice(d, '25690', 'Detersivo piatti limone Natale');
  assicuraCodice(d, '11200', 'Crema mani idratante');
  assert.deepEqual(cercaCodici(d, '256', 8, 'codice').map((c) => c.codice), ['25689', '25690']);
  assert.deepEqual(cercaCodici(d, '25 689', 8, 'codice').map((c) => c.codice), ['25689']);
  assert.deepEqual(cercaCodici(d, 'detersivo limone', 8, 'nome').map((c) => c.codice), ['25689', '25690']);
  assert.deepEqual(cercaCodici(d, 'IDRATANTE crema', 8, 'nome').map((c) => c.nome), ['Crema mani idratante']);
  assert.deepEqual(cercaCodici(d, '11200', 8, 'nome'), []);
  assert.deepEqual(cercaCodici(d, "%'--"), []);
  // il codice scritto con spazi o trattini ritrova quello esistente invece di crearne uno nuovo
  assert.equal(assicuraCodice(d, '25-689', 'altro nome').codice, '25689');
});

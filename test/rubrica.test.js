import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlLib } from './helpers.js';
import { migraDaB4A } from '../src/db/migrate-b4a.js';
import { popolaRubrica, leggiRubrica, elencoAlias } from '../src/db/rubrica-b4a.js';
import { righeReport } from '../src/db/backup.js';
import { all, scalar } from '../src/db/util.js';

function vecchio(SQL) {
  const d = new SQL.Database();
  d.run(`CREATE TABLE TabOrdini (Numero INTEGER, Verso TEXT, DataEmissione TEXT, DataEvasione TEXT, Contatto TEXT, Catalogo TEXT, Note TEXT, Evaso TEXT, Totale REAL);
    CREATE TABLE TabDettaglioOrdini (Ordine TEXT, Codice TEXT, NomeProdotto TEXT, Prezzo REAL, IDMagazzinoAssociato INTEGER, Nuovo INTEGER);
    CREATE TABLE TabMagazzino (Codice TEXT, NomeProdotto TEXT, OrdineIn TEXT, PrezzoIn REAL, OrdineOut TEXT, PrezzoOut REAL, InMagazzino TEXT, Note TEXT, Posizione TEXT);
    CREATE TABLE TabContatti (Nome TEXT, Telefono TEXT, Indirizzo TEXT, Email TEXT);`);
  const o = (n, verso, chi) => d.run('INSERT INTO TabOrdini VALUES (?,?,?,?,?,?,?,?,?)', [n, verso, '01.10.2026', '', chi, 'C10', '', 'N', null]);
  o(1, 'A', 'Stanhome ');
  o(2, 'V', 'Rossi Mario');
  o(3, 'V', 'rossi  mario');
  o(4, 'V', 'Mamma');
  o(5, 'V', 'Mamma Rita');
  o(6, 'V', 'io');
  o(7, 'A', 'io');
  return d;
}
const nomi = (db) => all(db, 'SELECT nome FROM contatti ORDER BY nome COLLATE NOCASE').map((r) => r.nome);

test('popola la rubrica: unisce solo maiuscole/spazi e non tocca l’originale', async () => {
  const SQL = await sqlLib();
  const d = vecchio(SQL);
  const r = popolaRubrica(d);
  assert.equal(r.contatti, 5); // Stanhome, Rossi Mario, Mamma, Mamma Rita, io
  assert.deepEqual(r.misti, ['io']);
  const rub = all(d, 'SELECT * FROM TabContatti ORDER BY Nome COLLATE NOCASE');
  assert.deepEqual(rub.map((x) => x.Nome), ['io', 'Mamma', 'Mamma Rita', 'Rossi Mario', 'Stanhome']);
  assert.equal(rub.find((x) => x.Nome === 'Stanhome').Tipo, 'F');
  assert.equal(rub.find((x) => x.Nome === 'Rossi Mario').Tipo, 'C');
  assert.equal(rub.find((x) => x.Nome === 'Rossi Mario').Alias, 'rossi mario'); // la variante unita resta visibile
  // gli ordini non sono stati toccati
  assert.equal(scalar(d, "SELECT COUNT(*) FROM TabOrdini WHERE Contatto = 'rossi  mario'"), 1);
  // non sovrascrive una rubrica già compilata
  assert.throws(() => popolaRubrica(d), /non la sovrascrivo/);
});

test('import con rubrica compilata: telefoni, alias e contatti senza ordini', async () => {
  const SQL = await sqlLib();
  const d = vecchio(SQL);
  popolaRubrica(d);
  // l'utente sistema a mano: Mamma Rita e Mamma sono la stessa persona, aggiunge telefono e un contatto nuovo
  d.run("UPDATE TabContatti SET Alias = 'Mamma', Telefono = '333 111', Note = 'consegna al sabato' WHERE Nome = 'Mamma Rita'");
  d.run("DELETE FROM TabContatti WHERE Nome = 'Mamma'");
  d.run("INSERT INTO TabContatti(Nome, Telefono, Indirizzo, Email, Tipo, Note, Alias) VALUES ('Giulia Nuova', '', '', 'g@x.it', 'C', '', '')");
  const n = new SQL.Database();
  const rep = migraDaB4A(d, n);

  assert.deepEqual(nomi(n), ['Giulia Nuova', 'io', 'Mamma Rita', 'Rossi Mario', 'Stanhome']);
  const rita = all(n, "SELECT * FROM contatti WHERE nome = 'Mamma Rita'")[0];
  assert.equal(rita.telefono, '333 111');
  assert.equal(rita.note, 'consegna al sabato');
  // l'ordine 4 era di "Mamma": ora è di Mamma Rita (stesso id)
  assert.equal(scalar(n, 'SELECT contatto_id FROM ordini WHERE id = 4'), rita.id);
  assert.equal(scalar(n, 'SELECT contatto_id FROM ordini WHERE id = 5'), rita.id);
  assert.equal(all(n, "SELECT email FROM contatti WHERE nome = 'Giulia Nuova'")[0].email, 'g@x.it');
  assert.equal(rep.conteggi.contattiInRubrica, 5);
  assert.equal(rep.anomalie.find((a) => /non in rubrica/.test(a.tipo)), undefined); // tutto coperto
  assert.ok(righeReport(rep).extra.some((t) => /5 contatti letti dalla rubrica/.test(t)));
});

test('import: nomi negli ordini non in rubrica vengono aggiunti e segnalati; senza rubrica come prima', async () => {
  const SQL = await sqlLib();
  const d = vecchio(SQL);
  d.run("INSERT INTO TabContatti(Nome) VALUES ('Stanhome')");
  const n = new SQL.Database();
  const rep = migraDaB4A(d, n);
  assert.deepEqual(nomi(n), ['io', 'Mamma', 'Mamma Rita', 'Rossi Mario', 'Stanhome']);
  const a = rep.anomalie.find((x) => /non in rubrica/.test(x.tipo));
  assert.equal(a.n, 4);
  // un solo contatto, tipo C di default per la riga di rubrica senza tipo
  assert.equal(all(n, "SELECT tipo FROM contatti WHERE nome = 'Stanhome'")[0].tipo, 'C');

  const vuota = vecchio(SQL); // rubrica vuota
  const n2 = new SQL.Database();
  const rep2 = migraDaB4A(vuota, n2);
  assert.equal(rep2.conteggi.contatti, 5); // Stanhome, Rossi Mario (due scritture unite), Mamma, Mamma Rita, io
});

test('leggiRubrica e alias', async () => {
  const SQL = await sqlLib();
  const d = new SQL.Database();
  assert.deepEqual(leggiRubrica(d), []); // niente tabella
  d.run("CREATE TABLE TabContatti (Nome TEXT, Telefono TEXT, Indirizzo TEXT, Email TEXT); INSERT INTO TabContatti VALUES ('  Anna  ', '1', '', ''), ('', '2', '', ''), (NULL, '', '', '')");
  const r = leggiRubrica(d); // vecchio formato, senza Tipo/Note/Alias
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].nome, r[0].tipo, r[0].telefono, r[0].alias], ['Anna', 'C', '1', []]);
  assert.deepEqual(elencoAlias(' a | b ;c\nd '), ['a', 'b', 'c', 'd']);
  assert.deepEqual(elencoAlias(null), []);
});

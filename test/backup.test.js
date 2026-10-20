import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlLib } from './helpers.js';
import { creaSchema, SCHEMA_VERSION } from '../src/db/schema.js';
import { migraDaB4A } from '../src/db/migrate-b4a.js';
import {
  nomeFileBackup, riconosciFile, controllaDbNuovo, descriviDb, dbVuoto, righeReport, serializzaReport, leggiReport,
} from '../src/db/backup.js';
import { run, scalar } from '../src/db/util.js';
import { ErroreDominio } from '../src/domain/errori.js';

/** Piccolo database nel formato della vecchia app B4A, con dati inventati. */
function vecchioPiccolo(SQL) {
  const d = new SQL.Database();
  d.run(`CREATE TABLE TabOrdini (Numero INTEGER, Verso TEXT, DataEmissione TEXT, DataEvasione TEXT, Contatto TEXT, Catalogo TEXT, Note TEXT, Evaso TEXT, Totale TEXT);
    CREATE TABLE TabDettaglioOrdini (Ordine INTEGER, Codice TEXT, NomeProdotto TEXT, Prezzo TEXT, IDMagazzinoAssociato INTEGER, Nuovo INTEGER);
    CREATE TABLE TabMagazzino (Codice TEXT, NomeProdotto TEXT, Posizione TEXT, PrezzoIn TEXT, OrdineIn TEXT, InMagazzino TEXT, OrdineOut TEXT, PrezzoOut TEXT, Note TEXT);`);
  d.run("INSERT INTO TabOrdini VALUES (1,'A','01.10.2026','05.10.2026','Stanhome','c10','','S','10')");
  d.run("INSERT INTO TabOrdini VALUES (2,'V','06.10.2026','','Rossi Mario','c10','','N',NULL)");
  d.run("INSERT INTO TabOrdini VALUES (3,'V','07.10.2026','','rossi  mario','c10','','N',NULL)");
  d.run("INSERT INTO TabDettaglioOrdini VALUES (1,'1001','Degreaser 1000 ml','10',0,0)");
  d.run("INSERT INTO TabDettaglioOrdini VALUES (2,'1001','Degreaser 1000 ml','10',1,1)");
  d.run("INSERT INTO TabMagazzino VALUES ('1001','Degreaser 1000 ml','Temporanea','10','1','si','',NULL,'')");
  return d;
}

test('nome del file di backup', () => {
  assert.equal(nomeFileBackup(new Date(2026, 9, 20, 11, 2)), 'magazzino-2026-10-20-1102.db');
  assert.equal(nomeFileBackup(new Date(2026, 0, 5, 9, 7)), 'magazzino-2026-01-05-0907.db');
});

test('riconoscimento del tipo di file', async () => {
  const SQL = await sqlLib();
  const nuovo = new SQL.Database();
  creaSchema(nuovo);
  assert.equal(riconosciFile(SQL, nuovo.export()), 'nuovo');
  assert.equal(riconosciFile(SQL, vecchioPiccolo(SQL).export()), 'b4a');
  assert.equal(riconosciFile(SQL, new SQL.Database().export()), null); // database vuoto
  assert.equal(riconosciFile(SQL, new Uint8Array(2000).fill(7)), null); // non è SQLite
  assert.equal(riconosciFile(SQL, new TextEncoder().encode('ciao, sono un testo')), null);
  assert.equal(riconosciFile(SQL, new Uint8Array(0)), null);
});

test('controllo di un backup della nuova app', async () => {
  const SQL = await sqlLib();
  const d = new SQL.Database();
  creaSchema(d);
  assert.doesNotThrow(() => controllaDbNuovo(d));

  // versione più recente dell'app
  run(d, "UPDATE meta SET valore = ? WHERE chiave = 'schema_version'", [String(SCHEMA_VERSION + 1)]);
  assert.throws(() => controllaDbNuovo(d), (e) => e instanceof ErroreDominio && /più recente/.test(e.message));
  run(d, "UPDATE meta SET valore = ? WHERE chiave = 'schema_version'", [String(SCHEMA_VERSION)]);

  // posizione speciale mancante
  run(d, 'DELETE FROM posizioni WHERE speciale = 1');
  assert.throws(() => controllaDbNuovo(d), (e) => e instanceof ErroreDominio && /Da collocare/.test(e.message));

  // tabella mancante
  const monco = new SQL.Database();
  monco.run("CREATE TABLE meta (chiave TEXT PRIMARY KEY, valore TEXT); CREATE TABLE righe_ordine (id INTEGER)");
  assert.throws(() => controllaDbNuovo(monco), (e) => e instanceof ErroreDominio && /mancano/.test(e.message));
});

test('backup e ripristino: i dati tornano uguali', async () => {
  const SQL = await sqlLib();
  const d = new SQL.Database();
  creaSchema(d);
  assert.ok(dbVuoto(d));
  run(d, "INSERT INTO contatti(nome, tipo) VALUES ('Rossi Mario', 'C')");
  run(d, "INSERT INTO meta(chiave, valore) VALUES ('ultimo_backup', '2026-10-20T09:00:00.000Z') ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore");
  assert.ok(!dbVuoto(d));

  const ripreso = new SQL.Database(d.export());
  controllaDbNuovo(ripreso);
  assert.deepEqual(descriviDb(ripreso), { ordini: 0, prodotti: 0, contatti: 1, ultimoBackup: '2026-10-20T09:00:00.000Z' });
  assert.equal(scalar(ripreso, "SELECT nome FROM contatti WHERE tipo = 'C'"), 'Rossi Mario');
});

test('import del vecchio DB: report leggibile e salvabile', async () => {
  const SQL = await sqlLib();
  const nuovo = new SQL.Database();
  const report = migraDaB4A(vecchioPiccolo(SQL), nuovo);
  controllaDbNuovo(nuovo); // il risultato dell'import è un database valido della nuova app

  const r = righeReport(report);
  const n = (testo) => r.conteggi.find((c) => c.testo === testo)?.n;
  assert.equal(n('ordini'), 3);
  assert.equal(n('prodotto in archivio'), 1);
  assert.equal(n('prodotto ancora in magazzino'), 1);
  // "Rossi Mario" e "rossi  mario" sono lo stesso contatto
  assert.equal(n('contatti'), 2);
  assert.ok(r.extra.some((t) => /unite in 2/.test(t)));
  assert.ok(Array.isArray(r.anomalie));

  const salvato = leggiReport(serializzaReport(report));
  assert.deepEqual(salvato.report, report);
  assert.ok(Number.isFinite(Date.parse(salvato.quando)));
  assert.equal(leggiReport(''), null);
  assert.equal(leggiReport('non è json'), null);
  assert.equal(leggiReport('{"x":1}'), null);
});

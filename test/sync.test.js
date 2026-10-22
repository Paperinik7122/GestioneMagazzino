// Prove del collegamento con il server: la logica pura e poi due "dispositivi" contro il servizio Python vero.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sqlLib } from './helpers.js';
import { creaSchema } from '../src/db/schema.js';
import { controllaDbNuovo, descriviDb, dbVuoto, ultimaModificaDb } from '../src/db/backup.js';
import { all, run, transaction } from '../src/db/util.js';
import { decidiConnessione } from '../src/sync/decisione.js';
import { creaSync } from '../src/sync/sync.js';
import { creaRemoto, ErroreRemoto, normalizzaCodice } from '../src/sync/remoto.js';
import { bloccaScrittura, sbloccaScrittura } from '../src/sync/sola-lettura.js';
import { ErroreDominio } from '../src/domain/errori.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, '../server/magazzino_server.py');
const haPython = spawnSync('python3', ['--version']).status === 0;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ---------------------------------------------------------------- logica pura

test('decisione al collegamento', () => {
  const d = (cfg, server, localeVuoto = false, haBase = false) => decidiConnessione({ cfg: { archivio: '', rev: 0, sporco: false, ...cfg }, server, localeVuoto, haBase });
  const srv = (revisione, archivio = 'A') => ({ archivio, revisione });

  // primo collegamento
  assert.equal(d({}, srv(0), true).azione, 'inizia-vuoto');
  assert.equal(d({}, srv(0), false).azione, 'carica');
  assert.equal(d({}, srv(5), true).azione, 'scarica');
  assert.deepEqual(d({}, srv(5), false), { azione: 'scegli', motivo: 'primo-collegamento' });

  // già collegato
  const c = { archivio: 'A', rev: 5 };
  assert.equal(d(c, srv(5)).azione, 'niente');
  assert.equal(d({ ...c, sporco: true }, srv(5)).azione, 'carica');
  assert.equal(d(c, srv(7)).azione, 'scarica');
  assert.deepEqual(d({ ...c, sporco: true }, srv(7)), { azione: 'scegli', motivo: 'modificati' }); // senza la copia di base non si può unire
  assert.deepEqual(d({ ...c, sporco: true }, srv(7), false, true), { azione: 'unisci' });
  assert.equal(d(c, srv(7), false, true).azione, 'scarica'); // nessuna modifica di qui: basta prendere i dati nuovi
  assert.deepEqual(d(c, srv(3)), { azione: 'scegli', motivo: 'server-indietro' });

  // il server è un altro (cartella dati ricreata): come un primo collegamento
  assert.equal(d(c, srv(1, 'B'), false).azione, 'scegli');
  assert.equal(d({ ...c, sporco: true }, srv(0, 'B'), false).azione, 'carica');

  // dati locali spariti (pulizia del browser) ma "collegato": si riprendono dal server
  assert.equal(d(c, srv(5), true).azione, 'scarica');
  assert.equal(d({ ...c, sporco: true }, srv(5), true).azione, 'scarica');
});

test('normalizzazione del codice', () => {
  assert.equal(normalizzaCodice(' abcd-efgh jkmn\n'), 'ABCDEFGHJKMN');
  assert.equal(normalizzaCodice(null), '');
});

test('sola lettura: si consulta, non si scrive', async () => {
  const SQL = await sqlLib();
  const db = new SQL.Database();
  creaSchema(db);
  run(db, "INSERT INTO contatti(nome, tipo) VALUES ('Rossi', 'C')");
  bloccaScrittura(db, 'Sei offline');
  assert.equal(all(db, 'SELECT nome FROM contatti')[0].nome, 'Rossi');
  assert.throws(() => run(db, "INSERT INTO contatti(nome, tipo) VALUES ('Bianchi', 'C')"), (e) => e instanceof ErroreDominio && e.message === 'Sei offline');
  assert.throws(() => transaction(db, () => run(db, "DELETE FROM contatti")), ErroreDominio);
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM contatti')[0].n, 1);
  // anche saltando il blocco, SQLite stesso rifiuta
  assert.throws(() => SQL.Database.prototype.run.call(db, "DELETE FROM contatti"), /readonly/i);
  assert.ok(db.export().length > 0); // il backup si può fare
  sbloccaScrittura(db);
  run(db, "INSERT INTO contatti(nome, tipo) VALUES ('Bianchi', 'C')");
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM contatti')[0].n, 2);
});

// ---------------------------------------------------------------- dispositivi contro il servizio vero

async function avviaServer() {
  const dati = fs.mkdtempSync(path.join(os.tmpdir(), 'magazzino-test-'));
  const out = execFileSync('python3', [SERVER, '--dati', dati, 'nuovo-codice'], { encoding: 'utf8' });
  const codice = out.match(/[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}/)[0];
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn('python3', [SERVER, '--dati', dati, 'avvia', '--porta', String(porta)], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${porta}/api/`;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${base}ping`)).ok) break; } catch { /* non è ancora pronto */ }
    await sleep(100);
  }
  return { base, codice, dati, ferma() { proc.kill(); fs.rmSync(dati, { recursive: true, force: true }); } };
}

/** Un telefono/iPad finto: stesso codice dell'app, ma database in memoria e memoria di configurazione finta. */
async function dispositivo(server, { dati = false, cfg = {} } = {}) {
  const SQL = await sqlLib();
  const stato = { db: new SQL.Database(), cfg, sostituzioni: [], giu: false, occupato: false, base: null };
  creaSchema(stato.db);
  if (dati) run(stato.db, "INSERT INTO contatti(nome, tipo) VALUES ('Già qui', 'C')");
  const fetchFn = (...a) => (stato.giu ? Promise.reject(new TypeError('rete assente')) : fetch(...a));
  stato.remoto = creaRemoto({ base: server.base, fetchFn });
  stato.sync = creaSync({
    remoto: stato.remoto,
    config: {
      leggi: () => ({ codice: '', archivio: '', rev: 0, sporco: false, serverNoto: false, quando: null, ...stato.cfg }),
      scrivi: (c) => { stato.cfg = c; },
    },
    getDb: () => stato.db,
    esporta: () => stato.db.export(),
    apriBytes: (b) => { const d = new SQL.Database(b); controllaDbNuovo(d); return d; },
    descrivi: (d) => ({ ...descriviDb(d), ultimaModifica: ultimaModificaDb(d) }),
    vuoto: dbVuoto,
    sostituisci: async (nuovo, { conserva }) => { stato.sostituzioni.push({ conserva }); stato.db = nuovo; },
    leggiBase: async () => stato.base,
    salvaBase: async (bytes, rev, archivio) => { stato.base = { bytes, rev, archivio }; },
    blocca: (d) => bloccaScrittura(d, 'offline'),
    sblocca: sbloccaScrittura,
  });
  stato.sync.collega({ occupato: () => stato.occupato });
  stato.nomi = () => all(stato.db, "SELECT nome FROM contatti ORDER BY nome").map((r) => r.nome);
  /** Fa una modifica come la fa l'app: scrive nel database e avvisa. */
  stato.aggiungi = (nome) => { run(stato.db, "INSERT INTO contatti(nome, tipo) VALUES (?, 'C')", [nome]); stato.sync.modificato(); };
  stato.server = async (codice = server.codice) => {
    const r = await stato.remoto.scarica(codice);
    const d = new SQL.Database(r.bytes);
    return { revisione: r.revisione, nomi: all(d, 'SELECT nome FROM contatti ORDER BY nome').map((x) => x.nome) };
  };
  return stato;
}

/** Memoria di un dispositivo che ha già il codice (e sa che il server esiste). */
const conCodice = (server, extra = {}) => ({ codice: normalizzaCodice(server.codice), serverNoto: true, ...extra });

const conServer = (nome, fn) => test(nome, { skip: !haPython && 'serve python3' }, async () => {
  const server = await avviaServer();
  try { await fn(server); } finally { server.ferma(); }
});

conServer('senza servizio l’app resta come prima (solo su questo dispositivo)', async () => {
  const d = await dispositivo({ base: 'http://127.0.0.1:1/api/' });
  await d.sync.avvia();
  assert.equal(d.sync.stato.modo, 'nessuno');
  assert.ok(!d.sync.attivo);
  d.aggiungi('X'); // non succede nulla di strano
  assert.equal(d.cfg?.sporco, undefined);
});

conServer('il codice: senza, sbagliato, giusto', async (server) => {
  const d = await dispositivo(server);
  await d.sync.avvia();
  assert.equal(d.sync.stato.modo, 'accesso');

  await d.sync.inviaCodice('sbagliato');
  assert.equal(d.sync.stato.modo, 'accesso');
  assert.match(d.sync.stato.errore, /non valido/);
  assert.equal(d.cfg.codice, ''); // un codice sbagliato non resta memorizzato

  await d.sync.inviaCodice(server.codice.toLowerCase().replaceAll('-', ' '));
  assert.equal(d.sync.stato.modo, 'ok');
  assert.equal(d.cfg.codice, normalizzaCodice(server.codice));
});

conServer('due dispositivi: le modifiche dell’uno arrivano all’altro', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  assert.equal(a.sync.stato.modo, 'ok'); // server e dispositivo vuoti: si parte
  assert.equal((await a.remoto.stato(normalizzaCodice(server.codice))).revisione, 0);

  a.aggiungi('Rossi Mario');
  assert.ok(a.sync.stato.sporco);
  await a.sync.pushOra();
  assert.ok(!a.sync.stato.sporco);
  assert.deepEqual(await a.server(), { revisione: 1, nomi: ['Rossi Mario'] });

  // l'iPad, vuoto, si collega e riceve i dati
  const b = await dispositivo(server, { cfg: conCodice(server) });
  await b.sync.avvia();
  assert.equal(b.sync.stato.modo, 'ok');
  assert.deepEqual(b.nomi(), ['Rossi Mario']);
  assert.deepEqual(b.sostituzioni, [{ conserva: false }]);

  // il telefono aggiunge, l'iPad se ne accorge quando ricontrolla
  a.aggiungi('Bianchi Anna');
  await a.sync.pushOra();
  b.occupato = true; // sta scrivendo: non si cambiano i dati sotto i suoi occhi
  await b.sync.controlla();
  assert.deepEqual(b.nomi(), ['Rossi Mario']);
  b.occupato = false;
  const prima = b.sync.stato.aggiornamenti;
  await b.sync.controlla();
  assert.deepEqual(b.nomi(), ['Bianchi Anna', 'Rossi Mario']);
  assert.equal(b.sync.stato.aggiornamenti, prima + 1);
  assert.equal(b.sync.stato.rev, 2);
});

conServer('più modifiche ravvicinate partono insieme (a ogni modifica non un invio)', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  for (const n of ['A', 'B', 'C']) a.aggiungi(n);
  await a.sync.pushOra();
  assert.deepEqual(await a.server(), { revisione: 1, nomi: ['A', 'B', 'C'] });
});

conServer('modifica in parallelo: le due modifiche si uniscono da sole', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  const b = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  await b.sync.avvia();
  a.aggiungi('Base');
  await a.sync.pushOra();
  await b.sync.controlla();
  assert.deepEqual(b.nomi(), ['Base']);

  b.aggiungi('Dall’iPad');
  await b.sync.pushOra();
  a.aggiungi('Dal telefono'); // il telefono non sapeva che l'iPad aveva salvato
  await a.sync.pushOra();
  assert.equal(a.sync.stato.modo, 'ok');
  assert.ok(!a.sync.stato.sporco);
  assert.deepEqual(a.nomi(), ['Base', 'Dal telefono', 'Dall’iPad']);
  assert.deepEqual((await a.server()).nomi, ['Base', 'Dal telefono', 'Dall’iPad']);
  assert.equal(a.sync.stato.unione.voci.length, 0);
  assert.equal(a.sync.stato.unione.mie, 1);
  assert.equal(a.sync.stato.unione.loro, 1);
  assert.deepEqual(a.sostituzioni.at(-1), { conserva: true }); // i dati di prima restano recuperabili

  await b.sync.controlla();
  assert.deepEqual(b.nomi(), ['Base', 'Dal telefono', 'Dall’iPad']);
});

conServer('stesso nome creato in parallelo e id uguali: nessun dato perso, riferimenti giusti', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  const b = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  await b.sync.avvia();
  a.aggiungi('Uno');
  await a.sync.pushOra();
  await b.sync.controlla();
  // stesso numero interno (id 2) su entrambi, nomi diversi; e un contatto con lo stesso nome
  a.aggiungi('Solo A');
  a.aggiungi('Comune');
  b.aggiungi('Solo B');
  b.aggiungi('comune ');
  await b.sync.pushOra();
  await a.sync.pushOra();
  assert.equal(a.sync.stato.modo, 'ok');
  assert.deepEqual(a.nomi().map((n) => n.trim().toLowerCase()), ['comune', 'solo a', 'solo b', 'uno']); // resta la scrittura già sul server
  assert.ok(a.sync.stato.unione.voci.some((v) => /stesso nome/.test(v.testo)));
  assert.equal(all(a.db, 'SELECT COUNT(DISTINCT id) AS n FROM contatti')[0].n, 4);
});

conServer('modifica in parallelo senza la copia di base: si sceglie quale versione tenere (e l’altra non va persa)', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  const b = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  await b.sync.avvia();
  a.aggiungi('Base');
  await a.sync.pushOra();
  await b.sync.controlla();
  assert.deepEqual(b.nomi(), ['Base']);

  // l'iPad salva per primo; il telefono, che non lo sapeva, ha una sua modifica
  b.aggiungi('Dall’iPad');
  await b.sync.pushOra();
  a.base = null; // per esempio i dati del sito cancellati solo in parte
  a.aggiungi('Dal telefono');
  await a.sync.pushOra();
  assert.equal(a.sync.stato.modo, 'scelta');
  assert.equal(a.sync.solaLettura, true);
  assert.equal(a.sync.stato.scelta.motivo, 'modificati');
  assert.equal(a.sync.stato.scelta.server.contatti, 2);
  assert.equal(a.sync.stato.scelta.locale.contatti, 2);
  assert.deepEqual((await a.server()).nomi, ['Base', 'Dall’iPad']); // il server non è stato toccato

  // tiene i dati del server: la propria modifica resta recuperabile (conserva: true)
  await a.sync.scegli('server');
  assert.equal(a.sync.stato.modo, 'ok');
  assert.deepEqual(a.nomi(), ['Base', 'Dall’iPad']);
  assert.deepEqual(a.sostituzioni.at(-1), { conserva: true });
  assert.ok(!a.sync.stato.sporco);

  // stessa situazione, ma stavolta vince il dispositivo
  b.aggiungi('Ancora iPad');
  await b.sync.pushOra();
  a.base = null;
  a.aggiungi('Ancora telefono');
  await a.sync.pushOra();
  assert.equal(a.sync.stato.modo, 'scelta');
  await a.sync.scegli('locale');
  assert.equal(a.sync.stato.modo, 'ok');
  assert.deepEqual((await a.server()).nomi, ['Ancora telefono', 'Base', 'Dall’iPad']);
  // la versione sostituita è nello storico del server
  const storico = execFileSync('python3', [SERVER, '--dati', server.dati, 'storico'], { encoding: 'utf8' });
  assert.ok(storico.split('\n').filter(Boolean).length >= 1);
});

conServer('primo collegamento: dati su entrambe le parti, decide l’utente', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  a.aggiungi('Sul server');
  await a.sync.pushOra();

  const nuovo = await dispositivo(server, { dati: true, cfg: conCodice(server) }); // ha già dati suoi (prima si usava solo in locale)
  await nuovo.sync.avvia();
  assert.equal(nuovo.sync.stato.modo, 'scelta');
  assert.equal(nuovo.sync.stato.scelta.motivo, 'primo-collegamento');
  assert.deepEqual(nuovo.nomi(), ['Già qui']); // finché non sceglie, non cambia nulla
  assert.throws(() => run(nuovo.db, "DELETE FROM contatti"), ErroreDominio); // e non si può modificare
  await nuovo.sync.scegli('server');
  assert.deepEqual(nuovo.nomi(), ['Sul server']);
});

conServer('primo collegamento con server vuoto: i dati di questo dispositivo vanno sul server', async (server) => {
  const d = await dispositivo(server, { dati: true, cfg: conCodice(server) });
  await d.sync.avvia();
  assert.equal(d.sync.stato.modo, 'ok');
  assert.deepEqual(await d.server(), { revisione: 1, nomi: ['Già qui'] });
});

conServer('offline: si continua a lavorare, le modifiche arrivano al ritorno della rete', async (server) => {
  const d = await dispositivo(server, { cfg: conCodice(server) });
  await d.sync.avvia();
  d.aggiungi('Uno');
  await d.sync.pushOra();

  d.aggiungi('Due'); // la rete cade proprio ora
  d.giu = true;
  await d.sync.pushOra();
  assert.equal(d.sync.stato.modo, 'offline');
  assert.ok(d.sync.stato.sporco);
  assert.equal(d.sync.solaLettura, false); // già allineato una volta: si può modificare
  d.aggiungi('Tre'); // modifica fatta offline
  d.aggiungi('Quattro');
  assert.deepEqual(d.nomi(), ['Due', 'Quattro', 'Tre', 'Uno']);

  await d.sync.controlla(); // ancora giù
  assert.equal(d.sync.stato.modo, 'offline');
  assert.ok(d.sync.stato.sporco);

  d.giu = false;
  await d.sync.controlla();
  assert.equal(d.sync.stato.modo, 'ok');
  assert.ok(!d.sync.stato.sporco);
  assert.deepEqual((await d.server()).nomi, ['Due', 'Quattro', 'Tre', 'Uno']);
});

conServer('due dispositivi modificano offline e poi tornano online: tutto si unisce', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  const b = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  await b.sync.avvia();
  a.aggiungi('Base');
  await a.sync.pushOra();
  await b.sync.controlla();

  a.giu = true;
  b.giu = true;
  a.aggiungi('Telefono 1');
  b.aggiungi('iPad 1');
  await a.sync.controlla();
  await b.sync.controlla();
  assert.equal(a.sync.stato.modo, 'offline');
  a.aggiungi('Telefono 2');
  b.aggiungi('iPad 2');

  a.giu = false; // torna prima il telefono
  await a.sync.controlla();
  assert.equal(a.sync.stato.modo, 'ok');
  assert.ok(!a.sync.stato.sporco);
  assert.deepEqual((await a.server()).nomi, ['Base', 'Telefono 1', 'Telefono 2']);

  b.giu = false; // poi l'iPad: il server ha già le modifiche del telefono
  await b.sync.controlla();
  assert.equal(b.sync.stato.modo, 'ok');
  assert.ok(!b.sync.stato.sporco);
  assert.deepEqual(b.nomi(), ['Base', 'iPad 1', 'iPad 2', 'Telefono 1', 'Telefono 2']);
  assert.deepEqual((await b.server()).nomi, ['Base', 'iPad 1', 'iPad 2', 'Telefono 1', 'Telefono 2']);

  await a.sync.controlla();
  assert.deepEqual(a.nomi(), ['Base', 'iPad 1', 'iPad 2', 'Telefono 1', 'Telefono 2']);
});

conServer('l’unione non parte mentre l’utente sta scrivendo: le modifiche aspettano', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  const b = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  await b.sync.avvia();
  b.aggiungi('Dall’iPad');
  await b.sync.pushOra();
  a.occupato = true;
  a.aggiungi('Dal telefono');
  await a.sync.pushOra(); // il server rifiuta (è cambiato): ma l'utente sta scrivendo
  assert.deepEqual(a.nomi(), ['Dal telefono']);
  assert.ok(a.sync.stato.sporco);
  a.occupato = false;
  await a.sync.controlla();
  assert.deepEqual(a.nomi(), ['Dal telefono', 'Dall’iPad']);
  assert.deepEqual((await a.server()).nomi, ['Dal telefono', 'Dall’iPad']);
});

conServer('avvio senza rete dopo che il server era già noto: si apre e si può modificare', async (server) => {
  const d = await dispositivo(server, { cfg: conCodice(server, { archivio: 'X', rev: 3 }) });
  d.giu = true;
  await d.sync.avvia();
  assert.equal(d.sync.stato.modo, 'offline');
  assert.equal(d.sync.solaLettura, false);
  d.aggiungi('Offline');
  assert.ok(d.sync.stato.sporco);
});

conServer('mai allineato e offline: sola lettura (non si hanno dati sicuri da cui partire)', async (server) => {
  const d = await dispositivo(server, { cfg: conCodice(server) });
  d.giu = true;
  await d.sync.avvia();
  assert.equal(d.sync.stato.modo, 'offline');
  assert.equal(d.sync.solaLettura, true);
  assert.throws(() => run(d.db, "DELETE FROM contatti"), ErroreDominio);
});

conServer('codice cambiato sul server: si richiede il nuovo, i dati locali non si toccano', async (server) => {
  const d = await dispositivo(server, { cfg: conCodice(server) });
  await d.sync.avvia();
  d.aggiungi('Mio');
  await d.sync.pushOra();
  execFileSync('python3', [SERVER, '--dati', server.dati, 'nuovo-codice']); // il Pi ha un codice nuovo (il servizio lo rilegge solo al riavvio)
  d.sync.cambiaCodice();
  assert.equal(d.sync.stato.modo, 'accesso');
  assert.deepEqual(d.nomi(), ['Mio']);
  assert.equal(d.cfg.codice, '');
});

conServer('il server rifiuta un database vuoto sopra dati veri', async (server) => {
  const a = await dispositivo(server, { cfg: conCodice(server) });
  await a.sync.avvia();
  a.aggiungi('Dato vero');
  await a.sync.pushOra();
  const SQL = await sqlLib();
  const vuoto = new SQL.Database();
  creaSchema(vuoto);
  await assert.rejects(a.remoto.carica(normalizzaCodice(server.codice), vuoto.export(), 1), (e) => e instanceof ErroreRemoto && e.tipo === 'rifiutato');
  assert.deepEqual((await a.server()).nomi, ['Dato vero']);
});

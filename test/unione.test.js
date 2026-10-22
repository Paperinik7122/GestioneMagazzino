// Prove dell'unione a tre vie: base, "mio" (questo dispositivo) e "loro" (server) -> un solo database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlLib } from './helpers.js';
import { creaSchema } from '../src/db/schema.js';
import { all, get, run } from '../src/db/util.js';
import { unisci } from '../src/sync/unione.js';

const SQL = await sqlLib();

/** Database di partenza: un contatto, un fornitore, due ordini, un prodotto in magazzino. */
function partenza() {
  const db = new SQL.Database();
  creaSchema(db);
  run(db, "INSERT INTO contatti(id, uid, nome, tipo, telefono, updated_at) VALUES (1,'c-rossi','Rossi','C','111',1000), (2,'c-stan','Stanhome','F','',1000)");
  run(db, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id, updated_at) VALUES (1,'o-1','V','2026-10-01',1,1000), (2,'o-2','A','2026-10-02',2,1000)");
  run(db, "INSERT INTO magazzino(id, uid, codice, nome, posizione_id, updated_at) VALUES (1,'m-1','100','Crema',1,1000), (2,'m-2','200','Sapone',1,1000)");
  run(db, "INSERT INTO righe_ordine(id, uid, ordine_id, codice, nome, prezzo, updated_at) VALUES (1,'r-1',1,'100','Crema',10,1000)");
  return db;
}
const copia = (db) => new SQL.Database(db.export());
const nomi = (db) => all(db, 'SELECT nome FROM contatti ORDER BY nome').map((r) => r.nome);

function esegui(modificaMio = () => {}, modificaLoro = () => {}) {
  const base = partenza();
  const mio = copia(base);
  const loro = copia(base);
  modificaMio(mio);
  modificaLoro(loro);
  return { ...unisci({ base, mio, loro }), base, mio };
}

test('niente da unire: se non ho cambiato nulla restano i dati del server, e viceversa', () => {
  const a = esegui(() => {}, (l) => run(l, "INSERT INTO contatti(uid, nome, tipo) VALUES ('c-x','Nuovo','C')"));
  assert.deepEqual(nomi(a.db), ['Nuovo', 'Rossi', 'Stanhome']);
  assert.equal(a.report.voci.length, 0);
  const b = esegui((m) => run(m, "INSERT INTO contatti(uid, nome, tipo) VALUES ('c-y','Mio','C')"));
  assert.deepEqual(nomi(b.db), ['Mio', 'Rossi', 'Stanhome']);
  assert.equal(b.report.voci.length, 0);
});

test('righe diverse aggiunte da entrambe le parti: ci sono tutte, i collegamenti restano giusti', () => {
  const { db, report } = esegui(
    (m) => {
      run(m, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-mio','V','2026-10-10',1)");
      run(m, "INSERT INTO righe_ordine(id, uid, ordine_id, codice, nome, prezzo) VALUES (2,'r-mio',3,'300','Mio prodotto',5)");
    },
    (l) => {
      run(l, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-loro','V','2026-10-11',2)");
      run(l, "INSERT INTO righe_ordine(id, uid, ordine_id, codice, nome, prezzo) VALUES (2,'r-loro',3,'400','Loro prodotto',7)");
    },
  );
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM ordini')[0].n, 4);
  const loro = get(db, "SELECT id FROM ordini WHERE uid = 'o-loro'");
  const mio = get(db, "SELECT id FROM ordini WHERE uid = 'o-mio'");
  assert.equal(loro.id, 3); // chi era già sul server tiene il numero
  assert.equal(mio.id, 4); // il mio prende il primo libero
  assert.equal(get(db, "SELECT ordine_id AS o FROM righe_ordine WHERE uid = 'r-mio'").o, 4);
  assert.equal(get(db, "SELECT ordine_id AS o FROM righe_ordine WHERE uid = 'r-loro'").o, 3);
  assert.equal(get(db, "SELECT contatto_id AS c FROM ordini WHERE uid = 'o-mio'").c, 1);
  assert.ok(report.voci.some((v) => /ordine n\. 3 creato su questo dispositivo ora è il n\. 4/.test(v.testo)));
});

test('campi diversi della stessa riga: si tengono entrambe le modifiche', () => {
  const { db, report } = esegui(
    (m) => run(m, "UPDATE contatti SET telefono = '999', updated_at = 2000 WHERE uid = 'c-rossi'"),
    (l) => run(l, "UPDATE contatti SET indirizzo = 'Via Roma', updated_at = 3000 WHERE uid = 'c-rossi'"),
  );
  const r = get(db, "SELECT telefono, indirizzo FROM contatti WHERE uid = 'c-rossi'");
  assert.deepEqual({ ...r }, { telefono: '999', indirizzo: 'Via Roma' });
  assert.equal(report.voci.length, 0);
});

test('stesso campo cambiato in due modi: vince il più recente e lo si dice', () => {
  const { db, report } = esegui(
    (m) => run(m, "UPDATE contatti SET telefono = '222', updated_at = 5000 WHERE uid = 'c-rossi'"),
    (l) => run(l, "UPDATE contatti SET telefono = '333', updated_at = 4000 WHERE uid = 'c-rossi'"),
  );
  assert.equal(get(db, "SELECT telefono AS t FROM contatti WHERE uid = 'c-rossi'").t, '222');
  assert.equal(report.voci.length, 1);
  assert.match(report.voci[0].testo, /Il contatto «Rossi»: telefono cambiato in due modi/);
});

test('eliminazione: vale se l’altra parte non ha toccato la riga; se l’ha modificata la riga resta', () => {
  const a = esegui(
    (m) => { run(m, "DELETE FROM righe_ordine"); run(m, "DELETE FROM magazzino WHERE uid = 'm-2'"); },
    (l) => run(l, "UPDATE contatti SET telefono = '5', updated_at = 9000 WHERE uid = 'c-rossi'"),
  );
  assert.equal(all(a.db, 'SELECT COUNT(*) AS n FROM righe_ordine')[0].n, 0);
  assert.equal(all(a.db, 'SELECT COUNT(*) AS n FROM magazzino')[0].n, 1);
  assert.equal(a.report.voci.length, 0);

  const b = esegui(
    (m) => run(m, "DELETE FROM magazzino WHERE uid = 'm-2'"),
    (l) => run(l, "UPDATE magazzino SET nome = 'Sapone liquido', updated_at = 9000 WHERE uid = 'm-2'"),
  );
  assert.equal(get(b.db, "SELECT nome FROM magazzino WHERE uid = 'm-2'").nome, 'Sapone liquido');
  assert.match(b.report.voci[0].testo, /era stato eliminato su questo dispositivo ma modificato/);
});

test('stesso nome creato su due dispositivi: un contatto solo, gli ordini seguono', () => {
  const { db, report } = esegui(
    (m) => {
      run(m, "INSERT INTO contatti(id, uid, nome, tipo, telefono) VALUES (3,'c-bianchi-mio','Bianchi','C','')");
      run(m, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-b-mio','V','2026-10-10',3)");
    },
    (l) => run(l, "INSERT INTO contatti(id, uid, nome, tipo, telefono) VALUES (3,'c-bianchi-loro','  bianchi ','C','0555')"),
  );
  assert.equal(all(db, "SELECT COUNT(*) AS n FROM contatti WHERE lower(trim(nome)) = 'bianchi'")[0].n, 1);
  const c = get(db, "SELECT id, telefono FROM contatti WHERE nome LIKE '%ianchi%'");
  assert.equal(c.telefono, '0555');
  assert.equal(get(db, "SELECT contatto_id AS c FROM ordini WHERE uid = 'o-b-mio'").c, c.id);
  assert.ok(report.voci.some((v) => /creato su due dispositivi con lo stesso nome/.test(v.testo)));
});

test('un prodotto assegnato a due ordini: resta il collegamento più vecchio', () => {
  const { db, report } = esegui(
    (m) => {
      run(m, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-mio','V','2026-10-10',1)");
      run(m, "INSERT INTO righe_ordine(id, uid, ordine_id, codice, nome, prezzo, magazzino_id, updated_at) VALUES (2,'r-mio',3,'200','Sapone',4,2,7000)");
    },
    (l) => {
      run(l, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-loro','V','2026-10-10',1)");
      run(l, "INSERT INTO righe_ordine(id, uid, ordine_id, codice, nome, prezzo, magazzino_id, updated_at) VALUES (2,'r-loro',3,'200','Sapone',4,2,6000)");
    },
  );
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM righe_ordine WHERE magazzino_id IS NOT NULL')[0].n, 1);
  assert.equal(get(db, "SELECT magazzino_id AS m FROM righe_ordine WHERE uid = 'r-loro'").m, get(db, "SELECT id FROM magazzino WHERE uid = 'm-2'").id);
  assert.equal(get(db, "SELECT magazzino_id AS m FROM righe_ordine WHERE uid = 'r-mio'").m, null);
  assert.match(report.voci[0].testo, /assegnato a due ordini/);
});

test('prodotto consegnato su un dispositivo e assegnato a un altro ordine altrove: resta all’ordine consegnato, anche se il collegamento dell’altro è più vecchio', () => {
  const { db, report } = esegui(
    (m) => {
      run(m, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id, evaso, data_evasione) VALUES (3,'o-mio','V','2026-10-10',1,1,'2026-10-20')");
      run(m, "INSERT INTO righe_ordine(id, uid, ordine_id, codice, nome, prezzo, magazzino_id, updated_at) VALUES (2,'r-mio',3,'200','Sapone',4,2,7000)");
      run(m, "UPDATE magazzino SET in_magazzino = 0, ordine_out = 3, updated_at = 7000 WHERE uid = 'm-2'");
    },
    (l) => {
      run(l, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-loro','V','2026-10-10',1)");
      run(l, "INSERT INTO righe_ordine(id, uid, ordine_id, codice, nome, prezzo, magazzino_id, updated_at) VALUES (2,'r-loro',3,'200','Sapone',4,2,6000)");
    },
  );
  assert.equal(get(db, "SELECT magazzino_id AS m FROM righe_ordine WHERE uid = 'r-loro'").m, null);
  const mio = get(db, "SELECT r.magazzino_id AS m, o.evaso AS e FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id WHERE r.uid = 'r-mio'");
  assert.equal(mio.m, get(db, "SELECT id FROM magazzino WHERE uid = 'm-2'").id);
  assert.equal(mio.e, 1);
  assert.equal(get(db, "SELECT ordine_out AS o FROM magazzino WHERE uid = 'm-2'").o, get(db, "SELECT id FROM ordini WHERE uid = 'o-mio'").id);
  assert.ok(report.voci.length >= 1);
});

test('contatto eliminato qui ma usato da un nuovo ordine altrove: viene rimesso', () => {
  const { db, report } = esegui(
    (m) => { run(m, "DELETE FROM righe_ordine"); run(m, "DELETE FROM ordini WHERE uid = 'o-1'"); run(m, "DELETE FROM contatti WHERE uid = 'c-rossi'"); },
    (l) => run(l, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-nuovo','V','2026-10-12',1)"),
  );
  assert.deepEqual(nomi(db), ['Rossi', 'Stanhome']);
  assert.equal(get(db, "SELECT c.nome FROM ordini o JOIN contatti c ON c.id = o.contatto_id WHERE o.uid = 'o-nuovo'").nome, 'Rossi');
  assert.ok(report.voci.some((v) => /Il contatto «Rossi» era stato eliminato ma c’è qualcosa di nuovo/.test(v.testo)));
});

test('stesso ordine fornitore ricevuto su due dispositivi: si segnala, non si cancella nulla', () => {
  const ricevi = (db, uid) => {
    run(db, "UPDATE ordini SET evaso = 1, data_evasione = '2026-10-20', updated_at = 8000 WHERE uid = 'o-2'");
    run(db, `INSERT INTO magazzino(uid, codice, nome, posizione_id, ordine_in) VALUES ('${uid}','500','Nuovo',1,2)`);
  };
  const { db, report } = esegui((m) => ricevi(m, 'm-mio'), (l) => ricevi(l, 'm-loro'));
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM magazzino WHERE codice = ?', ['500'])[0].n, 2);
  assert.ok(report.voci.some((v) => /risulta ricevuto su due dispositivi/.test(v.testo)));
});

test('i riferimenti restano coerenti (nessun puntatore nel vuoto) e il risultato si può riunire senza novità', () => {
  const { db, base, mio } = esegui(
    (m) => {
      run(m, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-mio','V','2026-10-10',1)");
      run(m, "UPDATE magazzino SET posizione_id = 1, note = 'mia', updated_at = 3000 WHERE uid = 'm-1'");
    },
    (l) => {
      run(l, "INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (3,'o-loro','V','2026-10-11',2)");
      run(l, "UPDATE ordini SET note = 'loro', updated_at = 3000 WHERE uid = 'o-1'");
    },
  );
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM ordini WHERE contatto_id NOT IN (SELECT id FROM contatti)')[0].n, 0);
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM righe_ordine WHERE ordine_id NOT IN (SELECT id FROM ordini)')[0].n, 0);
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM magazzino WHERE posizione_id NOT IN (SELECT id FROM posizioni)')[0].n, 0);
  assert.equal(get(db, "SELECT note FROM magazzino WHERE uid = 'm-1'").note, 'mia');
  assert.equal(get(db, "SELECT note FROM ordini WHERE uid = 'o-1'").note, 'loro');
  // se ora un altro unisce lo stesso risultato con la base di prima, non cambia nulla
  const di_nuovo = unisci({ base, mio: copia(mio), loro: copia(db) });
  assert.equal(all(di_nuovo.db, 'SELECT COUNT(*) AS n FROM ordini')[0].n, 4);
  assert.equal(di_nuovo.report.voci.length, 0);
});

test('il numero ordine nuovo non si duplica anche con tre dispositivi in fila', () => {
  const base = partenza();
  const crea = (uid, num) => {
    const d = copia(base);
    run(d, `INSERT INTO ordini(id, uid, tipo, data_emissione, contatto_id) VALUES (${num},'${uid}','V','2026-10-10',1)`);
    return d;
  };
  const server = crea('o-a', 3);
  const dopoB = unisci({ base, mio: crea('o-b', 3), loro: server }).db; // B si unisce al server
  const dopoC = unisci({ base, mio: crea('o-c', 3), loro: dopoB }).db; // poi C
  const numeri = all(dopoC, 'SELECT id FROM ordini ORDER BY id').map((r) => r.id);
  assert.deepEqual(numeri, [1, 2, 3, 4, 5]);
});

// ---------------------------------------------------------------- con le vere operazioni dell'app

test('operazioni vere su due dispositivi offline: ordini, collegamenti e consegna si uniscono senza incoerenze', async () => {
  const { creaOrdine, aggiungiRighe, collegaRiga, consegnaOrdine, dettaglioOrdine } = await import('../src/domain/ordini.js');
  const { creaProdotti } = await import('../src/domain/magazzino.js');

  const base = new SQL.Database();
  creaSchema(base);
  creaProdotti(base, { codice: 'A1', nome: 'Crema mani', quantita: 2, prezzoAcquisto: 8, dataAcquisto: '2026-09-01' });
  const o1 = creaOrdine(base, { tipo: 'V', contatto: 'Rossi', data: '2026-10-01' });
  aggiungiRighe(base, o1, { codice: 'A1', nome: 'Crema mani', prezzo: 10 });

  const prodotti = all(base, 'SELECT id FROM magazzino ORDER BY id').map((r) => r.id);
  const riga1 = get(base, 'SELECT id FROM righe_ordine').id;

  // telefono: assegna il primo prodotto all'ordine di Rossi e lo consegna; poi un ordine nuovo per Bianchi
  const telefono = copia(base);
  collegaRiga(telefono, riga1, prodotti[0]);
  consegnaOrdine(telefono, o1, '2026-10-20');
  const oTel = creaOrdine(telefono, { tipo: 'V', contatto: 'Bianchi', data: '2026-10-21' });
  aggiungiRighe(telefono, oTel, { codice: 'A1', nome: 'Crema mani', prezzo: 10 });

  // iPad (già sul server): un ordine nuovo per Verdi che prende lo STESSO primo prodotto
  const ipad = copia(base);
  const oIpad = creaOrdine(ipad, { tipo: 'V', contatto: 'Verdi', data: '2026-10-21' });
  const [rIpad] = aggiungiRighe(ipad, oIpad, { codice: 'A1', nome: 'Crema mani', prezzo: 10 });
  collegaRiga(ipad, rIpad, prodotti[0]);
  assert.equal(oTel, oIpad); // stesso numero d'ordine creato in due posti

  const { db, report } = unisci({ base, mio: telefono, loro: ipad });

  const ordini = all(db, 'SELECT id, contatto_id FROM ordini ORDER BY id');
  assert.deepEqual(ordini.map((o) => o.id), [1, 2, 3]);
  const nomeOrdine = (id) => get(db, 'SELECT c.nome FROM ordini o JOIN contatti c ON c.id = o.contatto_id WHERE o.id = ?', [id]).nome;
  assert.equal(nomeOrdine(2), 'Verdi'); // quello già sul server tiene il suo numero
  assert.equal(nomeOrdine(3), 'Bianchi'); // quello arrivato dopo prende il successivo
  assert.equal(dettaglioOrdine(db, 3).righe.length, 1);
  assert.equal(get(db, 'SELECT in_magazzino AS i, ordine_out AS o FROM magazzino WHERE id = ?', [prodotti[0]]).i, 0);
  assert.equal(get(db, 'SELECT ordine_out AS o FROM magazzino WHERE id = ?', [prodotti[0]]).o, 1);
  // il prodotto consegnato a Rossi non resta anche assegnato a Verdi
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM righe_ordine WHERE magazzino_id = ? AND ordine_id = 2', [prodotti[0]])[0].n, 0);
  assert.ok(report.voci.some((v) => /era assegnato a due ordini: resta con la riga A1 dell’ordine n\. 1/.test(v.testo)));
  assert.ok(report.voci.some((v) => /ordine n\. 2 creato su questo dispositivo ora è il n\. 3/.test(v.testo)));
  // nessun riferimento nel vuoto
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM righe_ordine WHERE ordine_id NOT IN (SELECT id FROM ordini)')[0].n, 0);
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM ordini WHERE contatto_id NOT IN (SELECT id FROM contatti)')[0].n, 0);
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM magazzino WHERE ordine_out IS NOT NULL AND ordine_out NOT IN (SELECT id FROM ordini)')[0].n, 0);
});

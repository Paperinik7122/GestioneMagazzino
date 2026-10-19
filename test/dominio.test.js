import test from 'node:test';
import assert from 'node:assert/strict';
import { apriVecchio, nuovoVuoto } from './helpers.js';
import { migraDaB4A } from '../src/db/migrate-b4a.js';
import { all, get, scalar } from '../src/db/util.js';
import { disponibilita, cercaCodici } from '../src/domain/codici.js';
import {
  creaOrdine, aggiungiRighe, collegaRiga, scollegaRiga, consegnaOrdine, elencoOrdini, dettaglioOrdine, eliminaRiga, eliminaOrdine,
} from '../src/domain/ordini.js';
import {
  impostaQuantitaRicevuta, aggiungiOmaggio, chiudiRicezione, proposteAutocompila, applicaAutocompila,
} from '../src/domain/ricezione.js';
import { elencoMagazzino, riepilogoMagazzino, dettaglioCodice, creaProdotti, segnaUscita, eliminaProdotto } from '../src/domain/magazzino.js';
import { elencoPosizioni, creaPosizione, eliminaPosizione, rinominaPosizione, idDaCollocare } from '../src/domain/posizioni.js';
import { ErroreDominio } from '../src/domain/errori.js';

async function db() {
  const v = await apriVecchio();
  const n = await nuovoVuoto();
  migraDaB4A(v, n);
  return n;
}
const OGGI = '2026-10-19';

test('disponibilità: stesso codice e simili, senza scegliere al posto dell’utente', async () => {
  const d = await db();
  const disp = disponibilita(d, '25689');
  assert.equal(disp.nStesso, 1);
  assert.equal(disp.simili.length, 1);
  assert.equal(disp.simili[0].codice, '21371');
  assert.equal(disp.simili[0].prodotti.length, 5);
  assert.equal(disp.nSimili, 5);
  // ordinati per data (senza data in fondo) e poi per prezzo
  const prezzi = disp.simili[0].prodotti.map((p) => p.prezzo_acquisto);
  assert.deepEqual(prezzi, [6, 6, 6, 7, 7]);
});

test('ordine cliente: collegamento manuale, vincoli e consegna', async () => {
  const d = await db();
  const prima = riepilogoMagazzino(d);
  const id = creaOrdine(d, { tipo: 'V', contatto: 'Mamma', data: OGGI, catalogo: 'c3' });
  assert.equal(get(d, 'SELECT catalogo FROM ordini WHERE id = ?', [id]).catalogo, 'C3');
  const [riga] = aggiungiRighe(d, id, { codice: '25689', nome: 'degreaser 1000ml', prezzo: '6,50', quantita: 1 });
  const [riga2] = aggiungiRighe(d, id, { codice: '25689', nome: 'degreaser 1000ml', prezzo: 6.5 });

  // la riga vede disponibili e simili ma NON è collegata da sola
  let det = dettaglioOrdine(d, id);
  assert.equal(det.righe[0].magazzino_id, null);
  assert.deepEqual(det.righe[0].disp, { nStesso: 1, nSimili: 5, nImpegnati: 0 });
  assert.equal(det.puoConsegnare, false);
  await assert.rejects(async () => consegnaOrdine(d, id, OGGI), ErroreDominio);

  // collego il prodotto dello stesso codice e uno simile scelto a mano
  collegaRiga(d, riga, 1393);
  const simile = disponibilita(d, '25689').simili[0].prodotti[0].id;
  collegaRiga(d, riga2, simile);

  // un prodotto già assegnato non si può dare a un'altra riga
  const id2 = creaOrdine(d, { tipo: 'V', contatto: 'Mamma', data: OGGI });
  const [r3] = aggiungiRighe(d, id2, { codice: '25689', nome: 'degreaser 1000ml', prezzo: 6.5 });
  assert.throws(() => collegaRiga(d, r3, 1393), /già assegnato all’ordine #/);
  // un prodotto di un codice non equivalente non è ammesso
  const altro = get(d, "SELECT id FROM magazzino WHERE in_magazzino = 1 AND codice = '21797' LIMIT 1").id;
  assert.throws(() => collegaRiga(d, r3, altro), /né un codice simile/);

  // ora i due prodotti risultano impegnati
  assert.equal(disponibilita(d, '25689').nStesso, 0);
  assert.equal(disponibilita(d, '25689').nImpegnati, 1);
  assert.equal(disponibilita(d, '25689').nSimili, 4);

  det = dettaglioOrdine(d, id);
  assert.equal(det.puoConsegnare, true);
  assert.equal(consegnaOrdine(d, id, OGGI), 13);

  const m = get(d, 'SELECT * FROM magazzino WHERE id = 1393');
  assert.equal(m.in_magazzino, 0);
  assert.equal(m.ordine_out, id);
  assert.equal(m.prezzo_out, 6.5);
  assert.equal(m.data_uscita, OGGI);
  assert.equal(get(d, 'SELECT evaso, totale, data_evasione FROM ordini WHERE id = ?', [id]).evaso, 1);
  assert.equal(riepilogoMagazzino(d).prodotti, prima.prodotti - 2);
  // un ordine chiuso non si modifica
  assert.throws(() => aggiungiRighe(d, id, { codice: '25689', nome: 'x', prezzo: 1 }), /già chiuso/);

  // scollegare libera il prodotto
  scollegaRiga(d, r3); // non collegata: nessun effetto
  eliminaRiga(d, r3);
  eliminaOrdine(d, id2);
  assert.equal(scalar(d, 'SELECT COUNT(*) FROM ordini WHERE id = ?', [id2]), 0);
});

test('elenco ordini: etichette per tipo e conteggi', async () => {
  const d = await db();
  const lista = elencoOrdini(d, {});
  assert.deepEqual(lista.map((o) => o.id).sort(), [354, 362, 363, 364]);
  const o354 = lista.find((o) => o.id === 354);
  assert.equal(o354.tipo, 'V');
  assert.equal(o354.collegate, 2);
  assert.equal(o354.daOrdinare, 0);
  const o362 = lista.find((o) => o.id === 362);
  assert.equal(o362.nRighe, 12);
  assert.ok(o362.daOrdinare >= 8);
  assert.equal(lista.find((o) => o.id === 364).tipo, 'A');
  assert.equal(lista.find((o) => o.id === 364).ricevute, 0);
  assert.equal(elencoOrdini(d, { testo: 'orisei' }).length, 1);
  assert.equal(elencoOrdini(d, { tipi: ['A'], conEvasi: true }).length, 98);
});

test('ricezione parziale con omaggio, stralcio e ingresso in "Da collocare"', async () => {
  const d = await db();
  const id = creaOrdine(d, { tipo: 'A', contatto: 'stanhome', data: OGGI, catalogo: 'C4' });
  aggiungiRighe(d, id, { codice: '26707', nome: 'blue drop nuovo', prezzo: 7.99, quantita: 5 });
  aggiungiRighe(d, id, { codice: '27784', nome: 'degreaser refill', prezzo: 10.9, quantita: 1 });
  assert.throws(() => impostaQuantitaRicevuta(d, id, '26707', 6), /da 0 a 5/);
  impostaQuantitaRicevuta(d, id, '26707', 3);
  impostaQuantitaRicevuta(d, id, '27784', 0);
  aggiungiOmaggio(d, id, { codice: 'OM-1', nome: 'Campioncino omaggio', quantita: 2 });

  const det = dettaglioOrdine(d, id);
  const g = det.gruppi.find((x) => x.codice === '26707');
  assert.equal(g.quantita, 5);
  assert.equal(g.ricevute, 3);
  assert.equal(det.gruppi.find((x) => x.omaggio).quantita, 2);

  const prima = riepilogoMagazzino(d);
  const res = chiudiRicezione(d, id, OGGI);
  assert.deepEqual({ a: res.arrivati, s: res.stralciati }, { a: 5, s: 3 });
  assert.equal(res.totale, 23.97); // 3 x 7,99 + omaggi a zero

  const dopo = riepilogoMagazzino(d);
  assert.equal(dopo.prodotti, prima.prodotti + 5);
  assert.equal(dopo.daCollocare, prima.daCollocare + 5);
  const nuovi = all(d, 'SELECT * FROM magazzino WHERE ordine_in = ?', [id]);
  assert.equal(nuovi.length, 5);
  assert.ok(nuovi.every((m) => m.data_acquisto === OGGI && m.catalogo_acquisto === 'C4' && m.posizione_id === idDaCollocare(d)));
  assert.equal(nuovi.filter((m) => m.prezzo_acquisto === 0).length, 2);
  const ord = get(d, 'SELECT * FROM ordini WHERE id = ?', [id]);
  assert.equal(ord.evaso, 1);
  assert.match(ord.note, /Non arrivati: 2 × blue drop nuovo, 1 × degreaser refill/);
  assert.throws(() => chiudiRicezione(d, id, OGGI), /già chiuso/);
});

test('ricezione: se non è arrivato nulla non si chiude', async () => {
  const d = await db();
  const id = creaOrdine(d, { tipo: 'A', contatto: 'stanhome', data: OGGI });
  aggiungiRighe(d, id, { codice: '26707', nome: 'blue drop nuovo', prezzo: 7.99 });
  assert.throws(() => chiudiRicezione(d, id, OGGI), /Nessun prodotto risulta arrivato/);
});

test('autocompila: propone, non conta due volte e non sceglie i simili', async () => {
  const d = await db();
  // ordine cliente nuovo che chiede 2 degreaser 25689: 1 libero + 5 simili 21371
  const c = creaOrdine(d, { tipo: 'V', contatto: 'Anna', data: OGGI, catalogo: 'C2' });
  aggiungiRighe(d, c, { codice: '25689', nome: 'degreaser 1000ml', prezzo: 6.5, quantita: 3 });
  const a = creaOrdine(d, { tipo: 'A', contatto: 'stanhome', data: OGGI, catalogo: 'C2' });
  const p = proposteAutocompila(d, a).find((x) => x.codice === '25689');
  assert.equal(p.richiesti, 3);
  assert.equal(p.liberi, 1);
  assert.equal(p.mancanti, 2);
  assert.equal(p.prezzo, 6.5);
  assert.equal(p.simili[0].codice, '21371'); // solo segnalati
  assert.equal(p.cataloghiDiversi, false);

  // lo stesso prodotto già presente nell'ordine fornitore 364 non viene proposto di nuovo
  const gia = proposteAutocompila(d, a).find((x) => x.codice === '25653');
  const n364 = scalar(d, "SELECT COUNT(*) FROM righe_ordine WHERE ordine_id = 364 AND codice = '25653'");
  assert.equal(n364, 2);
  assert.ok(!gia || gia.giaOrdinati >= 2);

  // applico con quantità modificata dall'utente
  const n = applicaAutocompila(d, a, [{ codice: '25689', quantita: 1 }]);
  assert.equal(n, 1);
  assert.equal(scalar(d, 'SELECT COUNT(*) FROM righe_ordine WHERE ordine_id = ? AND ricevuta = 0', [a]), 1);
  // rieseguire la proposta ora conta la riga appena aggiunta
  assert.equal(proposteAutocompila(d, a).find((x) => x.codice === '25689').mancanti, 1);

  // se la riga cliente usa un catalogo diverso lo segnala
  const a2 = creaOrdine(d, { tipo: 'A', contatto: 'stanhome', data: OGGI, catalogo: 'C9' });
  assert.equal(proposteAutocompila(d, a2).find((x) => x.codice === '25689').cataloghiDiversi, true);
});

test('magazzino: elenco, filtri, inventario e uscite', async () => {
  const d = await db();
  const tutto = elencoMagazzino(d, {});
  assert.equal(tutto.reduce((s, r) => s + r.quantita, 0), 193);
  assert.equal(elencoMagazzino(d, { posizioneId: 'da_collocare' }).reduce((s, r) => s + r.quantita, 0), 13);
  assert.ok(elencoMagazzino(d, { testo: "100%'; DROP TABLE magazzino;--" }).length === 0);
  assert.equal(scalar(d, 'SELECT COUNT(*) FROM magazzino') > 0, true);

  const scatola2 = elencoPosizioni(d).find((p) => p.nome === 'Scatola 2');
  const ids = creaProdotti(d, { codice: 'T-1', nome: "dell'ultimo", quantita: 3, posizioneId: scatola2.id, prezzoAcquisto: '4,5', dataAcquisto: OGGI, motivoIn: 'Trovato' });
  assert.equal(ids.length, 3);
  const det = dettaglioCodice(d, 'T-1');
  assert.equal(det.nome, "dell'ultimo");
  assert.equal(det.prodotti.length, 3);
  assert.equal(det.prezzoMin, 4.5);
  assert.throws(() => creaProdotti(d, { codice: 'T-2', nome: 'x', posizioneId: 99999 }), /dall’elenco/);
  assert.throws(() => creaProdotti(d, { codice: 'T-2', nome: 'x', quantita: 0 }), /quantità/);

  segnaUscita(d, [ids[0]], 'Usato', OGGI);
  assert.equal(get(d, 'SELECT in_magazzino, motivo_out FROM magazzino WHERE id = ?', [ids[0]]).motivo_out, 'Usato');
  // un prodotto impegnato non esce né si elimina
  const impegnato = get(d, 'SELECT magazzino_id AS id FROM righe_ordine WHERE ordine_id = 354 LIMIT 1').id;
  assert.throws(() => segnaUscita(d, [impegnato], 'Perso', OGGI), /assegnato all’ordine #354/);
  assert.throws(() => eliminaProdotto(d, impegnato), /assegnato all’ordine #354/);
  eliminaProdotto(d, ids[1]);
  assert.equal(scalar(d, 'SELECT COUNT(*) FROM magazzino WHERE id = ?', [ids[1]]), 0);
});

test('posizioni: elenco chiuso, niente doppioni, eliminazione solo se vuote', async () => {
  const d = await db();
  const pos = elencoPosizioni(d);
  assert.equal(pos[0].nome, 'Da collocare');
  assert.equal(pos[0].n_prodotti, 13);
  assert.throws(() => creaPosizione(d, 'scatola 1'), /esiste già/);
  const nuova = creaPosizione(d, '  Scatola   8 ');
  assert.equal(get(d, 'SELECT nome FROM posizioni WHERE id = ?', [nuova]).nome, 'Scatola 8');
  rinominaPosizione(d, nuova, 'Scatola 9');
  assert.throws(() => rinominaPosizione(d, pos[0].id, 'Altro'), /non si può rinominare/);
  assert.throws(() => eliminaPosizione(d, pos[0].id), /non si può eliminare/);
  const piena = pos.find((p) => p.nome === 'Scatola 1');
  assert.throws(() => eliminaPosizione(d, piena.id), /ancora 38 prodotti/);
  const vuota = pos.find((p) => p.nome === 'Scatola 5');
  assert.equal(vuota.n_prodotti, 0);
  eliminaPosizione(d, vuota.id);
  assert.equal(scalar(d, 'SELECT COUNT(*) FROM posizioni WHERE id = ?', [vuota.id]), 0);
  // i prodotti già usciti che stavano lì non restano con un riferimento rotto
  assert.equal(scalar(d, 'SELECT COUNT(*) FROM magazzino m WHERE posizione_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM posizioni p WHERE p.id = m.posizione_id)'), 0);
});

test('ricerca codici e nomi con apostrofi e caratteri speciali', async () => {
  const d = await db();
  assert.ok(cercaCodici(d, 'degreaser').length > 0);
  assert.equal(cercaCodici(d, '25689')[0].codice, '25689');
  assert.deepEqual(cercaCodici(d, "%'--"), []);
});

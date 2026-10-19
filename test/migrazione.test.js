import test from 'node:test';
import assert from 'node:assert/strict';
import { apriVecchio, nuovoVuoto } from './helpers.js';
import { migraDaB4A, dataIso, numero, posizioneCanonica } from '../src/db/migrate-b4a.js';
import { chiaveEquivalenza } from '../src/db/normalizza.js';
import { all, scalar } from '../src/db/util.js';

test('helper: date, numeri, posizioni', () => {
  assert.equal(dataIso('13.01.2026'), '2026-01-13');
  assert.equal(dataIso('31.02.2026'), null);
  assert.equal(dataIso(''), null);
  assert.equal(numero('6,5'), 6.5);
  assert.equal(numero(''), null);
  assert.equal(numero(7), 7);
  assert.equal(posizioneCanonica('provvisorio '), 'Da collocare');
  assert.equal(posizioneCanonica('Temporaneo'), 'Da collocare');
  assert.equal(posizioneCanonica('Scatola 2'), 'Scatola 2');
  assert.equal(chiaveEquivalenza('nuovo degreaser 1000ml'), chiaveEquivalenza('Degreaser 1000 ml'));
  assert.notEqual(chiaveEquivalenza('Daily Wash 1500ml'), chiaveEquivalenza('Daily Wash 750ml'));
});

test('migrazione del DB del 17 gen 2026', async () => {
  const vecchio = await apriVecchio();
  const nuovo = await nuovoVuoto();
  const report = migraDaB4A(vecchio, nuovo);
  if (process.env.STAMPA_REPORT) console.log(JSON.stringify(report, null, 1));

  // nessuna riga persa
  assert.equal(scalar(nuovo, 'SELECT COUNT(*) FROM magazzino'), scalar(vecchio, 'SELECT COUNT(*) FROM TabMagazzino'));
  assert.equal(scalar(nuovo, 'SELECT COUNT(*) FROM ordini'), scalar(vecchio, 'SELECT COUNT(*) FROM TabOrdini'));
  assert.equal(scalar(nuovo, 'SELECT COUNT(*) FROM righe_ordine'), scalar(vecchio, 'SELECT COUNT(*) FROM TabDettaglioOrdini'));
  assert.equal(
    scalar(nuovo, 'SELECT COUNT(*) FROM magazzino WHERE in_magazzino = 1'),
    scalar(vecchio, "SELECT COUNT(*) FROM TabMagazzino WHERE InMagazzino = 'si'"),
  );

  // le date sono ISO
  assert.equal(scalar(nuovo, "SELECT COUNT(*) FROM ordini WHERE data_emissione NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'"), 0);

  // posizioni unificate
  const pos = all(nuovo, 'SELECT nome FROM posizioni').map((r) => r.nome);
  assert.ok(pos.includes('Da collocare'));
  assert.ok(!pos.some((p) => /temporane|provvisor/i.test(p)));
  assert.equal(scalar(nuovo, "SELECT COUNT(*) FROM magazzino WHERE in_magazzino = 1 AND posizione_id IS NULL"), 0);

  // ogni prodotto in magazzino con posizione "Da collocare": 8 + 3 + 2 senza posizione
  assert.equal(
    scalar(nuovo, "SELECT COUNT(*) FROM magazzino m JOIN posizioni p ON p.id = m.posizione_id WHERE m.in_magazzino = 1 AND p.speciale = 1"),
    13,
  );

  // un prodotto non è collegato da due righe
  assert.equal(scalar(nuovo, 'SELECT COUNT(*) FROM (SELECT magazzino_id FROM righe_ordine WHERE magazzino_id IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1)'), 0);

  // collegamenti sempre validi
  assert.equal(scalar(nuovo, 'SELECT COUNT(*) FROM righe_ordine r WHERE r.magazzino_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM magazzino m WHERE m.id = r.magazzino_id)'), 0);

  // ordine fornitore aperto 364: 20 righe, tutte da verificare
  const r364 = all(nuovo, 'SELECT ricevuta FROM righe_ordine WHERE ordine_id = 364');
  assert.equal(r364.length, 20);
  assert.ok(r364.every((r) => r.ricevuta === 0));

  // ordine cliente 354: due prodotti impegnati (ancora in magazzino, collegati)
  assert.equal(scalar(nuovo, `SELECT COUNT(*) FROM righe_ordine r JOIN magazzino m ON m.id = r.magazzino_id
      WHERE r.ordine_id = 354 AND m.in_magazzino = 1`), 2);

  // ordini fornitore chiusi: tutte le righe ricevute
  assert.equal(scalar(nuovo, `SELECT COUNT(*) FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
      WHERE o.tipo = 'A' AND o.evaso = 1 AND r.ricevuta = 0`), 0);

  // contatti: unificate le varianti per maiuscole/spazi
  assert.ok(report.conteggi.contatti < report.conteggi.contattiOriginali);
  assert.equal(scalar(nuovo, "SELECT COUNT(*) FROM contatti WHERE nome LIKE 'stanhome%'"), 1);
  assert.equal(scalar(nuovo, "SELECT tipo FROM contatti WHERE nome LIKE 'stanhome%'"), 'F');

  // prodotti equivalenti: i due degreaser sono lo stesso prodotto
  assert.equal(
    scalar(nuovo, "SELECT COUNT(DISTINCT prodotto_id) FROM codici WHERE codice IN ('21371','25689')"),
    1,
  );

  // i prezzi di acquisto non sono stati scontati
  assert.equal(scalar(nuovo, "SELECT prezzo_acquisto FROM magazzino WHERE id = 1393"), 6.5);

  // data di acquisto ricavata dall'ordine fornitore
  const conData = scalar(nuovo, "SELECT COUNT(*) FROM magazzino WHERE ordine_in IS NOT NULL AND data_acquisto IS NOT NULL");
  assert.ok(conData > 600, `prodotti con data: ${conData}`);
});

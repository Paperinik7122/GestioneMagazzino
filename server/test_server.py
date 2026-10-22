"""Prove del servizio: python3 -m unittest server/test_server.py  (oppure: npm run test:server)"""
import gzip
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import magazzino_server as ms  # noqa: E402

CODICE = 'ABCD-EFGH-JKMN-PQRS-TUVW'


def crea_db(percorso, ordini=0, contatti=0):
    Path(percorso).unlink(missing_ok=True)
    con = sqlite3.connect(percorso)
    con.executescript(''.join(f'CREATE TABLE {t} (id INTEGER PRIMARY KEY);' for t in ms.TABELLE_OBBLIGATORIE if t != 'meta'))
    con.execute('CREATE TABLE meta (chiave TEXT PRIMARY KEY, valore TEXT)')
    con.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    for i in range(ordini):
        con.execute('INSERT INTO ordini(id) VALUES (?)', (i + 1,))
    for i in range(contatti):
        con.execute('INSERT INTO contatti(id) VALUES (?)', (i + 1,))
    con.commit()
    con.close()
    return Path(percorso).read_bytes()


class Base(unittest.TestCase):
    def setUp(self):
        ms.PAUSA_ERRORE = 0
        self.cartella = tempfile.TemporaryDirectory()
        self.dati = Path(self.cartella.name) / 'dati'
        self.statici = Path(self.cartella.name) / 'app'
        self.statici.mkdir()
        (self.statici / 'index.html').write_text('<h1>app</h1>')
        (self.statici / 'sql-wasm.wasm').write_bytes(b'\0asm')
        self.srv = ms.crea_server(self.dati, '127.0.0.1', 0, self.statici, intervallo_storico=0)
        self.srv.codice.imposta(CODICE)
        self.srv.tentativi = ms.Tentativi(massimo=5)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.srv.server_address[1]}'

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.cartella.cleanup()

    def chiedi(self, metodo, percorso, corpo=None, codice=CODICE, intestazioni=None):
        h = dict(intestazioni or {})
        if codice:
            h['Authorization'] = f'Bearer {codice}'
        rq = urllib.request.Request(self.url + percorso, data=corpo, method=metodo, headers=h)
        try:
            with urllib.request.urlopen(rq) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def json(self, *a, **k):
        st, corpo, _ = self.chiedi(*a, **k)
        return st, json.loads(corpo)

    def metti(self, dati, base, **k):
        return self.json('PUT', '/api/db', dati, intestazioni={'If-Match': f'"{base}"'}, **k)

    def piccolo(self, nome='x.db', **k):
        return crea_db(Path(self.cartella.name) / nome, **k)


class ProveApi(Base):
    def test_ping_senza_codice(self):
        st, o = self.json('GET', '/api/ping', codice=None)
        self.assertEqual((st, o['servizio']), (200, 'gestione-magazzino'))

    def test_serve_il_codice(self):
        self.assertEqual(self.json('GET', '/api/stato', codice=None)[0], 401)
        self.assertEqual(self.json('GET', '/api/stato', codice='SBAGLIATO')[0], 401)
        self.assertEqual(self.json('GET', '/api/stato')[0], 200)
        # il codice si può scrivere con o senza trattini e in minuscolo
        self.assertEqual(self.json('GET', '/api/stato', codice='abcd efgh jkmn pqrs tuvw')[0], 200)

    def test_troppi_tentativi(self):
        for _ in range(5):
            self.assertEqual(self.json('GET', '/api/stato', codice='NO')[0], 401)
        self.assertEqual(self.json('GET', '/api/stato', codice='NO')[0], 429)
        self.assertEqual(self.json('GET', '/api/stato')[0], 429)  # anche con il codice giusto, finché dura il blocco

    def test_vuoto_all_inizio(self):
        st, o = self.json('GET', '/api/stato')
        self.assertEqual((st, o['revisione'], o['aggiornato']), (200, 0, None))
        self.assertEqual(self.json('GET', '/api/db')[0], 404)

    def test_salva_e_rileggi(self):
        dati = self.piccolo(ordini=2, contatti=1)
        st, o = self.metti(dati, 0)
        self.assertEqual((st, o['revisione']), (200, 1))
        st, corpo, h = self.chiedi('GET', '/api/db')
        self.assertEqual((st, corpo, h['X-Revisione'], h['ETag']), (200, dati, '1', '"1"'))
        self.assertEqual(h['X-Archivio'], self.srv.archivio.id)
        self.assertEqual(self.json('GET', '/api/stato')[1]['revisione'], 1)

    def test_compressione(self):
        dati = self.piccolo(ordini=3)
        st, o = self.json('PUT', '/api/db', gzip.compress(dati), intestazioni={'If-Match': '"0"', 'Content-Encoding': 'gzip'})
        self.assertEqual((st, o['revisione']), (200, 1))
        _, corpo, h = self.chiedi('GET', '/api/db', intestazioni={'Accept-Encoding': 'gzip'})
        self.assertEqual(h['Content-Encoding'], 'gzip')
        self.assertEqual(gzip.decompress(corpo), dati)

    def test_conflitto(self):
        dati = self.piccolo(ordini=1)
        self.assertEqual(self.metti(dati, 0)[0], 200)
        st, o = self.metti(self.piccolo('y.db', ordini=2), 0)  # chi era rimasto alla revisione 0
        self.assertEqual((st, o), (412, {'errore': 'conflitto', 'revisione': 1}))
        self.assertEqual(self.chiedi('GET', '/api/db')[1], dati)  # il server non è stato toccato
        self.assertEqual(self.metti(self.piccolo('y.db', ordini=2), 1)[1]['revisione'], 2)

    def test_senza_revisione_di_partenza(self):
        self.assertEqual(self.json('PUT', '/api/db', self.piccolo())[0], 428)

    def test_file_non_validi(self):
        self.assertEqual(self.metti(b'ciao, non sono un database', 0)[0], 422)
        con = sqlite3.connect(Path(self.cartella.name) / 'z.db')
        con.execute('CREATE TABLE altro (a)')
        con.commit()
        con.close()
        st, o = self.metti((Path(self.cartella.name) / 'z.db').read_bytes(), 0)
        self.assertEqual(st, 422)
        self.assertIn('incompleto', o['messaggio'])
        self.assertEqual(self.json('GET', '/api/stato')[1]['revisione'], 0)

    def test_non_si_sostituisce_con_un_database_vuoto(self):
        self.assertEqual(self.metti(self.piccolo(ordini=1), 0)[0], 200)
        st, o = self.metti(self.piccolo('v.db'), 1)
        self.assertEqual(st, 422)
        self.assertIn('vuoto', o['messaggio'])

    def test_il_primo_invio_puo_essere_vuoto(self):
        self.assertEqual(self.metti(self.piccolo(), 0)[0], 200)

    def test_troppo_grande(self):
        ms_max = ms.MAX_BYTES
        try:
            ms.MAX_BYTES = 100
            self.assertEqual(self.metti(bytes(200), 0)[0], 413)
        finally:
            ms.MAX_BYTES = ms_max

    def test_file_dell_app(self):
        st, corpo, h = self.chiedi('GET', '/', codice=None)
        self.assertEqual((st, corpo), (200, b'<h1>app</h1>'))
        self.assertEqual(h['Cache-Control'], 'no-cache')
        self.assertEqual(self.chiedi('GET', '/sql-wasm.wasm', codice=None)[2]['Content-Type'], 'application/wasm')
        self.assertEqual(self.chiedi('GET', '/../dati/codice.json', codice=None)[0], 404)
        self.assertEqual(self.chiedi('GET', '/%2e%2e/dati/codice.json', codice=None)[0], 404)
        self.assertEqual(self.chiedi('GET', '/niente.txt', codice=None)[0], 404)


class ProveArchivio(Base):
    def test_storico_con_intervallo(self):
        # intervallo 0 (come nel setUp): ogni versione sostituita finisce nello storico
        for i in range(3):
            self.assertEqual(self.metti(self.piccolo(ordini=i + 1), i)[0], 200)
        self.assertEqual([v['revisione'] for v in self.srv.archivio.elenco_storico()], [2, 1])
        self.assertEqual(len(list((self.dati / 'corrente').iterdir())), 1)

    def test_storico_non_si_riempie_di_modifiche_ravvicinate(self):
        a = ms.Archivio(Path(self.cartella.name) / 'altro', intervallo_storico=900)
        base = 0
        for i in range(5):
            tmp = a.tmp / f't{i}.db'
            tmp.write_bytes(self.piccolo(ordini=i + 1))
            base = a.scrivi(tmp, base)
        self.assertEqual(base, 5)
        self.assertEqual(len(a.elenco_storico()), 1)  # solo la prima: le altre erano a meno di 15 minuti

    def test_sostituzione_voluta_finisce_sempre_nello_storico(self):
        a = ms.Archivio(Path(self.cartella.name) / 'altro', intervallo_storico=900)
        base = 0
        for i in range(3):
            tmp = a.tmp / f't{i}.db'
            tmp.write_bytes(self.piccolo(ordini=i + 1))
            base = a.scrivi(tmp, base, forza_storico=(i == 2))
        self.assertEqual([v['revisione'] for v in a.elenco_storico()], [2, 1])

    def test_potatura(self):
        a = self.srv.archivio
        ora = ms.time.time()
        for k in range(ms.COPIE_RECENTI + 10):  # copie a distanza di un'ora l'una dall'altra
            q = ora - k * 3600
            nome = ms.datetime.fromtimestamp(q, ms.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            (a.storico / f'db-{k + 1:06d}_{nome}.db').write_bytes(b'x')
        a._pota()
        n = len(a.elenco_storico())
        self.assertGreaterEqual(n, ms.COPIE_RECENTI)
        self.assertLess(n, ms.COPIE_RECENTI + 10)  # le più vecchie dello stesso giorno sono state tolte

    def test_ripristino(self):
        self.metti(self.piccolo(ordini=1), 0)
        self.metti(self.piccolo(ordini=5), 1)
        voce = self.srv.archivio.elenco_storico()[0]
        nuova = self.srv.archivio.ripristina(voce['nome'])
        self.assertEqual(nuova, 3)
        con = sqlite3.connect(':memory:')
        con.deserialize(self.chiedi('GET', '/api/db')[1])
        self.assertEqual(con.execute('SELECT COUNT(*) FROM ordini').fetchone()[0], 1)
        with self.assertRaises(ms.Rifiutato):
            self.srv.archivio.ripristina('../../etc/passwd')

    def test_identificativo_stabile(self):
        self.assertEqual(ms.Archivio(self.dati).id, self.srv.archivio.id)


class ProveCodice(unittest.TestCase):
    def test_codice_generato(self):
        c = ms.genera_codice()
        self.assertRegex(c, r'^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$')
        self.assertNotRegex(c, '[ILO01]')

    def test_si_salva_solo_l_impronta(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'codice.json'
            cod = ms.Codice(f)
            cod.imposta('AAAA-BBBB')
            self.assertNotIn('AAAA', f.read_text())
            self.assertEqual(oct(f.stat().st_mode)[-3:], '600')
            nuovo = ms.Codice(f)
            self.assertTrue(nuovo.verifica('aaaa bbbb'))
            self.assertFalse(nuovo.verifica('AAAA-BBBC'))
            self.assertFalse(nuovo.verifica(''))


if __name__ == '__main__':
    unittest.main()

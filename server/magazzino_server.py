#!/usr/bin/env python3
"""Servizio di Gestione Magazzino per il Raspberry Pi.

Tiene l'unica copia "ufficiale" del database SQLite e la serve all'app (telefono, iPad, computer).
Usa solo la libreria standard di Python: niente da installare con pip.

Comandi (vedi LEGGIMI.md):
  nuovo-codice          crea (o cambia) il codice di accesso e lo mostra una volta sola
  avvia                 avvia il servizio (predefinito)
  stato                 mostra revisione, dimensione e data dell'ultima modifica
  storico               elenca le copie precedenti conservate
  ripristina NOME       rimette una copia dello storico come versione corrente
"""
import argparse
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import threading
import time
import zlib
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

try:
    import fcntl  # solo Linux/macOS: serve a non far scrivere insieme il servizio e i comandi
except ImportError:  # pragma: no cover
    fcntl = None

VERSIONE_API = 1
PAUSA_ERRORE = 0.5                    # secondi di attesa dopo un codice sbagliato
MAX_BYTES = 32 * 1024 * 1024          # un database di magazzino è di pochi MB: oltre è sicuramente un errore
TABELLE_OBBLIGATORIE = ('meta', 'contatti', 'posizioni', 'prodotti', 'codici', 'ordini', 'magazzino', 'righe_ordine')
INTERVALLO_STORICO = 15 * 60          # secondi: una copia nello storico al massimo ogni 15 minuti
COPIE_RECENTI = 48                    # le ultime copie si tengono tutte...
GIORNI_STORICO = 90                   # ...poi una al giorno per questo numero di giorni
ALFABETO_CODICE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'   # senza I, L, O, 0, 1 (si confondono)
RE_CORRENTE = re.compile(r'^db-(\d{6,})\.db$')
RE_STORICO = re.compile(r'^db-(\d{6,})_(\d{8}T\d{6}Z)\.db$')


class Conflitto(Exception):
    def __init__(self, revisione):
        super().__init__('conflitto')
        self.revisione = revisione


class Rifiutato(Exception):
    """Il database ricevuto non è accettabile; il messaggio è pensato per l'utente."""


# ---------------------------------------------------------------- codice di accesso

def normalizza_codice(testo):
    return re.sub(r'[^A-Za-z0-9]', '', testo or '').upper()


def genera_codice():
    grezzo = ''.join(secrets.choice(ALFABETO_CODICE) for _ in range(20))
    return '-'.join(grezzo[i:i + 4] for i in range(0, 20, 4))


class Codice:
    """Salva solo l'impronta del codice (con sale), mai il codice stesso."""

    def __init__(self, file):
        self.file = Path(file)
        self.sale = None
        self.impronta = None
        if self.file.exists():
            dati = json.loads(self.file.read_text())
            self.sale, self.impronta = dati['sale'], dati['hash']

    @property
    def impostato(self):
        return self.impronta is not None

    @staticmethod
    def _calcola(sale, codice):
        return hashlib.sha256(bytes.fromhex(sale) + normalizza_codice(codice).encode()).hexdigest()

    def imposta(self, codice):
        sale = secrets.token_hex(16)
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix('.tmp')
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({'sale': sale, 'hash': self._calcola(sale, codice)}, f)
        os.replace(tmp, self.file)
        self.sale, self.impronta = sale, self._calcola(sale, codice)

    def verifica(self, codice):
        if not self.impostato or not codice:
            return False
        return hmac.compare_digest(self._calcola(self.sale, codice), self.impronta)


class Tentativi:
    """Dopo troppi codici sbagliati dallo stesso indirizzo si aspetta un po'."""

    def __init__(self, massimo=8, blocco=15 * 60):
        self.massimo, self.blocco = massimo, blocco
        self.stato = {}
        self.lock = threading.Lock()

    def bloccato(self, ip):
        with self.lock:
            n, fino = self.stato.get(ip, (0, 0))
            return n >= self.massimo and time.time() < fino

    def fallito(self, ip):
        with self.lock:
            n, fino = self.stato.get(ip, (0, 0))
            if n >= self.massimo and time.time() >= fino:
                n = 0
            self.stato[ip] = (n + 1, time.time() + self.blocco)

    def riuscito(self, ip):
        with self.lock:
            self.stato.pop(ip, None)


# ---------------------------------------------------------------- archivio dei dati

def _conta(percorso):
    """Controlla che il file sia un database di Gestione Magazzino integro. Restituisce (ordini, prodotti, contatti)."""
    with open(percorso, 'rb') as f:
        if f.read(16) != b'SQLite format 3\x00':
            raise Rifiutato('Il file non è un database SQLite.')
    try:
        con = sqlite3.connect(f'file:{quote(str(percorso))}?mode=ro', uri=True)
        try:
            tabelle = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            mancanti = [t for t in TABELLE_OBBLIGATORIE if t not in tabelle]
            if mancanti:
                raise Rifiutato('Il database è incompleto (mancano: %s).' % ', '.join(mancanti))
            if con.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise Rifiutato('Il database è danneggiato.')
            riga = con.execute("SELECT valore FROM meta WHERE chiave = 'schema_version'").fetchone()
            if not riga or not str(riga[0]).isdigit():
                raise Rifiutato('Il database non indica la versione dello schema.')
            return tuple(con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('ordini', 'magazzino', 'contatti'))
        finally:
            con.close()
    except sqlite3.DatabaseError as e:
        raise Rifiutato('Il database non è leggibile (%s).' % e)


class Archivio:
    """Cartella dei dati: corrente/db-NNNNNN.db (la versione di adesso) e storico/ (le copie precedenti)."""

    def __init__(self, cartella, intervallo_storico=INTERVALLO_STORICO):
        self.base = Path(cartella)
        self.corrente = self.base / 'corrente'
        self.storico = self.base / 'storico'
        self.tmp = self.base / 'tmp'
        for d in (self.corrente, self.storico, self.tmp):
            d.mkdir(parents=True, exist_ok=True)
        self.intervallo_storico = intervallo_storico
        self.lock = threading.Lock()
        file_id = self.base / 'archivio.id'
        if not file_id.exists():
            file_id.write_text(secrets.token_hex(8))
        self.id = file_id.read_text().strip()

    def pulisci_tmp(self):
        """Toglie i file di invii interrotti (solo all'avvio del servizio: un altro processo potrebbe stare scrivendo)."""
        for avanzo in self.tmp.iterdir():
            avanzo.unlink(missing_ok=True)

    @contextmanager
    def _blocco(self):
        with self.lock:
            if fcntl is None:
                yield
                return
            with open(self.base / '.lock', 'a') as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)

    def _attuale(self):
        migliore = (0, None)
        for p in self.corrente.iterdir():
            m = RE_CORRENTE.match(p.name)
            if m and int(m.group(1)) > migliore[0]:
                migliore = (int(m.group(1)), p)
        return migliore

    def stato(self):
        rev, p = self._attuale()
        try:
            st = p.stat() if p else None
        except FileNotFoundError:  # sostituito proprio adesso
            return self.stato()
        return {
            'archivio': self.id,
            'revisione': rev,
            'aggiornato': datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(timespec='seconds') if st else None,
            'dimensione': st.st_size if st else 0,
        }

    def leggi(self):
        for _ in range(5):  # una scrittura in corso può spostare il file tra l'elenco e l'apertura
            rev, p = self._attuale()
            if not p:
                return 0, None
            try:
                return rev, p.read_bytes()
            except FileNotFoundError:
                continue
        raise RuntimeError('Non riesco a leggere il database')

    def scrivi(self, tmp, revisione_base, forza_storico=False):
        """Mette il file tmp come nuova versione, ma solo se partiva dall'ultima revisione (altrimenti Conflitto).
        Con forza_storico la versione sostituita finisce sempre nello storico (sostituzioni volute: import, scelta dell'utente)."""
        conteggi = _conta(tmp)
        with self._blocco():
            rev, p = self._attuale()
            if revisione_base != rev:
                raise Conflitto(rev)
            if p and sum(conteggi) == 0 and sum(_conta(p)) > 0:
                raise Rifiutato('Il database ricevuto è vuoto, mentre sul server ci sono dei dati: non lo sostituisco.')
            return self._sostituisci(tmp, rev, p, forza_storico)

    def _sostituisci(self, tmp, rev, p, forza_storico=False):
        nuova = rev + 1
        dest = self.corrente / f'db-{nuova:06d}.db'
        os.replace(tmp, dest)
        self._fsync_cartella(self.corrente)
        if p:
            self._archivia(rev, p, forza_storico)
        return nuova

    @staticmethod
    def _fsync_cartella(cartella):
        try:
            fd = os.open(cartella, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        except OSError:
            pass

    def _voci_storico(self):
        voci = []
        for p in self.storico.iterdir():
            m = RE_STORICO.match(p.name)
            if m:
                quando = datetime.strptime(m.group(2), '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp()
                voci.append((quando, int(m.group(1)), p))
        return sorted(voci, reverse=True)

    def _archivia(self, rev, p, forza=False):
        quando = p.stat().st_mtime
        voci = self._voci_storico()
        if forza or not voci or quando - voci[0][0] >= self.intervallo_storico:
            nome = datetime.fromtimestamp(quando, timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            os.replace(p, self.storico / f'db-{rev:06d}_{nome}.db')
        else:
            p.unlink()
        self._pota()

    def _pota(self):
        voci = self._voci_storico()
        tieni = {v[2] for v in voci[:COPIE_RECENTI]}
        limite = time.time() - GIORNI_STORICO * 86400
        giorni = set()
        for quando, _, p in voci[COPIE_RECENTI:]:
            giorno = datetime.fromtimestamp(quando, timezone.utc).date()
            if quando >= limite and giorno not in giorni:
                giorni.add(giorno)
                tieni.add(p)
        for _, _, p in voci:
            if p not in tieni:
                p.unlink(missing_ok=True)

    def elenco_storico(self):
        return [
            {'nome': p.name, 'revisione': rev, 'quando': datetime.fromtimestamp(q, timezone.utc).isoformat(timespec='seconds'),
             'dimensione': p.stat().st_size}
            for q, rev, p in self._voci_storico()
        ]

    def ripristina(self, nome):
        """Rimette una copia dello storico come nuova versione corrente (i client la scaricano da soli)."""
        origine = self.storico / Path(nome).name
        if not RE_STORICO.match(origine.name) or not origine.exists():
            raise Rifiutato('Copia non trovata: usa uno dei nomi mostrati da "storico".')
        _conta(origine)
        tmp = self.tmp / f'ripristino-{secrets.token_hex(4)}.db'
        shutil.copyfile(origine, tmp)
        with self._blocco():
            rev, p = self._attuale()
            return self._sostituisci(tmp, rev, p, forza_storico=True)


# ---------------------------------------------------------------- servizio web

class Gestore(SimpleHTTPRequestHandler):
    server_version = 'MagazzinoServer/1'
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.webmanifest': 'application/manifest+json',
                      '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript'}

    # -- utilità
    def _ip(self):
        ip = self.client_address[0]
        if ip in ('127.0.0.1', '::1'):
            ip = self.headers.get('X-Real-IP') or ip   # davanti c'è NGINX
        return ip

    def _json(self, codice, oggetto):
        corpo = json.dumps(oggetto, ensure_ascii=False).encode()
        self.send_response(codice)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(corpo)

    def end_headers(self):
        if getattr(self, '_statico', False):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, 'File non trovato')
        return None

    def _autorizzato(self):
        srv = self.server
        if not srv.codice.impostato:
            self._json(503, {'errore': 'nessun-codice', 'messaggio': 'Sul server manca il codice di accesso (comando nuovo-codice).'})
            return False
        ip = self._ip()
        if srv.tentativi.bloccato(ip):
            self._json(429, {'errore': 'troppi-tentativi', 'messaggio': 'Troppi tentativi sbagliati: riprova tra un quarto d’ora.'})
            return False
        h = self.headers.get('Authorization', '')
        if h.startswith('Bearer ') and srv.codice.verifica(h[7:]):
            srv.tentativi.riuscito(ip)
            return True
        srv.tentativi.fallito(ip)
        time.sleep(PAUSA_ERRORE)
        self._json(401, {'errore': 'accesso', 'messaggio': 'Codice di accesso non valido.'})
        return False

    # -- percorsi
    def do_GET(self):
        percorso = self.path.split('?', 1)[0]
        if percorso == '/api/ping':
            return self._json(200, {'servizio': 'gestione-magazzino', 'api': VERSIONE_API})
        if percorso.startswith('/api/'):
            if not self._autorizzato():
                return None
            if percorso == '/api/stato':
                return self._json(200, self.server.archivio.stato())
            if percorso == '/api/db':
                return self._invia_db()
            return self._json(404, {'errore': 'non-trovato'})
        return self._statico_get()

    do_HEAD = do_GET

    def _statico_get(self):
        if not self.server.statici:
            return self._json(404, {'errore': 'non-trovato'})
        self._statico = True
        return super().do_GET() if self.command == 'GET' else super().do_HEAD()

    def _invia_db(self):
        rev, dati = self.server.archivio.leggi()
        if dati is None:
            return self._json(404, {'errore': 'vuoto', 'messaggio': 'Sul server non ci sono ancora dati.'})
        codifica = None
        if 'gzip' in self.headers.get('Accept-Encoding', ''):
            dati, codifica = gzip.compress(dati, 5), 'gzip'
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(len(dati)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('ETag', f'"{rev}"')
        self.send_header('X-Revisione', str(rev))
        self.send_header('X-Archivio', self.server.archivio.id)
        if codifica:
            self.send_header('Content-Encoding', codifica)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(dati)

    def do_PUT(self):
        percorso = self.path.split('?', 1)[0]
        if percorso != '/api/db':
            return self._json(404, {'errore': 'non-trovato'})
        if not self._autorizzato():
            return None
        base = self.headers.get('If-Match', '').strip().strip('"')
        if not base.isdigit():
            return self._json(428, {'errore': 'base-mancante', 'messaggio': 'Manca la revisione di partenza (If-Match).'})
        try:
            lunghezza = int(self.headers.get('Content-Length', ''))
        except ValueError:
            return self._json(411, {'errore': 'lunghezza', 'messaggio': 'Serve Content-Length.'})
        if lunghezza <= 0 or lunghezza > MAX_BYTES:
            return self._json(413, {'errore': 'troppo-grande', 'messaggio': 'Il database è troppo grande per il server.'})
        dati = self.rfile.read(lunghezza)
        if len(dati) != lunghezza:
            return self._json(400, {'errore': 'incompleto', 'messaggio': 'Invio interrotto.'})
        if self.headers.get('Content-Encoding', '').lower() == 'gzip':
            try:
                dati = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(dati, MAX_BYTES + 1)
            except zlib.error:
                return self._json(400, {'errore': 'compressione', 'messaggio': 'Dati compressi non validi.'})
            if len(dati) > MAX_BYTES:
                return self._json(413, {'errore': 'troppo-grande', 'messaggio': 'Il database è troppo grande per il server.'})
        archivio = self.server.archivio
        tmp = archivio.tmp / f'invio-{secrets.token_hex(6)}.db'
        try:
            with open(tmp, 'wb') as f:
                f.write(dati)
                f.flush()
                os.fsync(f.fileno())
            nuova = archivio.scrivi(tmp, int(base), self.headers.get('X-Storico') == 'forza')
        except Conflitto as c:
            return self._json(412, {'errore': 'conflitto', 'revisione': c.revisione})
        except Rifiutato as e:
            return self._json(422, {'errore': 'rifiutato', 'messaggio': str(e)})
        finally:
            tmp.unlink(missing_ok=True)
        return self._json(200, {'revisione': nuova, 'archivio': archivio.id})

    def log_message(self, formato, *args):
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), formato % args))


def crea_server(cartella_dati, host='127.0.0.1', porta=8090, statici=None, intervallo_storico=INTERVALLO_STORICO):
    dati = Path(cartella_dati).resolve()
    if statici:
        statici = Path(statici).resolve()
        if statici == dati or dati in statici.parents or statici in dati.parents:
            raise SystemExit('La cartella dei dati e quella dell’app devono essere separate (i dati non vanno serviti come file).')
    srv = ThreadingHTTPServer((host, porta), lambda *a, **k: Gestore(*a, directory=str(statici) if statici else None, **k))
    srv.archivio = Archivio(dati, intervallo_storico)
    srv.archivio.pulisci_tmp()
    srv.codice = Codice(dati / 'codice.json')
    srv.tentativi = Tentativi()
    srv.statici = statici
    return srv


# ---------------------------------------------------------------- riga di comando

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--dati', default=os.environ.get('MAGAZZINO_DATI', './dati'), help='cartella dei dati (predefinita: ./dati)')
    sub = p.add_subparsers(dest='comando')
    a = sub.add_parser('avvia', help='avvia il servizio')
    a.add_argument('--host', default='127.0.0.1', help='indirizzo su cui ascoltare (predefinito 127.0.0.1: davanti c’è NGINX)')
    a.add_argument('--porta', type=int, default=8090)
    a.add_argument('--statici', help='cartella dell’app (dist/ o docs/) da servire insieme alle API')
    sub.add_parser('nuovo-codice', help='crea o cambia il codice di accesso')
    sub.add_parser('stato', help='mostra lo stato dei dati')
    sub.add_parser('storico', help='elenca le copie precedenti')
    r = sub.add_parser('ripristina', help='rimette una copia dello storico come versione corrente')
    r.add_argument('nome')
    args = p.parse_args(argv)
    comando = args.comando or 'avvia'
    if comando == 'avvia' and args.comando is None:
        args = p.parse_args(['--dati', args.dati, 'avvia'])

    if comando == 'nuovo-codice':
        codice = genera_codice()
        Archivio(args.dati)  # crea le cartelle
        Codice(Path(args.dati) / 'codice.json').imposta(codice)
        print('Nuovo codice di accesso (scrivilo ora, non viene più mostrato):\n\n    %s\n' % codice)
        print('Va inserito una volta su ogni dispositivo. Quelli già collegati dovranno rimetterlo.')
    elif comando == 'stato':
        print(json.dumps(Archivio(args.dati).stato(), indent=2, ensure_ascii=False))
    elif comando == 'storico':
        for v in Archivio(args.dati).elenco_storico():
            print('%s  rev %-6d %8d byte  %s' % (v['quando'], v['revisione'], v['dimensione'], v['nome']))
    elif comando == 'ripristina':
        try:
            nuova = Archivio(args.dati).ripristina(args.nome)
        except Rifiutato as e:
            sys.exit(str(e))
        print('Ripristinata la copia %s: ora è la revisione %d. I dispositivi si aggiornano da soli.' % (args.nome, nuova))
    else:
        srv = crea_server(args.dati, args.host, args.porta, args.statici)
        if not srv.codice.impostato:
            sys.exit('Manca il codice di accesso: esegui prima "%s --dati %s nuovo-codice".' % (Path(sys.argv[0]).name, args.dati))
        print('Gestione Magazzino: in ascolto su http://%s:%d — dati in %s' % (args.host, args.porta, Path(args.dati).resolve()), flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()

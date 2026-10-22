# Gestione Magazzino sul Raspberry (tappa 1)

I dati veri stanno sul Raspberry; telefono, iPad e computer li leggono e li salvano lì.
Ogni dispositivo tiene anche una copia, così **senza connessione i dati si consultano** (ma non si modificano:
la modifica offline è la tappa 2).

Il servizio è un solo file Python (`magazzino_server.py`), senza nulla da installare con pip, e serve anche l'app
(la cartella `docs/`). Davanti c'è lo stesso NGINX di Home Assistant: nessuna nuova porta aperta verso Internet.

```
telefono / iPad ──HTTPS :8444──► NGINX ──/magazzino/──► servizio Python (127.0.0.1:8090) ──► database
                                  └──────── / ────────► Home Assistant (8123, invariato)
```

## 1. Installare (una volta sola, via SSH)

Controlla che ci sia Python 3.8 o più recente: `python3 --version`.

```bash
# utente dedicato (senza accesso) e cartelle
sudo useradd --system --home /opt/magazzino --shell /usr/sbin/nologin magazzino
sudo mkdir -p /opt/magazzino /mnt/dietpi_userdata/magazzino-dati
sudo chown magazzino:magazzino /mnt/dietpi_userdata/magazzino-dati
sudo chmod 700 /mnt/dietpi_userdata/magazzino-dati

# il programma: scarica il progetto (se il repository è privato usa invece la copia con WinSCP/scp, vedi "Aggiornare")
sudo apt install -y git
sudo git clone --branch pwa-iniziale https://github.com/Paperinik7122/GestioneMagazzino.git /opt/magazzino/repo
```

## 2. Creare il codice di accesso

```bash
sudo -u magazzino python3 /opt/magazzino/repo/server/magazzino_server.py \
  --dati /mnt/dietpi_userdata/magazzino-dati nuovo-codice
```

Mostra un codice tipo `K7QM-2WXE-…`: **scrivilo subito**, non viene più mostrato (sul server resta solo la sua impronta).
Va inserito una volta su ogni dispositivo. Se lo perdi, rilancia lo stesso comando: ne crea uno nuovo e i dispositivi
lo richiederanno (i loro dati non si toccano).

## 3. Far partire il servizio

```bash
sudo cp /opt/magazzino/repo/server/magazzino.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now magazzino
systemctl status magazzino          # deve dire "active (running)"
curl http://127.0.0.1:8090/api/ping # deve rispondere {"servizio": "gestione-magazzino", ...}
```

## 4. Collegarlo a NGINX

Trova il file dove NGINX serve Home Assistant (quello con `proxy_pass http://127.0.0.1:8123`):
`grep -rl 8123 /etc/nginx/`. Dentro il suo blocco `server { … }` incolla il contenuto di
`server/nginx-magazzino.conf`, poi:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Se `nginx -t` segnala un errore, non ricaricare: Home Assistant resta com'è finché non lo ricarichi.

L'app è su `https://IL-TUO-HOSTNAME:8444/magazzino/` (stesso hostname No-IP e stessa porta di Home Assistant).

## 5. Primo collegamento dei dispositivi

1. **Un solo dispositivo per primo** (il più comodo, per esempio l'iPad): apri l'indirizzo, scrivi il codice.
   Il server è vuoto e il dispositivo pure, quindi l'app parte pulita.
2. Su quello stesso dispositivo carica i dati: **Impostazioni → Scegli un file…** e scegli il DB reale (o un backup).
   Dopo la conferma i dati salgono subito sul server.
3. Sugli altri dispositivi (telefono, computer): apri l'indirizzo e scrivi il codice. Hanno la copia vuota, quindi
   scaricano da soli i dati del server.
4. Su iPad/iPhone: Safari → Condividi → **Aggiungi alla schermata Home**; su Android: menu → **Installa app**.

Se un dispositivo ha già dati propri e anche il server ne ha, l'app mostra una schermata con i due riassunti
(ordini, prodotti, contatti, data) e **chiede quale tenere**: i dati scartati restano recuperabili (sul server
nello storico, sul dispositivo da Impostazioni → “Torna ai dati di prima”).

## 6. Come funziona ogni giorno

- Ogni modifica parte verso il server dopo ~1 secondo. Se due dispositivi modificano insieme, il secondo che salva
  non sovrascrive: l'app mostra la scelta (non si perde mai nulla in silenzio).
- Quando torni sull'app, o ogni ~25 secondi, controlla se un altro dispositivo ha salvato e si aggiorna da sola
  (non lo fa mentre stai scrivendo o hai un foglio aperto).
- **Offline** compare l'avviso “puoi solo consultare i dati”; quando torna la rete l'app si ricollega da sola.

## 7. Backup e ripristino sul Raspberry

Il server conserva le versioni precedenti: una ogni ≥15 minuti per le ultime 48, poi una al giorno per 90 giorni.

```bash
CMD="sudo -u magazzino python3 /opt/magazzino/repo/server/magazzino_server.py --dati /mnt/dietpi_userdata/magazzino-dati"
$CMD stato                       # revisione, dimensione, ultima modifica
$CMD storico                     # elenco delle copie precedenti
$CMD ripristina NOME-DEL-FILE    # rimette una copia come versione corrente; i dispositivi si aggiornano da soli
```

Il server rifiuta file che non sono un database valido e rifiuta un database **vuoto** sopra dati veri.
Resta una buona idea un backup ogni tanto conservato altrove (Impostazioni → Backup, oppure copia la cartella
`magazzino-dati`). Se usi già un backup periodico del Raspberry, aggiungi quella cartella.

## 8. Aggiornare l'app

```bash
sudo git -C /opt/magazzino/repo pull          # niente riavvio per l'app; sui dispositivi compare "È disponibile una versione nuova"
sudo systemctl restart magazzino              # solo se è cambiato anche il servizio (server/)
```

Senza git: copia la cartella `docs/` e `server/magazzino_server.py` sul Pi (WinSCP/scp) nelle stesse posizioni.

## Problemi comuni

| Sintomo | Causa e rimedio |
|---|---|
| Pagina “502 Bad Gateway” su /magazzino/ | Il servizio è fermo: `systemctl status magazzino`, `journalctl -u magazzino -n 30` |
| “413” o salvataggio rifiutato dopo molti dati | `client_max_body_size` in NGINX troppo basso (nello snippet è 40m) |
| “Troppi tentativi sbagliati” | Dopo 8 codici errati da uno stesso indirizzo si aspettano 15 minuti |
| “Sul server manca il codice di accesso” | Non è stato eseguito il passo 2 |
| L'app dice sempre offline da fuori casa | Controlla No-IP (da riconfermare ogni 30 giorni) e il port forwarding 8444→443 |
| Non si installa su iPad/iPhone | Serve HTTPS: usa l'indirizzo con hostname e porta 8444, non l'IP di casa |

## Sicurezza in breve

- Dal Pi non esce nulla: il servizio ascolta solo su `127.0.0.1`, vi si arriva solo da NGINX.
- Chi apre l'indirizzo vede l'app (file pubblici, senza dati); i **dati** si leggono solo con il codice.
- Il codice è casuale (circa 100 bit), non si può indovinare; con i tentativi limitati e la pausa dopo ogni errore
  non si può nemmeno provare a forza.
- Il servizio gira con un utente senza privilegi e può scrivere solo nella cartella dei dati.

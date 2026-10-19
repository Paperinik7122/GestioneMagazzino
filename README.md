# GestioneMagazzino
App (PWA) per gestire ordini clienti e fornitori, magazzino e contatti. Funziona anche offline.

## Provarla senza installare Node
La cartella `docs/` contiene l'app già pronta. Serve solo Python:

```
python3 -m http.server 8000 --directory docs
```
(su Windows: `python -m http.server 8000 --directory docs`), poi apri http://localhost:8000.
Non aprire `index.html` con doppio clic: serve un piccolo server.

Per usarla dal telefono/iPad sulla stessa rete Wi‑Fi: `http://<IP-del-computer>:8000`
(senza HTTPS non si può installare né usare offline: per quello serve la pubblicazione, pezzo 5).

## Sviluppo (serve Node)
```
npm install
npm run build:docs   # aggiorna docs/
npm test
```

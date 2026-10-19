# Stato dello sviluppo

App PWA "Gestione Magazzino" (sostituisce l'app B4A). SQLite nel browser (sql.js), offline.

## Fatto
- Schema DB v1, migrazione dal vecchio DB B4A (`src/db/`)
- Logica di dominio completa e testata (`src/domain/`): ordini cliente/fornitore, collegamento manuale, ricezione, autocompila, magazzino, posizioni, contatti
- `src/store.js` (DB + IndexedDB + import/ripristino), `src/ui/kit.js` (icone, formati)
- Pezzo 1 — guscio PWA (`src/app/`): router a `#/…`, barra in basso, foglio dal basso, toast, service worker con avviso di aggiornamento; viste Home, elenco Ordini (filtri, ricerca, nuovo ordine), Contatti (modifica, unisci, elimina). Build: `npm run build` → `dist/`. Provato su telefono e iPad (Chromium).
- Pezzo 2 — schermata ordine (`src/app/viste/ordine.js`): ordine cliente (aggiungi/togli prodotti, collegamento manuale con stesso codice e simili in un'unica schermata, scollega, consegna) e ordine fornitore (ricezione con quantità parziale, prodotto in più/omaggio, autocompila con proposte da confermare, chiusura ricezione con stralcio dei mancanti); modifica ed eliminazione ordine. Flusso completo provato nel browser.
- `docs/` = build pronta da usare con Python (`python3 -m http.server 8000 --directory docs`); rigenerare con `npm run build:docs` a ogni pezzo.
- Suggerimenti sui campi (`src/app/combo.js`, `campi.js`, `src/domain/` nelle funzioni `cercaContatti`, `contattiSimili`, `cercaCodici`): nome cliente/fornitore e codice/nome prodotto si suggeriscono mentre si scrive, ignorando maiuscole, accenti, punteggiatura e spazi; scelto un prodotto si compilano codice, nome e ultimo prezzo. Nomi uguali a meno di spazi/punteggiatura = stesso contatto/codice; se un nome nuovo somiglia a uno esistente l'app chiede "Intendevi…?".

## Da fare (un pezzo alla volta)
3. Magazzino, dettaglio codice, nuovo prodotto, Posizioni
4. Backup, ripristino, import vecchio DB con report
5. Pubblicazione su GitHub Pages

## Note
- Provvisorio da sostituire: `magazzinoProvvisorio` (pezzo 3) in `src/app/viste/segnaposto.js`.
- Il test di dominio/migrazione richiede la fixture; `test/contatti.test.js` no.
- Il DB reale (`*.db`) NON è nel repository (dati personali). Per i test serve `fixtures/old_17gen26.db`.
- Regole di business: vedi README e la nota del progetto Claude.

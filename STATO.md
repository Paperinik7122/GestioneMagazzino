# Stato dello sviluppo

App PWA "Gestione Magazzino" (sostituisce l'app B4A). SQLite nel browser (sql.js), offline.

## Fatto
- Schema DB v1, migrazione dal vecchio DB B4A (`src/db/`)
- Logica di dominio completa e testata (`src/domain/`): ordini cliente/fornitore, collegamento manuale, ricezione, autocompila, magazzino, posizioni, contatti
- `src/store.js` (DB + IndexedDB + import/ripristino), `src/ui/kit.js` (icone, formati)
- Pezzo 1 — guscio PWA (`src/app/`): router a `#/…`, barra in basso, foglio dal basso, toast, service worker con avviso di aggiornamento; viste Home, elenco Ordini (filtri, ricerca, nuovo ordine), Contatti (modifica, unisci, elimina). Build: `npm run build` → `dist/`. Provato su telefono e iPad (Chromium).

## Da fare (un pezzo alla volta)
2. Ordine cliente/fornitore: collega prodotto, ricezione, autocompila
3. Magazzino, dettaglio codice, nuovo prodotto, Posizioni
4. Backup, ripristino, import vecchio DB con report
5. Pubblicazione su GitHub Pages

## Note
- Provvisori da sostituire: `ordineProvvisorio` (pezzo 2) e `magazzinoProvvisorio` (pezzo 3) in `src/app/viste/`.
- Il test di dominio/migrazione richiede la fixture; `test/contatti.test.js` no.
- Il DB reale (`*.db`) NON è nel repository (dati personali). Per i test serve `fixtures/old_17gen26.db`.
- Regole di business: vedi README e la nota del progetto Claude.

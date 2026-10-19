// Schema del database v1 — Magazzino e Ordini.
//
// Convenzioni
// - Date in formato ISO "AAAA-MM-GG" (si ordinano e si filtrano bene).
// - Ogni tabella ha `uid` (identificativo globale) e `updated_at` (millisecondi):
//   servono a una futura sincronizzazione tra telefono e iPad.
// - Un "prodotto" in magazzino è una riga di `magazzino` (come nell'app B4A).
// - Il collegamento riga d'ordine cliente -> prodotto in magazzino sta in UN solo
//   posto: righe_ordine.magazzino_id.
// - Un prodotto è "disponibile" se in_magazzino = 1 e nessuna riga lo ha collegato,
//   "impegnato" se in_magazzino = 1 e una riga lo ha collegato.

export const SCHEMA_VERSION = 1;

export const MOTIVI_ENTRATA = ['Inventario', 'Trovato', 'Regalo'];
export const MOTIVI_USCITA = ['Usato', 'Perso', 'Regalato', 'Buttato'];
export const POSIZIONE_DA_COLLOCARE = 'Da collocare';

const UID = "uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16))))";
const TS = "updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)";

const TABELLE_CON_UID = [
  'contatti', 'posizioni', 'prodotti', 'ordini', 'righe_ordine', 'magazzino',
];

export const SCHEMA_SQL = `
CREATE TABLE meta (
  chiave TEXT PRIMARY KEY,
  valore TEXT
);

CREATE TABLE contatti (
  id INTEGER PRIMARY KEY,
  ${UID},
  nome TEXT NOT NULL COLLATE NOCASE UNIQUE,
  tipo TEXT NOT NULL DEFAULT 'C' CHECK (tipo IN ('C','F')),   -- C cliente, F fornitore
  telefono TEXT NOT NULL DEFAULT '',
  indirizzo TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  ${TS}
);

CREATE TABLE posizioni (
  id INTEGER PRIMARY KEY,
  ${UID},
  nome TEXT NOT NULL COLLATE NOCASE UNIQUE,
  speciale INTEGER NOT NULL DEFAULT 0,            -- 1 = "Da collocare", non eliminabile
  ordine INTEGER NOT NULL DEFAULT 0,
  ${TS}
);

-- Un "prodotto" raggruppa i codici equivalenti (stesso articolo, confezione diversa).
CREATE TABLE prodotti (
  id INTEGER PRIMARY KEY,
  ${UID},
  nome TEXT NOT NULL,
  ${TS}
);

CREATE TABLE codici (
  codice TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  prodotto_id INTEGER NOT NULL REFERENCES prodotti(id)
);

CREATE TABLE ordini (
  id INTEGER PRIMARY KEY,                         -- è il numero ordine
  ${UID},
  tipo TEXT NOT NULL CHECK (tipo IN ('V','A')),   -- V vendita a cliente, A acquisto da fornitore
  data_emissione TEXT NOT NULL,
  data_evasione TEXT,
  contatto_id INTEGER NOT NULL REFERENCES contatti(id),
  catalogo TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  evaso INTEGER NOT NULL DEFAULT 0,
  totale REAL,                                    -- fissato alla chiusura
  ${TS}
);

CREATE TABLE magazzino (
  id INTEGER PRIMARY KEY,
  ${UID},
  codice TEXT NOT NULL,
  nome TEXT NOT NULL,
  posizione_id INTEGER REFERENCES posizioni(id),
  data_acquisto TEXT,
  prezzo_acquisto REAL,                           -- prezzo di catalogo pieno
  catalogo_acquisto TEXT NOT NULL DEFAULT '',
  ordine_in INTEGER,                              -- numero ordine fornitore (se esiste)
  motivo_in TEXT CHECK (motivo_in IS NULL OR motivo_in IN ('Inventario','Trovato','Regalo')),
  in_magazzino INTEGER NOT NULL DEFAULT 1,
  ordine_out INTEGER,                             -- numero ordine cliente di consegna
  motivo_out TEXT CHECK (motivo_out IS NULL OR motivo_out IN ('Usato','Perso','Regalato','Buttato')),
  prezzo_out REAL,
  data_uscita TEXT,
  note TEXT NOT NULL DEFAULT '',
  ${TS}
);

CREATE TABLE righe_ordine (
  id INTEGER PRIMARY KEY,
  ${UID},
  ordine_id INTEGER NOT NULL REFERENCES ordini(id),
  codice TEXT NOT NULL,
  nome TEXT NOT NULL,
  prezzo REAL NOT NULL DEFAULT 0,                 -- prezzo di catalogo
  magazzino_id INTEGER REFERENCES magazzino(id),  -- solo ordini cliente: prodotto collegato
  ricevuta INTEGER NOT NULL DEFAULT 0,            -- solo ordini fornitore: spuntata in ricezione
  omaggio INTEGER NOT NULL DEFAULT 0,             -- riga aggiunta in ricezione, non era nell'ordine
  ${TS}
);

CREATE INDEX idx_magazzino_codice ON magazzino(codice);
CREATE INDEX idx_magazzino_stock ON magazzino(in_magazzino, posizione_id);
CREATE INDEX idx_righe_ordine ON righe_ordine(ordine_id);
CREATE INDEX idx_righe_magazzino ON righe_ordine(magazzino_id);
CREATE INDEX idx_righe_codice ON righe_ordine(codice);
CREATE INDEX idx_ordini_stato ON ordini(evaso, tipo);
CREATE INDEX idx_codici_prodotto ON codici(prodotto_id);
`;

/** Trigger che aggiornano updated_at a ogni modifica. */
export const TRIGGER_SQL = TABELLE_CON_UID.map(
  (t) => `CREATE TRIGGER trg_${t}_upd AFTER UPDATE ON ${t}
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN UPDATE ${t} SET updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 + (abs(random()) % 1000) WHERE id = NEW.id; END;`,
).join('\n');

/** Crea lo schema in un database vuoto e scrive le impostazioni iniziali. */
export function creaSchema(db) {
  db.run('PRAGMA foreign_keys = OFF');
  db.exec(SCHEMA_SQL);
  db.exec(TRIGGER_SQL);
  db.run("INSERT INTO meta(chiave, valore) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
  db.run("INSERT INTO meta(chiave, valore) VALUES ('sconto_acquisto', '20')");
  db.run("INSERT INTO meta(chiave, valore) VALUES ('ultimo_backup', '')");
  db.run(
    'INSERT INTO posizioni(nome, speciale, ordine) VALUES (?, 1, 0)',
    [POSIZIONE_DA_COLLOCARE],
  );
}

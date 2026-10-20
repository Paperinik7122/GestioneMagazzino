// Popola la rubrica (TabContatti) di una COPIA del vecchio DB con i nomi scritti negli ordini.
//   node scripts/popola-contatti.mjs magazzino.db [uscita.db]
// L'originale non viene toccato. Poi si può sistemare la rubrica con un editor SQLite (DB Browser for SQLite):
// telefoni, note, tipo (C/F) e soprattutto "Alias" per unire i nomi doppi, prima di importare nell'app.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { popolaRubrica } from '../src/db/rubrica-b4a.js';
import { riconosciFile } from '../src/db/backup.js';
import { migraDaB4A } from '../src/db/migrate-b4a.js';
import { righeReport } from '../src/db/backup.js';

const [, , ingresso, uscitaArg] = process.argv;
if (!ingresso) { console.error('Uso: node scripts/popola-contatti.mjs vecchio.db [nuovo.db]'); process.exit(1); }
const uscita = uscitaArg ?? path.join(path.dirname(ingresso), `${path.basename(ingresso, path.extname(ingresso))}_con-rubrica.db`);
if (path.resolve(uscita) === path.resolve(ingresso)) { console.error('Il file di uscita deve essere diverso dall’originale.'); process.exit(1); }

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();
const bytes = fs.readFileSync(ingresso);
if (riconosciFile(SQL, bytes) !== 'b4a') { console.error('Non sembra il database della vecchia app (mancano TabMagazzino/TabOrdini).'); process.exit(1); }

const db = new SQL.Database(bytes);
const r = popolaRubrica(db);
fs.writeFileSync(uscita, Buffer.from(db.export()));
console.log(`Rubrica popolata: ${r.contatti} contatti → ${uscita}`);
if (r.misti.length) console.log(`Usati sia come cliente sia come fornitore (tipo C): ${r.misti.join(', ')}`);

// prova: il file ottenuto si importa senza errori?
const prova = new SQL.Database();
const rep = righeReport(migraDaB4A(new SQL.Database(fs.readFileSync(uscita)), prova));
console.log(`Prova di import riuscita: ${rep.conteggi.map((c) => `${c.n} ${c.testo}`).join(', ')}`);

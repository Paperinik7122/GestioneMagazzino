import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const here = path.dirname(fileURLToPath(import.meta.url));

export async function sqlLib() {
  return initSqlJs();
}

export const FIXTURE_VECCHIO = process.env.VECCHIO_DB
  ?? path.resolve(here, '../../fixtures/old_17gen26.db');

export async function apriVecchio() {
  const SQL = await sqlLib();
  return new SQL.Database(fs.readFileSync(FIXTURE_VECCHIO));
}

export async function nuovoVuoto() {
  const SQL = await sqlLib();
  return new SQL.Database();
}
